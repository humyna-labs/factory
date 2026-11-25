// W2-08 (BL-01, BL-02): SessionStart and Stop hooks, their wiring in every role's settings, and a
// mutation check of rules H1 to H4 (G-03).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const COMPLETE = ["# Report", "## 5. Surprises", "none", "## 6. Reusable practices", "none", "## 7. Proposed principle changes", "none", "## 8. Proposed harness fixes", "none", ""].join("\n");

interface Case {
  name: string;
  hook: "session-start.sh" | "stop-report.sh";
  setup: (d: string) => { input: object; env?: Record<string, string> };
  check: (out: { status: number; stdout: string; stderr: string }) => boolean;
}

const ctx = (stdout: string): string => {
  try {
    return (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
  } catch {
    return "";
  }
};
const blocked = (stdout: string): boolean => {
  try {
    return (JSON.parse(stdout) as { decision?: string }).decision === "block";
  } catch {
    return false;
  }
};

const CASES: Case[] = [
  {
    name: "SessionStart injects progress.md",
    hook: "session-start.sh",
    setup: (d) => { writeFileSync(join(d, "progress.md"), "# Progress\n2026-11-25: MARKER-PROGRESS greeting done\n"); return { input: { cwd: d, hook_event_name: "SessionStart" }, env: { FACTORY_ESCALATIONS_DIR: join(d, "none") } }; },
    check: (o) => o.status === 0 && ctx(o.stdout).includes("MARKER-PROGRESS"),
  },
  {
    name: "SessionStart keeps only the tail of a long progress.md",
    hook: "session-start.sh",
    setup: (d) => { writeFileSync(join(d, "progress.md"), "OLD-HEAD\n" + "x".repeat(9000) + "\nNEW-TAIL\n"); return { input: { cwd: d }, env: { FACTORY_ESCALATIONS_DIR: join(d, "none") } }; },
    check: (o) => ctx(o.stdout).includes("NEW-TAIL") && !ctx(o.stdout).includes("OLD-HEAD"),
  },
  {
    name: "SessionStart lists open escalation titles only",
    hook: "session-start.sh",
    setup: (d) => { mkdirSync(join(d, "esc")); writeFileSync(join(d, "esc", "r-1.md"), "# harness-fix: verify escalation on r#1\n\nBODY-SECRET-DETAIL\n"); return { input: { cwd: d }, env: { FACTORY_ESCALATIONS_DIR: join(d, "esc") } }; },
    check: (o) => ctx(o.stdout).includes("- harness-fix: verify escalation on r#1") && !ctx(o.stdout).includes("BODY-SECRET-DETAIL"),
  },
  {
    name: "SessionStart never reads progress.md through a symlink",
    hook: "session-start.sh",
    setup: (d) => { writeFileSync(join(d, "host.txt"), "HOST-FILE"); symlinkSync(join(d, "host.txt"), join(d, "progress.md")); return { input: { cwd: d }, env: { FACTORY_ESCALATIONS_DIR: join(d, "none") } }; },
    check: (o) => o.status === 0 && !o.stdout.includes("HOST-FILE"),
  },
  {
    name: "SessionStart with nothing to say exits 0 and prints nothing",
    hook: "session-start.sh",
    setup: (d) => ({ input: { cwd: d }, env: { FACTORY_ESCALATIONS_DIR: join(d, "none") } }),
    check: (o) => o.status === 0 && o.stdout === "",
  },
  {
    name: "Stop blocks while the report is missing",
    hook: "stop-report.sh",
    setup: (d) => ({ input: { stop_hook_active: false }, env: { FACTORY_REPORT_PATH: join(d, "r.md") } }),
    check: (o) => o.status === 0 && blocked(o.stdout) && o.stdout.includes("report missing"),
  },
  {
    name: "Stop blocks on an empty section 8",
    hook: "stop-report.sh",
    setup: (d) => { writeFileSync(join(d, "r.md"), COMPLETE.replace("## 8. Proposed harness fixes\nnone", "## 8. Proposed harness fixes\n")); return { input: {}, env: { FACTORY_REPORT_PATH: join(d, "r.md") } }; },
    check: (o) => blocked(o.stdout) && o.stdout.includes("empty section"),
  },
  {
    name: "Stop allows a complete report",
    hook: "stop-report.sh",
    setup: (d) => { writeFileSync(join(d, "r.md"), COMPLETE); return { input: { stop_hook_active: false }, env: { FACTORY_REPORT_PATH: join(d, "r.md") } }; },
    check: (o) => o.status === 0 && o.stdout === "",
  },
  {
    name: "Stop does not block twice in a row (stop_hook_active)",
    hook: "stop-report.sh",
    setup: (d) => ({ input: { stop_hook_active: true }, env: { FACTORY_REPORT_PATH: join(d, "r.md") } }),
    check: (o) => o.status === 0 && !blocked(o.stdout),
  },
  {
    name: "Stop outside a coordinator session allows with a note",
    hook: "stop-report.sh",
    setup: () => ({ input: {} }),
    check: (o) => o.status === 0 && !blocked(o.stdout) && o.stderr.includes("FACTORY_REPORT_PATH is not set"),
  },
];

/** Scratch factory layout: hooks/ (maybe mutated) plus the real coordinator sources the Stop hook calls. */
function layout(mutate?: { file: string; id: string }): string {
  if (!mutate) return ROOT;
  const s = mkdtempSync(join(tmpdir(), "factory-session-hooks-"));
  mkdirSync(join(s, "hooks"));
  symlinkSync(join(ROOT, "coordinator"), join(s, "coordinator"));
  for (const f of ["session-start.sh", "stop-report.sh"]) {
    let text = readFileSync(join(ROOT, "hooks", f), "utf8");
    if (f === mutate.file) {
      const re = new RegExp(`^(\\s*)# RULE ${mutate.id} begin[\\s\\S]*?# RULE ${mutate.id} end\\s*$`, "m");
      if (!re.test(text)) throw new Error(`rule ${mutate.id} not found`);
      text = text.replace(re, `$1: # RULE ${mutate.id} disabled`);
    }
    writeFileSync(join(s, "hooks", f), text, { mode: 0o755 });
  }
  return s;
}

function runCase(root: string, c: Case) {
  const d = mkdtempSync(join(tmpdir(), "factory-hook-case-"));
  const { input, env } = c.setup(d);
  const r = spawnSync("bash", [join(root, "hooks", c.hook)], { input: JSON.stringify(input), encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: d, ...env } });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe("SessionStart and Stop hooks (W2-08)", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const o = runCase(ROOT, c);
    expect(c.check(o), JSON.stringify(o)).toBe(true);
  });
  it.each([
    ["session-start.sh", "H1"],
    ["session-start.sh", "H2"],
    ["stop-report.sh", "H3"],
    ["stop-report.sh", "H4"],
  ])("mutation: disabling %s %s makes a case fail", (file, id) => {
    const root = layout({ file, id });
    expect(CASES.filter((c) => !c.check(runCase(root, c))).length).toBeGreaterThan(0);
  });
  it.each(readdirSync(join(ROOT, "settings")).filter((f) => f.endsWith(".json")))("settings/%s wires both hooks", (f) => {
    const s = JSON.parse(readFileSync(join(ROOT, "settings", f), "utf8")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(s.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe("/workspace/factory/hooks/session-start.sh");
    expect(s.hooks.Stop?.[0]?.hooks[0]?.command).toBe("/workspace/factory/hooks/stop-report.sh");
  });
});

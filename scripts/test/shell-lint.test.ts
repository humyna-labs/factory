// R-08: every shell script parses; human scripts are ASCII and bash-3.2 compatible (static check:
// no bash 3.2 is available in this image), have --dry-run, and time-limit network calls.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const SHELL = tracked.filter((f) => f.endsWith(".sh") || f.startsWith(".githooks/") || f === "bin/coordinator");
const HUMAN = tracked.filter((f) => /^scripts\/[^/]+\.sh$/.test(f));

const BASH4 = [
  [/\bdeclare\s+-[a-zA-Z]*A/, "associative arrays (declare -A) need bash 4"],
  [/\b(mapfile|readarray)\b/, "mapfile/readarray need bash 4"],
  [/\$\{[A-Za-z_][A-Za-z0-9_]*(,,|\^\^)/, "case conversion ${x,,} needs bash 4"],
  [/\|&/, "|& needs bash 4"],
  [/&>>/, "&>> needs bash 4"],
  [/\bcoproc\b/, "coproc needs bash 4"],
  [/\$\{[A-Za-z_][A-Za-z0-9_]*:\s*-[0-9]+\}/, "negative substring offsets need bash 4.2"],
  [/^\s*timeout\s/m, "macOS has no timeout(1); use with_timeout from scripts/lib/common.sh"],
] as const;

/** Returns lint problems for one human-run script. Exported shape is tested below. */
export function lintHumanScript(text: string): string[] {
  const problems: string[] = [];
  // R-08 / brief section 4: macOS bash reads a full-width char after $VAR as part of the name.
  if (/\$[A-Za-z_][A-Za-z0-9_]*[^\t\n\r\x20-\x7E]/.test(text)) problems.push("write ${VAR} when a non-ASCII character follows a variable");
  if (/[^\t\n\r\x20-\x7E]/.test(text)) problems.push("script must be ASCII only (messages too)");
  const code = text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  for (const [re, msg] of BASH4) if (re.test(code)) problems.push(msg);
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#") || t.startsWith("log ") || t.startsWith("die ")) continue;
    if (/(^|[;&|]\s*|\$\(\s*|\b(then|do|else)\s+)(gh|curl)\s|(^|[;&|]\s*|\$\(\s*)git\s+(clone|push|fetch|pull)\b/.test(t) && !/with_timeout|--max-time|command -v|require_cmd/.test(t)) problems.push(`network call without timeout: ${t.slice(0, 80)}`);
  }
  if (!text.includes("--dry-run")) problems.push("every human script needs --dry-run");
  return problems;
}

describe("shell scripts", () => {
  it.each(SHELL)("bash -n %s", (f) => {
    const r = spawnSync("bash", ["-n", join(ROOT, f)], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
  it.each(HUMAN)("human script %s passes the R-08 lint", (f) => {
    expect(lintHumanScript(readFileSync(join(ROOT, f), "utf8"))).toEqual([]);
  });
  it.each(["scripts/lib/common.sh"])("helper %s passes the R-08 lint for syntax", (f) => {
    expect(lintHumanScript(readFileSync(join(ROOT, f), "utf8") + "\n# --dry-run\n")).toEqual([]);
  });
});

describe("the lint itself catches what it claims (G-03)", () => {
  it.each([
    ["full-width char after a variable", 'echo "$NAME："\n# --dry-run'],
    ["associative array", "declare -A m\n# --dry-run"],
    ["mapfile", "mapfile -t x < f\n# --dry-run"],
    ["lowercase expansion", 'echo "${x,,}"\n# --dry-run'],
    ["network call without timeout", 'gh api repos/x\n# --dry-run'],
    ["no dry-run", "echo hi"],
    ["timeout(1)", "timeout 5 sleep 1\n# --dry-run"],
  ])("flags %s", (_n, text) => {
    expect(lintHumanScript(text).length).toBeGreaterThan(0);
  });
  it("accepts ${VAR} before non-ASCII... in principle, but ASCII-only still applies", () => {
    expect(lintHumanScript('echo "${NAME}"\n# --dry-run')).toEqual([]);
  });
});

describe("human scripts run in dry-run mode (offline)", () => {
  const run = (args: string[]) => spawnSync("bash", args, { cwd: ROOT, encoding: "utf8" });
  it("setup-repo --dry-run prints the plan and a valid ruleset JSON, changes nothing", () => {
    const r = run(["scripts/setup-repo.sh", "humyna-labs/resume-sg", "--dry-run"]);
    expect(r.status, r.stderr).toBe(0);
    const json = r.stdout.split("with body:\n")[1]?.split("\nDRY  self-check")[0] ?? "";
    const body = JSON.parse(json);
    expect(body.rules.map((x: { type: string }) => x.type)).toEqual(["deletion", "non_fast_forward", "pull_request", "required_status_checks"]);
    expect(body.rules[2].parameters).toMatchObject({ required_approving_review_count: 0, require_code_owner_review: true });
    expect(r.stdout).toContain("label factory:needs-human");
    expect(r.stdout).toContain("nothing was changed");
  });
  it("setup-repo --dry-run offers the required-reviewers fallback", () => {
    const r = run(["scripts/setup-repo.sh", "humyna-labs/resume-sg", "--dry-run", "--review-mode", "required-reviewers", "--team", "owners"]);
    expect(r.status, r.stderr).toBe(0);
    const body = JSON.parse(r.stdout.split("with body:\n")[1]?.split("\nDRY  self-check")[0] ?? "");
    expect(body.rules[2].parameters.required_reviewers[0].file_patterns).toContain("public/_headers");
  });
  it("factory profile has no required status checks (the factory has no CI yet)", () => {
    const r = run(["scripts/setup-repo.sh", "humyna-labs/factory", "--dry-run"]);
    expect(r.stdout).toContain("profile=factory");
    expect(r.stdout).not.toContain("required_status_checks");
  });
  it("refuses other owners and real runs inside the container (G-07)", () => {
    expect(run(["scripts/setup-repo.sh", "someone/else", "--dry-run"]).status).toBe(1);
    const real = run(["scripts/setup-repo.sh", "humyna-labs/resume-sg"]);
    expect(real.status).toBe(1);
    expect(real.stderr).toMatch(/must run on the host/);
  });
  it("install-workflows --dry-run previews the copy from a local checkout", () => {
    const r = run(["scripts/install-workflows.sh", "humyna-labs/factory", "--dry-run", "--source", "."]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("COPY ci/workflows/gates.yml -> .github/workflows/gates.yml");
  });
  it("labels file covers every coordinator state", () => {
    const labels = readFileSync(join(ROOT, "scripts", "labels.txt"), "utf8");
    for (const s of ["ready", "tests", "impl", "verify", "review", "compliance", "pr", "auto-merge", "needs-human", "escalated"]) expect(labels).toContain(`factory:${s}|`);
  });
  it("with_timeout kills a slow command (bash 3.2-safe helper)", () => {
    const t0 = Date.now();
    const r = spawnSync("bash", ["-c", ". scripts/lib/common.sh; with_timeout 1 sleep 10; echo rc=$?"], { cwd: ROOT, encoding: "utf8" });
    expect(r.stdout).toContain("rc=143");
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

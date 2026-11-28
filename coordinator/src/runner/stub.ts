// Deterministic stand-in for role sessions (spec 3.7: integration tests with stub roles).
// It writes the files a real role would write, plus its report, according to a scenario.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Role } from "../types.ts";
import type { RoleResult, RoleRunner, RoleSession } from "./types.ts";

/** pass: do the job. fail: report failure. no-report: do the job but skip the report.
 *  out-of-scope: also write a file the role may not write.
 *  hang-once: the first time, hang until the process is killed (resume test, W2-06); later, pass.
 *  test-defect: fail and name a defective test (builder, jd2cv-m1).
 *  blocked-once: one hook denial, seen both in guard.log and in the session result; then pass. */
export type StubStep = "pass" | "fail" | "no-report" | "out-of-scope" | "hang-once" | "test-defect" | "blocked-once" | "defect-out-of-scope" | "defect-missing-file";
export type Scenario = Partial<Record<Role | "verify" | "red", StubStep[]>> & { changes?: string[] };
export type Scenarios = Record<string, Scenario>;

export function stepFor(steps: StubStep[] | undefined, attempt: number): StubStep {
  if (!steps || steps.length === 0) return "pass";
  return steps[Math.min(attempt, steps.length) - 1] ?? "pass";
}

export function stubReport(s: RoleSession, step: StubStep): string {
  const fix = step === "fail" ? `| ${s.stage} keeps failing on attempt ${s.attempt} | give the ${s.role} role a checklist for this failure class | S | low |` : "none";
  return [
    `# Run report stub ${s.issue.repo}-${s.issue.number}-${s.stage}-${s.attempt}`,
    "## 1. Outcome",
    step === "fail" ? "Failed (stub)." : "Done (stub).",
    "## 5. Surprises",
    "none (deterministic stub)",
    "## 6. Reusable practices",
    "none (deterministic stub)",
    "## 7. Proposed principle changes",
    "none",
    "## 8. Proposed harness fixes",
    step === "fail" ? "| Problem | Fix | Size | Risk |\n|---|---|---|---|\n" + fix : fix,
    "",
  ].join("\n");
}

function write(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export class StubRunner implements RoleRunner {
  readonly name = "stub" as const;
  private readonly scenarios: Scenarios;
  private readonly onSession: ((s: RoleSession) => void) | undefined;
  private readonly guardLog: string | undefined;
  constructor(scenarios: Scenarios, onSession?: (s: RoleSession) => void, guardLog?: string) {
    this.scenarios = scenarios;
    this.onSession = onSession;
    this.guardLog = guardLog;
  }

  async run(s: RoleSession): Promise<RoleResult> {
    this.onSession?.(s);
    const id = `${s.issue.repo}#${s.issue.number}`;
    const sc = this.scenarios[id] ?? {};
    let step = stepFor(sc[s.role], s.attempt);
    if (step === "hang-once") {
      const marker = join(dirname(s.reportPath), `.hang-once-${s.stage}-${s.attempt}`);
      if (!existsSync(marker)) {
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, "");
        await new Promise((r) => setTimeout(r, 3_600_000));
      }
      step = "pass";
    }
    const slug = `issue-${s.issue.number}`;
    if (s.role === "qa") write(s.worktree, `tests/unit/${slug}.test.ts`, `// stub test for ${id}\nexport {};\n`);
    if (s.role === "builder") {
      for (const rel of sc.changes ?? [`src/features/${slug}.ts`]) write(s.worktree, rel, `// stub implementation for ${id}, attempt ${s.attempt}\nexport const attempt = ${s.attempt};\n`);
    }
    if (step === "defect-out-of-scope") write(s.worktree, "tests/unit/sneaky.test.ts", "// out of scope\n");
    if (step === "out-of-scope") write(s.worktree, s.role === "qa" ? "src/sneaky.ts" : "tests/unit/sneaky.test.ts", "// out of scope\n");
    if (step !== "no-report") {
      mkdirSync(dirname(s.reportPath), { recursive: true });
      writeFileSync(s.reportPath, stubReport(s, step));
    }
    if (step === "test-defect") return { ok: false, turns: 1, costUsd: 0, blockedActions: 0, summary: `stub ${s.role} found a test defect`, testDefect: `tests/unit/${slug}.test.ts:1 contradicts AC1` };
    if (step === "defect-out-of-scope") return { ok: false, turns: 1, costUsd: 0, blockedActions: 0, summary: `stub ${s.role} edited a test and claims a defect`, testDefect: `tests/unit/${slug}.test.ts:1 contradicts AC1` };
    if (step === "defect-missing-file") return { ok: false, turns: 1, costUsd: 0, blockedActions: 0, summary: `stub ${s.role} claims a defect in a file that does not exist`, testDefect: "tests/unit/nope.test.ts:3 contradicts AC1" };
    if (step === "blocked-once" && this.guardLog) {
      mkdirSync(dirname(this.guardLog), { recursive: true });
      appendFileSync(this.guardLog, `2026-01-01T00:00:00Z role=${s.role} tool=Bash rule=B3 target=ls tests/\n`);
      return { ok: true, turns: 1, costUsd: 0, blockedActions: 1, summary: `stub ${s.role} blocked once` };
    }
    const failed = step === "fail";
    return { ok: !failed, turns: 1, costUsd: 0, blockedActions: 0, summary: failed ? `stub ${s.role} failed on attempt ${s.attempt}` : `stub ${s.role} ${step}` };
  }
}

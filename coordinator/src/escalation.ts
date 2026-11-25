// R-09 and P-02: every escalation drafts a harness-fix issue. The draft is also written to disk.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeHarnessFix } from "./runs-csv.ts";
import type { Stage } from "./state.ts";
import type { Issue } from "./types.ts";

export interface AttemptRecord {
  stage: Stage;
  attempt: number;
  passed: boolean;
  reason: string;
}

export interface EscalationInput {
  issue: Issue;
  failedStage: Stage;
  history: AttemptRecord[];
  proposedHarnessFix?: string;
  maxImplAttempts: number;
  reportPaths: string[];
}

export function harnessFixLine(e: EscalationInput): string {
  const base = e.proposedHarnessFix
    ? e.proposedHarnessFix
    : `${e.failedStage} failed after ${e.maxImplAttempts} builder attempts; add the missing tool, guardrail or doc for this failure class`;
  return sanitizeHarnessFix(base);
}

export function harnessFixIssue(e: EscalationInput): { title: string; body: string } {
  const id = `${e.issue.repo}#${e.issue.number}`;
  const line = harnessFixLine(e);
  const hist = e.history.map((h) => `| ${h.stage} | ${h.attempt} | ${h.passed ? "pass" : "fail"} | ${h.reason.replace(/\|/g, "/")} |`);
  const body = [
    `Escalated task: ${id}. Failed stage: ${e.failedStage}.`,
    "",
    "Principles: P-02, P-11",
    "",
    "## Context",
    `The coordinator escalated ${id} after ${e.maxImplAttempts} builder attempts (limit max_impl_attempts).`,
    "Per P-02 a repeated failure is a harness gap: fix the role, gate, tool or doc, not the task.",
    "",
    "| Stage | Attempt | Result | Reason |",
    "|---|---|---|---|",
    ...hist,
    "",
    "## Reproduction",
    `1. Reset the labels of ${id} to factory:ready.`,
    `2. Run: coordinator run --task ${id} --repo-dir <product checkout>`,
    `3. Observe ${e.failedStage} failing with the reasons above. Role reports:`,
    ...e.reportPaths.map((p) => `   - ${p}`),
    "",
    "## Expected behaviour",
    `${id} passes ${e.failedStage} within ${e.maxImplAttempts} builder attempts, or the harness names the missing capability.`,
    "",
    "## Proposed change",
    line,
    "",
    "## Acceptance criteria",
    `- A golden or unit case reproduces this failure class and fails before the fix.`,
    `- After the fix, ${id} (or the new case) passes without human help.`,
    "- docs/failures.md has an entry with symptom, root cause, principle, fix and links.",
    "",
    "## Options for the human (reply with a number)",
    "1. Accept the proposed change above (recommended).",
    "2. Split the task into smaller tasks and re-queue.",
    "3. Close the task as not worth doing now.",
  ].join("\n");
  return { title: `harness-fix: ${e.failedStage} escalation on ${id}`, body };
}

export function writeEscalationDraft(dir: string, e: EscalationInput): string {
  const { title, body } = harnessFixIssue(e);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${e.issue.repo}-${e.issue.number}.md`);
  writeFileSync(p, `# ${title}\n\n${body}\n`);
  return p;
}

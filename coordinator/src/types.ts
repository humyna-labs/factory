import type { Risk, Stage } from "./state.ts";

export const ROLES = ["qa", "builder", "reviewer", "compliance"] as const;
export type Role = (typeof ROLES)[number];
export type LedgerRole = Role | "coordinator";

export const STAGE_ROLE: Record<Stage, LedgerRole> = {
  tests: "qa",
  impl: "builder",
  verify: "coordinator",
  review: "reviewer",
  compliance: "compliance",
  pr: "coordinator",
};

export interface Issue {
  /** Repository name without owner, for example "resume-sg". */
  repo: string;
  owner: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  /** Login of the account that opened the issue (grants, jd2cv-m1). */
  author?: string;
}

export function taskId(issue: Pick<Issue, "repo" | "number">): string {
  return `${issue.repo}#${issue.number}`;
}

export interface StageOutcome {
  passed: boolean;
  /** One ASCII line for logs and the next builder attempt. */
  reason: string;
  turns: number;
  costUsd: number;
  blockedActions: number;
  /** First proposed harness fix from the role report (section 8), if any. */
  proposedHarnessFix?: string;
  /** Builder only: a test contradicts the issue (final message line "Test-defect: ..."). */
  testDefect?: string;
  risk?: Risk;
  prUrl?: string;
}

import type { Stage } from "../state.ts";
import type { Issue, Role } from "../types.ts";

export interface RoleConfig {
  role: Role;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  settings: string;
  disallowedTools: string[];
  /** Absolute path of the role prompt file (roles/<role>.md). */
  promptFile: string;
}

export interface RoleSession {
  role: Role;
  issue: Issue;
  stage: Stage;
  attempt: number;
  maxAttempts: number;
  worktree: string;
  branch: string;
  reportPath: string;
  tracePath: string;
  previousFailure?: string;
  timeoutMs: number;
}

export interface RoleResult {
  ok: boolean;
  turns: number;
  costUsd: number;
  /** Actions refused by auto mode or by our hooks (R-04). */
  blockedActions: number;
  summary: string;
  /** The session's final message carried "Test-defect: <file:line> <reason>". */
  testDefect?: string;
}

/** Runs one role session. Receives no GitHub adapter: roles cannot merge or label (R-02). */
export interface RoleRunner {
  readonly name: "stub" | "claude";
  run(session: RoleSession): Promise<RoleResult>;
}

export interface GateResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GateContext {
  worktree: string;
  task: string;
  attempt: number;
  /** F16: the base SHA recorded when the task worktree was created (red check baseline). */
  base?: string;
}

/** Deterministic checks the coordinator runs itself (spec 3.4: "independently re-run"). */
export interface GateRunner {
  readonly name: "stub" | "shell";
  /** Red check after QA: the new tests must fail before implementation. ok = tests fail. */
  red(ctx: GateContext): Promise<GateResult>;
  /** Verify after the builder: every gate must pass. */
  verify(ctx: GateContext): Promise<GateResult[]>;
}

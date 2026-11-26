// The deterministic task state machine (P-01). Pure functions only; tested in test/state.test.ts.

export const STAGES = ["tests", "impl", "verify", "review", "compliance", "pr"] as const;
export const TERMINAL_STATES = ["auto-merge", "needs-human", "escalated"] as const;
export const STATES = ["ready", ...STAGES, ...TERMINAL_STATES] as const;

export type Stage = (typeof STAGES)[number];
export type TerminalState = (typeof TERMINAL_STATES)[number];
export type State = (typeof STATES)[number];
export type Risk = "low" | "high";

export const DEFAULT_MAX_IMPL_ATTEMPTS = 3;
/** QA re-runs allowed per task after the builder reports a defective test (jd2cv-m1). */
export const MAX_TEST_REWRITES = 1;

export function isTerminal(s: State): s is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(s);
}

export function stateLabel(s: State): string {
  return `factory:${s}`;
}

export interface TransitionContext {
  /** Number of builder attempts already made for this task (1 after the first impl run). */
  implAttempts: number;
  maxImplAttempts: number;
  risk: Risk;
  /** The failed stage was the builder reporting a test that contradicts the issue (Test-defect:). */
  testDefect?: boolean;
  /** QA re-runs already made for this task after a test defect. */
  testRewrites?: number;
}

/** Stages whose failure sends the task back to the builder. */
const RETRYABLE: readonly Stage[] = ["impl", "verify", "review", "compliance"];

/**
 * Next state after a stage finished.
 * ready -> tests -> impl -> verify -> review -> compliance -> pr -> auto-merge | needs-human
 * Any retryable failure -> impl while attempts remain, else escalated.
 * A failure in tests (QA) or pr escalates at once.
 * A builder failure that names a defective test goes back to tests once (MAX_TEST_REWRITES): the
 * builder may not edit tests, so retrying impl cannot fix it (jd2cv-m1, resume-sg#4).
 */
export function transition(state: State, passed: boolean, ctx: TransitionContext): State {
  if (isTerminal(state)) throw new Error(`no transition out of terminal state ${state}`);
  if (state === "ready") return "tests";
  if (passed) {
    switch (state) {
      case "tests":
        return "impl";
      case "impl":
        return "verify";
      case "verify":
        return "review";
      case "review":
        return "compliance";
      case "compliance":
        return "pr";
      case "pr":
        return ctx.risk === "low" ? "auto-merge" : "needs-human";
    }
  }
  if (state === "impl" && ctx.testDefect === true && (ctx.testRewrites ?? 0) < MAX_TEST_REWRITES) return "tests";
  if ((RETRYABLE as readonly State[]).includes(state)) {
    return ctx.implAttempts < ctx.maxImplAttempts ? "impl" : "escalated";
  }
  return "escalated";
}

import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_IMPL_ATTEMPTS, STATES, transition, type State } from "../src/state.ts";

const ctx = (implAttempts: number, risk: "low" | "high" = "low") => ({ implAttempts, maxImplAttempts: 3, risk });

describe("state machine", () => {
  it("has exactly the states of the kickoff", () => {
    expect(STATES).toEqual(["ready", "tests", "impl", "verify", "review", "compliance", "pr", "auto-merge", "needs-human", "escalated"]);
  });

  it("walks the happy path for low risk to auto-merge", () => {
    const path: State[] = ["ready"];
    let s: State = "ready";
    while (!["auto-merge", "needs-human", "escalated"].includes(s)) {
      s = transition(s, true, ctx(1));
      path.push(s);
    }
    expect(path).toEqual(["ready", "tests", "impl", "verify", "review", "compliance", "pr", "auto-merge"]);
  });

  it("routes high risk to needs-human at the pr stage", () => {
    expect(transition("pr", true, ctx(1, "high"))).toBe("needs-human");
  });

  it.each(["impl", "verify", "review", "compliance"] as const)("sends a %s failure back to impl while attempts remain", (s) => {
    expect(transition(s, false, ctx(1))).toBe("impl");
    expect(transition(s, false, ctx(2))).toBe("impl");
  });

  it.each(["impl", "verify", "review", "compliance"] as const)("escalates a %s failure on the last attempt", (s) => {
    expect(transition(s, false, ctx(3))).toBe("escalated");
  });

  it("escalates a tests (QA) or pr failure at once", () => {
    expect(transition("tests", false, ctx(0))).toBe("escalated");
    expect(transition("pr", false, ctx(1))).toBe("escalated");
  });

  it("defaults to 3 builder attempts in total (human correction, read-back section 9)", () => {
    expect(DEFAULT_MAX_IMPL_ATTEMPTS).toBe(3);
  });

  it("honours a configured attempt limit", () => {
    expect(transition("verify", false, { implAttempts: 1, maxImplAttempts: 1, risk: "low" })).toBe("escalated");
    expect(transition("verify", false, { implAttempts: 4, maxImplAttempts: 5, risk: "low" })).toBe("impl");
  });

  it("refuses transitions out of terminal states", () => {
    for (const s of ["auto-merge", "needs-human", "escalated"] as const) expect(() => transition(s, true, ctx(1))).toThrow();
  });
});

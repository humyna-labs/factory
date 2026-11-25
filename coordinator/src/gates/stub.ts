import { stepFor, type Scenarios } from "../runner/stub.ts";
import type { GateContext, GateResult, GateRunner } from "./types.ts";

export const GATE_NAMES = ["typecheck", "lint", "unit", "e2e", "secrets"] as const;

export class StubGates implements GateRunner {
  readonly name = "stub" as const;
  private readonly scenarios: Scenarios;
  constructor(scenarios: Scenarios) {
    this.scenarios = scenarios;
  }
  async red(ctx: GateContext): Promise<GateResult> {
    const ok = stepFor(this.scenarios[ctx.task]?.red, 1) !== "fail";
    return { name: "red", ok, detail: ok ? "new tests fail before implementation (stub)" : "new tests already pass (stub)" };
  }
  async verify(ctx: GateContext): Promise<GateResult[]> {
    const step = stepFor(this.scenarios[ctx.task]?.verify, ctx.attempt);
    return GATE_NAMES.map((name) => {
      const ok = !(step === "fail" && name === "unit");
      return { name, ok, detail: ok ? "pass (stub)" : `unit tests fail on attempt ${ctx.attempt} (stub)` };
    });
  }
}

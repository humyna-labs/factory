// Runs the product's own gate commands from .factory/factory.yaml in the worktree.
// Written and unit-tested with a fake exec; not run against a real product in Phase 1.
import type { FactoryConfig } from "../config.ts";
import type { Exec } from "../exec.ts";
import { factoryPath } from "../paths.ts";
import type { GateContext, GateResult, GateRunner } from "./types.ts";

const TIMEOUT_MS = 20 * 60_000;

/** True when a test runner's output reports failing tests or test files (Vitest and Playwright summaries). */
export function reportsFailures(output: string): boolean {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  return /^\s*(Test Files|Tests)\s+[1-9]\d* failed\b/m.test(plain) || /^\s*[1-9]\d* failed\s*$/m.test(plain);
}

export class ShellGates implements GateRunner {
  readonly name = "shell" as const;
  private readonly cfg: FactoryConfig;
  private readonly run: Exec;
  constructor(cfg: FactoryConfig, run: Exec) {
    this.cfg = cfg;
    this.run = run;
  }

  private async one(name: string, command: string, cwd: string): Promise<GateResult & { output: string }> {
    const r = await this.run("bash", ["-c", command], { cwd, timeoutMs: TIMEOUT_MS });
    const output = r.stdout + r.stderr;
    const tail = output.trim().split("\n").slice(-1)[0] ?? "";
    return { name, ok: r.code === 0 && !r.timedOut, detail: r.timedOut ? "timed out" : `exit ${r.code}: ${tail.slice(0, 160)}`, output };
  }

  async red(ctx: GateContext): Promise<GateResult> {
    const g = await this.one(this.cfg.red_gate, this.cfg.gates[this.cfg.red_gate], ctx.worktree);
    if (g.ok) return { name: "red", ok: false, detail: `${g.name} passed before implementation: tests do not fail first` };
    // jd2cv-m1 (resume-sg#4): a runner that crashes before any test runs (missing package, bad
    // config) also exits non-zero. Red means the run reached the tests and reported failures.
    if (!reportsFailures(g.output)) return { name: "red", ok: false, detail: `${g.name} failed without reporting failing tests (the test runner did not run): ${g.detail}` };
    return { name: "red", ok: true, detail: `${g.name} fails as expected` };
  }

  async verify(ctx: GateContext): Promise<GateResult[]> {
    const out: GateResult[] = [];
    for (const [name, cmd] of Object.entries(this.cfg.gates)) out.push(await this.one(name, cmd, ctx.worktree));
    const secret = await this.run(factoryPath("hooks", "secret-guard.sh"), ["--scan-git"], { cwd: ctx.worktree, timeoutMs: 120_000 });
    out.push({ name: "secrets", ok: secret.code === 0, detail: secret.code === 0 ? "no findings" : secret.stderr.trim().split("\n")[0] ?? "findings" });
    return out;
  }
}

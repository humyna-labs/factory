// Runs the product's own gate commands from .factory/factory.yaml in the worktree.
// Written and unit-tested with a fake exec; not run against a real product in Phase 1.
import type { FactoryConfig } from "../config.ts";
import type { Exec } from "../exec.ts";
import { factoryPath } from "../paths.ts";
import type { GateContext, GateResult, GateRunner } from "./types.ts";

const TIMEOUT_MS = 20 * 60_000;

export class ShellGates implements GateRunner {
  readonly name = "shell" as const;
  private readonly cfg: FactoryConfig;
  private readonly run: Exec;
  constructor(cfg: FactoryConfig, run: Exec) {
    this.cfg = cfg;
    this.run = run;
  }

  private async one(name: string, command: string, cwd: string): Promise<GateResult> {
    const r = await this.run("bash", ["-c", command], { cwd, timeoutMs: TIMEOUT_MS });
    const tail = (r.stdout + r.stderr).trim().split("\n").slice(-1)[0] ?? "";
    return { name, ok: r.code === 0 && !r.timedOut, detail: r.timedOut ? "timed out" : `exit ${r.code}: ${tail.slice(0, 160)}` };
  }

  async red(ctx: GateContext): Promise<GateResult> {
    const g = await this.one(this.cfg.red_gate, this.cfg.gates[this.cfg.red_gate], ctx.worktree);
    return { name: "red", ok: !g.ok, detail: g.ok ? `${g.name} passed before implementation: tests do not fail first` : `${g.name} fails as expected` };
  }

  async verify(ctx: GateContext): Promise<GateResult[]> {
    const out: GateResult[] = [];
    for (const [name, cmd] of Object.entries(this.cfg.gates)) out.push(await this.one(name, cmd, ctx.worktree));
    const secret = await this.run(factoryPath("hooks", "secret-guard.sh"), ["--scan-git"], { cwd: ctx.worktree, timeoutMs: 120_000 });
    out.push({ name: "secrets", ok: secret.code === 0, detail: secret.code === 0 ? "no findings" : secret.stderr.trim().split("\n")[0] ?? "findings" });
    return out;
  }
}

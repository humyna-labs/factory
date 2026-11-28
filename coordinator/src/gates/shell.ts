// Runs the product's own gate commands from .factory/factory.yaml in the worktree.
// Written and unit-tested with a fake exec; not run against a real product in Phase 1.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { FactoryConfig } from "../config.ts";
import type { Exec } from "../exec.ts";
import { factoryPath } from "../paths.ts";
import type { GateContext, GateResult, GateRunner } from "./types.ts";

const TIMEOUT_MS = 20 * 60_000;

/** Owner, 2026-11-28 (F16): dependencies of the baseline worktree come from the local store only. */
export const BASELINE_INSTALL = "pnpm install --offline --frozen-lockfile";
/** The paths QA owns (R5): only these are brought from the task branch onto the baseline. */
export const TEST_PATHS = ["tests", "evals"] as const;

export interface ShellGatesOptions {
  remote?: string;
  /** Owner, 2026-11-28: the temporary baseline worktrees live under /workspace (the CLI passes <runs>/red). */
  tmpRoot?: string;
  /** Command that installs dependencies in the baseline worktree (default BASELINE_INSTALL). */
  install?: string;
  /**
   * F01b: the factory's own run checkout (coordinator, hooks, roles, settings) and the approved SHA it must stay
   * at. After every gate it must be clean and at that SHA, else the task escalates with the changed paths.
   */
  factory?: { root: string; sha: string };
}

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
  private readonly remote: string;
  private readonly install: string;
  private readonly tmpRoot: string;
  private readonly factory: { root: string; sha: string } | undefined;
  constructor(cfg: FactoryConfig, run: Exec, opts: ShellGatesOptions = {}) {
    this.cfg = cfg;
    this.run = run;
    this.remote = opts.remote ?? "origin";
    this.install = opts.install ?? BASELINE_INSTALL;
    this.tmpRoot = opts.tmpRoot ?? "/workspace/runs/red";
    this.factory = opts.factory;
  }

  /** F01b: the factory checkout is clean and still at the approved SHA. */
  private async factoryUnchanged(after: string): Promise<GateResult | undefined> {
    if (!this.factory) return undefined;
    const { root, sha } = this.factory;
    const head = await this.git(root, ["rev-parse", "HEAD"]);
    const st = await this.git(root, ["status", "--porcelain", "--no-renames", "--untracked-files=all", "-z"]);
    if (head.code !== 0 || st.code !== 0) return { name: "factory-checkout", ok: false, escalate: true, detail: `cannot read the factory checkout ${root} after ${after}; failing closed` };
    const paths = st.stdout.split("\0").filter(Boolean).map((e) => e.slice(3));
    const moved = head.stdout.trim() !== sha;
    if (!paths.length && !moved) return undefined;
    const what = [moved ? `HEAD is ${head.stdout.trim().slice(0, 12)}, not the approved ${sha.slice(0, 12)}` : "", paths.length ? `changed: ${paths.slice(0, 10).join(", ")}` : ""].filter(Boolean).join("; ");
    return { name: "factory-checkout", ok: false, escalate: true, detail: `gate ${after} changed the factory checkout ${root}: ${what}` };
  }

  /** The task baseline: the base SHA recorded at task start, else the merge base with the remote base branch. */
  private async baseline(ctx: GateContext): Promise<{ sha?: string; detail: string }> {
    if (ctx.base && /^[0-9a-f]{40}$/.test(ctx.base)) {
      const ok = await this.git(ctx.worktree, ["cat-file", "-e", `${ctx.base}^{commit}`]);
      if (ok.code === 0) return { sha: ctx.base, detail: "recorded" };
    }
    const mb = await this.git(ctx.worktree, ["merge-base", "HEAD", `${this.remote}/${this.cfg.base_branch}`]);
    const sha = mb.stdout.trim();
    if (mb.code === 0 && /^[0-9a-f]{40}$/.test(sha)) return { sha, detail: "merge-base" };
    return { detail: `no task baseline (no recorded base; git merge-base exit ${mb.code}): ${mb.stderr.trim().slice(0, 160)}` };
  }

  private async git(cwd: string, args: string[], input?: string) {
    return this.run("git", args, { cwd, kind: "git", timeoutMs: 120_000, ...(input !== undefined ? { input } : {}) });
  }

  private async one(name: string, command: string, cwd: string): Promise<GateResult & { output: string; code: number; timedOut: boolean }> {
    const r = await this.run("bash", ["-c", command], { cwd, timeoutMs: TIMEOUT_MS });
    const output = r.stdout + r.stderr;
    const tail = output.trim().split("\n").slice(-1)[0] ?? "";
    return { name, ok: r.code === 0 && !r.timedOut, detail: r.timedOut ? "timed out" : `exit ${r.code}: ${tail.slice(0, 160)}`, output, code: r.code, timedOut: r.timedOut };
  }

  /**
   * F16 (resume-sg#48): the red check runs on the task baseline plus the task's test changes, never on the task
   * worktree. After a QA rewrite the worktree can already hold a committed builder attempt, and then every test
   * passes there. The baseline is the base SHA recorded at task start (else the merge base of HEAD and the remote
   * base branch); only tests/ and evals/ are
   * brought over from HEAD. The temporary worktree is always removed; the task worktree is never changed.
   */
  async red(ctx: GateContext): Promise<GateResult> {
    const fail = (detail: string): GateResult => ({ name: "red", ok: false, detail });
    const b = await this.baseline(ctx);
    if (!b.sha) return fail(b.detail);
    const base = b.sha;
    mkdirSync(this.tmpRoot, { recursive: true });
    // Unique per task and attempt; removed in finally. The gate runs there through one(), with the same minimal
    // environment and timeout as every other gate (R-05, R-12).
    const dir = mkdtempSync(join(this.tmpRoot, `${ctx.task.replace(/[^A-Za-z0-9_-]/g, "-")}-a${ctx.attempt}-`));
    try {
      const add = await this.git(ctx.worktree, ["worktree", "add", "-q", "--detach", dir, base]);
      if (add.code !== 0) return fail(`baseline worktree not created: ${add.stderr.trim().slice(0, 160)}`);
      const diff = await this.git(ctx.worktree, ["diff", "--binary", base, "HEAD", "--", ...TEST_PATHS]);
      if (diff.code !== 0) return fail(`test changes not read: ${diff.stderr.trim().slice(0, 160)}`);
      if (diff.stdout.trim()) {
        const apply = await this.git(dir, ["apply", "--whitespace=nowarn"], diff.stdout);
        if (apply.code !== 0) return fail(`test changes do not apply to the baseline: ${apply.stderr.trim().slice(0, 160)}`);
      }
      const inst = await this.one("install", this.install, dir);
      const afterInstall = await this.factoryUnchanged("install");
      if (afterInstall) return afterInstall;
      if (!inst.ok) return fail(`baseline install failed (${this.install}): ${inst.detail}`);
      const red = await this.redOn(dir);
      return (await this.factoryUnchanged(this.cfg.red_gate)) ?? red;
    } finally {
      await this.git(ctx.worktree, ["worktree", "remove", "--force", dir]);
      rmSync(dir, { recursive: true, force: true });
      await this.git(ctx.worktree, ["worktree", "prune"]);
    }
  }

  private async redOn(dir: string): Promise<GateResult> {
    const g = await this.one(this.cfg.red_gate, this.cfg.gates[this.cfg.red_gate], dir);
    // F13: a red needs a complete run. A timeout or an abnormal exit (a signal, or any code other than the test
    // runners' "tests failed" code 1) is never a valid red, whatever failure summary it printed.
    if (g.timedOut) return { name: "red", ok: false, detail: `${g.name} timed out: not a complete run, so not a valid red` };
    if (g.ok) return { name: "red", ok: false, detail: `${g.name} passed before implementation: tests do not fail first` };
    if (g.code !== 1) return { name: "red", ok: false, detail: `${g.name} ended abnormally (exit ${g.code}): not a complete run, so not a valid red` };
    // jd2cv-m1 (resume-sg#4): a runner that crashes before any test runs (missing package, bad
    // config) also exits non-zero. Red means the run reached the tests and reported failures.
    if (!reportsFailures(g.output)) return { name: "red", ok: false, detail: `${g.name} failed without reporting failing tests (the test runner did not run): ${g.detail}` };
    return { name: "red", ok: true, detail: `${g.name} fails as expected` };
  }

  /**
   * F01a: after every gate the task worktree must show no change at all (git status, untracked files included,
   * ignored build output excepted). The verify stage itself writes only feature_list.json, after the gates.
   */
  private async worktreeUnchanged(worktree: string, after: string): Promise<GateResult | undefined> {
    const st = await this.git(worktree, ["status", "--porcelain", "--no-renames", "--untracked-files=all", "-z"]);
    if (st.code !== 0) return { name: "worktree", ok: false, escalate: true, detail: `git status failed after ${after}; failing closed` };
    const paths = st.stdout.split("\0").filter(Boolean).map((e) => e.slice(3));
    if (!paths.length) return undefined;
    return { name: "worktree", ok: false, escalate: true, detail: `gate ${after} changed files in the task worktree: ${paths.slice(0, 10).join(", ")}` };
  }

  async verify(ctx: GateContext): Promise<GateResult[]> {
    const out: GateResult[] = [];
    for (const [name, cmd] of Object.entries(this.cfg.gates)) {
      out.push(await this.one(name, cmd, ctx.worktree));
      const stray = (await this.factoryUnchanged(name)) ?? (await this.worktreeUnchanged(ctx.worktree, name));
      if (stray) return [...out, stray];
    }
    const secret = await this.run(factoryPath("hooks", "secret-guard.sh"), ["--scan-git"], { cwd: ctx.worktree, timeoutMs: 120_000 });
    out.push({ name: "secrets", ok: secret.code === 0, detail: secret.code === 0 ? "no findings" : secret.stderr.trim().split("\n")[0] ?? "findings" });
    const afterScan = await this.factoryUnchanged("secrets");
    if (afterScan) out.push(afterScan);
    return out;
  }
}

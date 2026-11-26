// Dry-run harness (A2): a throwaway product repo generated from the template, a local bare
// remote, the fake GitHub adapter, stub roles and stub gates. Nothing leaves the machine.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadFactoryConfig } from "./config.ts";
import type { Deps } from "./coordinator.ts";
import { EventLog } from "./events.ts";
import { exec, type Exec } from "./exec.ts";
import { StubGates } from "./gates/stub.ts";
import { FakeGitHub } from "./github/fake.ts";
import { newProduct } from "./new-product.ts";
import { factoryPath, runPaths, type RunPaths } from "./paths.ts";
import { runQueue, type Digest } from "./queue.ts";
import { RunsCsvWriter } from "./runs-csv.ts";
import { buildClaudeInvocation } from "./runner/claude.ts";
import { loadRoleConfig } from "./runner/roles.ts";
import { StubRunner, type Scenarios } from "./runner/stub.ts";
import type { Issue } from "./types.ts";
import { GitWorkspace } from "./workspace/git.ts";

export interface Fixture {
  product: string;
  owner: string;
  issues: (Pick<Issue, "number" | "title" | "labels" | "body"> & { author?: string })[];
  scenarios: Scenarios;
  expected: Record<string, string>;
}

export const DRY_RUN_FIXTURE = factoryPath("coordinator", "fixtures", "dry-run-tasks.json");

export function loadFixture(path: string): Fixture {
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

export interface FixtureRun {
  digest: Digest;
  gh: FakeGitHub;
  paths: RunPaths;
  repoDir: string;
}

async function must(run: Exec, cwd: string, args: string[]): Promise<void> {
  const r = await run("git", args, { cwd, kind: "git" });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
}

/** resume: keep the scratch repos, worktrees and fake GitHub state of the last run (W2-06). */
export async function runFixture(o: { fixture: Fixture; runsDir: string; maxHours: number; resume?: boolean; log?: (line: string) => void; now?: () => Date }): Promise<FixtureRun> {
  const f = o.fixture;
  const paths = runPaths(o.runsDir);
  const scratch = join(o.runsDir, "repos");
  const repoDir = join(scratch, f.product);
  const bare = join(scratch, `${f.product}.git`);
  const fakeState = join(o.runsDir, "fake-github.json");
  if (o.resume && existsSync(repoDir) && existsSync(fakeState)) {
    return runDeps(o, f, paths, repoDir, fakeState);
  }
  rmSync(scratch, { recursive: true, force: true });
  rmSync(paths.worktreesDir, { recursive: true, force: true });
  rmSync(fakeState, { force: true });
  mkdirSync(scratch, { recursive: true });
  newProduct({ name: f.product, out: repoDir, owner: f.owner });
  await must(exec, scratch, ["init", "-q", "--bare", "-b", "main", bare]);
  await must(exec, repoDir, ["init", "-q", "-b", "main"]);
  await must(exec, repoDir, ["config", "user.name", "factory-dry-run"]);
  await must(exec, repoDir, ["config", "user.email", "dry-run@localhost"]);
  await must(exec, repoDir, ["add", "-A"]);
  await must(exec, repoDir, ["commit", "-q", "-m", "chore: product from template", "-m", "Agent-Role: coordinator"]);
  await must(exec, repoDir, ["remote", "add", "origin", bare]);
  await must(exec, repoDir, ["push", "-q", "origin", "main"]);
  return runDeps(o, f, paths, repoDir, fakeState);
}

async function runDeps(o: { maxHours: number; log?: (line: string) => void; now?: () => Date }, f: Fixture, paths: RunPaths, repoDir: string, fakeState: string): Promise<FixtureRun> {
  const cfg = loadFactoryConfig(join(repoDir, ".factory", "factory.yaml"));
  const gh = new FakeGitHub(f.issues.map((i) => ({ ...i, owner: f.owner, repo: f.product, state: "open" as const })), fakeState);
  const log = o.log ?? (() => undefined);
  const runner = new StubRunner(f.scenarios, (s) => {
    const inv = buildClaudeInvocation(s, loadRoleConfig(s.role), { baseBranch: cfg.base_branch, reportsDir: paths.reportsDir, guardLog: paths.guardLog });
    log(`  [dry-run] ${s.issue.repo}#${s.issue.number} ${s.stage}#${s.attempt}: would run (cwd ${inv.cwd}) ${inv.cmd} ${inv.args.join(" ")}`);
  }, paths.guardLog);
  const deps: Deps = {
    cfg,
    gh,
    runner,
    gates: new StubGates(f.scenarios),
    workspace: new GitWorkspace(exec, { repoDir, worktreesDir: paths.worktreesDir, baseBranch: cfg.base_branch, remote: "origin" }),
    exec,
    ledger: new RunsCsvWriter(paths.runsCsv),
    events: new EventLog(paths.events),
    paths,
    now: o.now ?? (() => new Date()),
  };
  const digest = await runQueue(deps, o.maxHours);
  return { digest, gh, paths, repoDir };
}

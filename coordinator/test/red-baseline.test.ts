// F16 (owner, 2026-11-28; resume-sg#48): the fail-first check runs only on the task baseline plus the task's test
// changes. Before the fix it ran on the task worktree, which after a QA rewrite already held the committed builder
// attempt, so every test passed and the task escalated with "tests do not fail first".
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFactoryConfig } from "../src/config.ts";
import { exec, type Exec } from "../src/exec.ts";
import { BASELINE_INSTALL, ShellGates } from "../src/gates/shell.ts";
import { GitWorkspace } from "../src/workspace/git.ts";
import { tmp } from "./helpers.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

// The "test runner": fails while src/v.txt is not "new", in the Vitest summary format the red check reads.
const CHECK = `if [ "$(cat src/v.txt)" = new ]; then echo " Tests  1 passed (1)"; else echo " Tests  1 failed (1)"; exit 1; fi\n`;
const ALWAYS_PASS = `echo " Tests  1 passed (1)"\n`;

function write(dir: string, rel: string, text: string): void {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

/** origin (bare) with main = src/v.txt "old"; a task worktree on branch factory/p-1 from origin/main. */
function setup(): { root: string; wt: string } {
  const root = tmp("factory-red-fixture-");
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, repo]);
  write(repo, "src/v.txt", "old");
  write(repo, "README.md", "fixture\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  git(repo, "push", "-q", "origin", "HEAD:main");
  git(repo, "fetch", "-q", "origin");
  const wt = join(root, "wt");
  git(repo, "worktree", "add", "-q", "-B", "factory/p-1", wt, "origin/main");
  return { root, wt };
}

const commit = (wt: string, msg: string, files: Record<string, string>) => {
  for (const [rel, text] of Object.entries(files)) write(wt, rel, text);
  git(wt, "add", "-A");
  git(wt, "commit", "-qm", msg);
};

const cfg = parseFactoryConfig(
  "version: 1\nproduct: p\nrepo: humyna-labs/p\nhigh_risk_paths: [package.json]\ngates: { typecheck: 'true', lint: 'true', unit: 'sh tests/check.sh', e2e: 'true' }\nred_gate: unit\ndeploy: { provider: cloudflare-pages, mode: git-integration }\n",
);
const ctx = (wt: string, base?: string) => ({ worktree: wt, task: "p#1", attempt: 2, ...(base ? { base } : {}) });
const RED_ROOT = tmp("factory-red-root-");
const gates = (run: Exec = exec, install = "true") => new ShellGates(cfg, run, { install, tmpRoot: RED_ROOT });
const leftovers = () => readdirSync(RED_ROOT);

describe("F16: the red check runs on the task baseline plus the new tests", () => {
  it("after a QA rewrite on top of a committed builder attempt, the new tests still fail first", async () => {
    const { wt } = setup();
    commit(wt, "factory(tests): attempt 1", { "tests/check.sh": CHECK });
    commit(wt, "factory(impl): attempt 1", { "src/v.txt": "new" });
    commit(wt, "factory(tests): attempt 2", { "tests/check.sh": `# rewritten by QA\n${CHECK}` });
    const head = git(wt, "rev-parse", "HEAD");
    const before = leftovers();

    const r = await gates().red(ctx(wt));
    expect(r, r.detail).toMatchObject({ ok: true, detail: "unit fails as expected" });

    // The task worktree is untouched: same HEAD, clean, the implementation still there.
    expect(git(wt, "rev-parse", "HEAD")).toBe(head);
    expect(git(wt, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(wt, "src/v.txt"), "utf8")).toBe("new");
    // The temporary worktree is gone, from disk and from git.
    expect(leftovers()).toEqual(before);
    expect(git(wt, "worktree", "list").split("\n")).toHaveLength(2);
  });

  it("tests that pass on the baseline are still not red: the check is not skipped", async () => {
    const { wt } = setup();
    commit(wt, "factory(tests): attempt 1", { "tests/check.sh": ALWAYS_PASS });
    const r = await gates().red(ctx(wt));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/passed before implementation: tests do not fail first/);
  });

  it("only tests/ and evals/ come from the task branch: a src/ change made by QA's branch does not reach the baseline", async () => {
    const { wt } = setup();
    // src/v.txt "new" is on the branch, but it is not a test path, so the baseline keeps "old" and the test fails.
    commit(wt, "factory(tests): attempt 1", { "tests/check.sh": CHECK, "src/v.txt": "new", "evals/e.txt": "x" });
    const r = await gates().red(ctx(wt));
    expect(r, r.detail).toMatchObject({ ok: true });
  });

  it("a deleted test file is deleted on the baseline too", async () => {
    const { wt } = setup();
    commit(wt, "base tests", { "tests/check.sh": ALWAYS_PASS, "tests/old.sh": "x" });
    git(wt, "push", "-q", "origin", "HEAD:main");
    git(wt, "fetch", "-q", "origin");
    git(wt, "rm", "-q", "tests/old.sh");
    commit(wt, "factory(tests): attempt 1", { "tests/check.sh": `[ -e tests/old.sh ] && { echo " Tests  1 passed (1)"; exit 0; }\n${CHECK}` });
    const r = await gates().red(ctx(wt));
    expect(r, r.detail).toMatchObject({ ok: true });
  });

  it("the baseline install is the owner's command, run in the temporary worktree, and its failure is reported", async () => {
    const { wt } = setup();
    commit(wt, "factory(tests): attempt 1", { "tests/check.sh": CHECK });
    const calls: { cmd: string; args: string[]; cwd: string }[] = [];
    const spy: Exec = async (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "bash" && args[1] === BASELINE_INSTALL) return { code: 1, stdout: "", stderr: "ERR_PNPM_NO_OFFLINE_TARBALL", timedOut: false };
      return exec(cmd, args, opts);
    };
    expect(BASELINE_INSTALL).toBe("pnpm install --offline --frozen-lockfile");
    const r = await gates(spy, BASELINE_INSTALL).red(ctx(wt));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/baseline install failed \(pnpm install --offline --frozen-lockfile\)/);
    const install = calls.find((c) => c.cmd === "bash" && c.args[1] === BASELINE_INSTALL);
    expect(install?.cwd.startsWith(`${RED_ROOT}/p-1-a2-`)).toBe(true);
    expect(install?.cwd).not.toBe(wt);
    expect(existsSync(install?.cwd ?? "/nonexistent")).toBe(false);
  });

  it("a new test that imports a module the builder created later counts as failing first on the baseline", async () => {
    const { wt } = setup();
    // Like Vitest: a test file whose import does not resolve is a failed test file, and the summary says so.
    const IMPORTS = `if [ -f src/mod.sh ]; then echo " Tests  1 passed (1)"; else echo "Error: Failed to load src/mod.sh"; echo " Test Files  1 failed (1)"; exit 1; fi\n`;
    commit(wt, "factory(tests): attempt 1", { "tests/check.sh": IMPORTS });
    commit(wt, "factory(impl): attempt 1", { "src/mod.sh": "x=1\n" });
    commit(wt, "factory(tests): attempt 2", { "tests/check.sh": `# rewritten\n${IMPORTS}` });
    const r = await gates().red(ctx(wt));
    expect(r, r.detail).toMatchObject({ ok: true });
  });

  it("the base SHA recorded at task start is the baseline, before the merge base", async () => {
    const { root, wt } = setup();
    const start = git(wt, "rev-parse", "HEAD");
    // main moves on with a commit that makes the test pass; the task branch then merges main (Update branch).
    const other = join(root, "other");
    execFileSync("git", ["clone", "-q", join(root, "origin.git"), other]);
    commit(other, "main moves on", { "src/v.txt": "new" });
    git(other, "push", "-q", "origin", "HEAD:main");
    git(wt, "fetch", "-q", "origin");
    git(wt, "-c", "user.name=t", "merge", "-q", "--no-edit", "origin/main");
    commit(wt, "factory(tests): attempt 1", { "tests/check.sh": CHECK });
    // The merge base is now the new main (test passes there); the recorded base is the task start (test fails).
    expect((await gates().red(ctx(wt))).ok).toBe(false);
    const r = await gates().red(ctx(wt, start));
    expect(r, r.detail).toMatchObject({ ok: true });
  });

  it("a recorded base that is not a commit of the repository falls back to the merge base", async () => {
    const { wt } = setup();
    commit(wt, "factory(tests): attempt 1", { "tests/check.sh": CHECK });
    const r = await gates().red(ctx(wt, "f".repeat(40)));
    expect(r, r.detail).toMatchObject({ ok: true });
  });

  it("GitWorkspace records the base SHA when it creates a task worktree, and reads it back", async () => {
    const root = tmp("factory-red-fixture-");
    const origin = join(root, "origin.git");
    const repo = join(root, "repo");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    execFileSync("git", ["clone", "-q", origin, repo]);
    commit(repo, "base", { "src/v.txt": "old" });
    git(repo, "push", "-q", "origin", "HEAD:main");
    const ws = new GitWorkspace(exec, { repoDir: repo, worktreesDir: join(root, "wts"), baseBranch: "main", remote: "origin" });
    const { worktree } = await ws.prepare({ repo: "p", number: 7, title: "t", body: "", labels: [] } as never);
    expect(await ws.baseSha(worktree)).toBe(git(repo, "rev-parse", "origin/main"));
    expect(git(worktree, "status", "--porcelain")).toBe("");
  });

  it("the CLI puts the baseline worktrees under /workspace (<runs>/red), and that is also the default", () => {
    const cli = readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8");
    expect(cli).toContain('new ShellGates(cfg, exec, { tmpRoot: join(paths.runsDir, "red") })');
    const src = readFileSync(join(import.meta.dirname, "..", "src", "gates", "shell.ts"), "utf8");
    expect(src).toContain('opts.tmpRoot ?? "/workspace/runs/red"');
  });

  it("no baseline (no remote base branch) fails the check with a reason", async () => {
    const root = tmp("factory-red-fixture-");
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    commit(root, "only", { "tests/check.sh": CHECK, "src/v.txt": "old" });
    const r = await gates().red(ctx(root));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no task baseline/);
  });
});

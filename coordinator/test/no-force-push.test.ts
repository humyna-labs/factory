// F04 (owner, 2026-11-28): no force pushes. A restart runs on a new branch factory/<repo>-<n>-r<k>; its PR closes the
// earlier PR of the same task, but only one the coordinator opened (author humyna-bot, head factory/...). A remote
// branch with commits the local one lacks (the owner's "Update branch" merge commit) is merged in, never rebased,
// and the push is a fast-forward.
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exec } from "../src/exec.ts";
import { FACTORY_LOGIN } from "../src/github/types.ts";
import { GitWorkspace } from "../src/workspace/git.ts";
import { dryRun, tmp } from "./helpers.ts";
import { writeFileSync } from "node:fs";

const ID = ["-c", "user.name=bot", "-c", "user.email=bot@localhost", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...args: string[]) => execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8" }).trim();

/** origin (bare, main = a.txt) and a task worktree made by GitWorkspace, with one local commit pushed once. */
async function pushed(): Promise<{ root: string; origin: string; ws: GitWorkspace; wt: string; branch: string }> {
  const root = tmp("factory-noforce-");
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, repo]);
  git(repo, "config", "user.name", "bot");
  git(repo, "config", "user.email", "bot@localhost");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base\n\nAgent-Role: coordinator");
  git(repo, "push", "-q", "origin", "HEAD:main");
  const ws = new GitWorkspace(exec, { repoDir: repo, worktreesDir: join(root, "wts"), baseBranch: "main", remote: "origin" });
  const { worktree: wt, branch } = await ws.prepare({ owner: "humyna-labs", repo: "p", number: 9, title: "t", body: "", labels: [], state: "open" } as never);
  writeFileSync(join(wt, "b.txt"), "b\n");
  git(wt, "add", "-A");
  git(wt, "commit", "-qm", "factory(impl): p#9 attempt 1\n\nAgent-Role: builder");
  await ws.push(wt, branch);
  return { root, origin, ws, wt, branch };
}

/** Someone else adds a commit to the remote branch (like GitHub's "Update branch" merge commit). */
function remoteCommit(root: string, origin: string, branch: string, file: string, text: string): string {
  const other = join(root, `other-${file}`);
  execFileSync("git", ["clone", "-q", "-b", branch, origin, other]);
  writeFileSync(join(other, file), text);
  git(other, "add", "-A");
  git(other, "commit", "-qm", "Merge branch 'main' into the PR branch");
  git(other, "push", "-q", "origin", `HEAD:${branch}`);
  return git(other, "rev-parse", "HEAD");
}

describe("F04: push without force", () => {
  it("a remote branch with an extra commit is merged in (not rebased) and the push is a fast-forward", async () => {
    const { root, origin, ws, wt, branch } = await pushed();
    const theirs = remoteCommit(root, origin, branch, "c.txt", "c\n");
    writeFileSync(join(wt, "d.txt"), "d\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-qm", "factory(impl): p#9 attempt 2\n\nAgent-Role: builder");
    const mine = git(wt, "rev-parse", "HEAD");
    await ws.push(wt, branch);
    const tip = git(origin, "rev-parse", `refs/heads/${branch}`);
    // Both commits are in the pushed history, and neither was rewritten.
    expect(spawnSync("git", ["merge-base", "--is-ancestor", theirs, tip], { cwd: origin }).status).toBe(0);
    expect(spawnSync("git", ["merge-base", "--is-ancestor", mine, tip], { cwd: origin }).status).toBe(0);
    expect(git(origin, "log", "-1", "--format=%B", tip)).toMatch(/^Merge origin\/factory\/p-9 into factory\/p-9\n\nAgent-Role: coordinator/);
    expect(git(origin, "rev-list", "--count", `${tip}^@`, "--not", tip)).toBe("0");
  });

  it("with nothing new on the remote the push is a plain fast-forward, no merge commit", async () => {
    const { origin, ws, wt, branch } = await pushed();
    writeFileSync(join(wt, "e.txt"), "e\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-qm", "factory(impl): p#9 attempt 2\n\nAgent-Role: builder");
    await ws.push(wt, branch);
    expect(git(origin, "rev-parse", `refs/heads/${branch}`)).toBe(git(wt, "rev-parse", "HEAD"));
  });

  it("a remote commit that conflicts is not overwritten: the push fails, the merge is aborted, the remote is unchanged", async () => {
    const { root, origin, ws, wt, branch } = await pushed();
    const theirs = remoteCommit(root, origin, branch, "b.txt", "theirs\n");
    writeFileSync(join(wt, "b.txt"), "mine\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-qm", "factory(impl): p#9 attempt 2\n\nAgent-Role: builder");
    await expect(ws.push(wt, branch)).rejects.toThrow(/do not merge cleanly; not pushed \(no force push, F04\)/);
    expect(git(origin, "rev-parse", `refs/heads/${branch}`)).toBe(theirs);
    expect(git(wt, "status", "--porcelain")).toBe("");
  });

  it("no git call of a push carries a force option or a forced refspec", async () => {
    const calls: string[][] = [];
    const spy = (async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      // the remote branch exists and is behind: ls-remote prints it, is-ancestor says no, the merge succeeds
      if (args[0] === "ls-remote") return { code: 0, stdout: "abc\trefs/heads/factory/p-9\n", stderr: "", timedOut: false };
      if (args[0] === "merge-base") return { code: 1, stdout: "", stderr: "", timedOut: false };
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    }) as never;
    await new GitWorkspace(spy, { repoDir: "/tmp/r", worktreesDir: "/tmp/w", baseBranch: "main", remote: "origin" }).push("/tmp/w/x", "factory/p-9");
    expect(calls.map((c) => c[1])).toEqual(["ls-remote", "fetch", "merge-base", "merge", "push"]);
    const push = calls.find((c) => c[1] === "push") ?? [];
    expect(push.some((a) => /^(-f|--force.*|--mirror)$/.test(a))).toBe(false);
    expect(push.some((a) => a.startsWith("+"))).toBe(false);
    expect(calls.some((c) => c[1] === "rebase")).toBe(false);
  });

  it("branch names follow the restart count", () => {
    const ws = new GitWorkspace(exec, { repoDir: "/tmp/r", worktreesDir: "/tmp/w", baseBranch: "main", remote: "origin" });
    const issue = { repo: "resume-sg", number: 47 } as never;
    expect(ws.branchForRun(issue, 0)).toBe("factory/resume-sg-47");
    expect(ws.branchForRun(issue, 1)).toBe("factory/resume-sg-47-r2");
    expect(ws.branchForRun(issue, 3)).toBe("factory/resume-sg-47-r4");
  });
});

describe("F04: a restart opens a new PR and closes only the coordinator's own earlier PR", () => {
  it("the restarted task gets factory/<repo>-<n>-r2 and a new PR; the old PR is closed with a link; others stay open", async () => {
    const r = await dryRun((f) => {
      f.issues = [{ number: 610, title: "High", labels: ["factory:ready", "risk:high"], body: "x" }];
      f.scenarios = {};
    });
    const issue = r.gh.issues.get("humyna-labs/resume-sg#610");
    const first = r.gh.pulls.get("humyna-labs/resume-sg:factory/resume-sg-610");
    if (!issue || !first) throw new Error("fixture");
    // Open PRs that must never be touched: another author on this task's branch name, and another task's branch.
    r.gh.foreignPulls.set("humyna-labs/resume-sg:factory/resume-sg-610-r9", { number: 7001, url: "u1", head: "factory/resume-sg-610-r9", author: "someone-else" });
    r.gh.foreignPulls.set("humyna-labs/resume-sg:factory/resume-sg-611", { number: 7002, url: "u2", head: "factory/resume-sg-611", author: FACTORY_LOGIN });
    r.gh.foreignPulls.set("humyna-labs/resume-sg:feature/resume-sg-610", { number: 7003, url: "u3", head: "feature/resume-sg-610", author: FACTORY_LOGIN });
    // The owner sends it back (the one-time label move of #47), then the task is restarted.
    issue.labels = issue.labels.filter((l) => !l.startsWith("factory:")).concat("factory:escalated");
    const { loadFactoryConfig } = await import("../src/config.ts");
    const { EventLog } = await import("../src/events.ts");
    const { RunsCsvWriter } = await import("../src/runs-csv.ts");
    const { StubRunner } = await import("../src/runner/stub.ts");
    const { StubGates } = await import("../src/gates/stub.ts");
    const cfg = loadFactoryConfig(join(r.repoDir, ".factory", "factory.yaml"));
    const d = { cfg, gh: r.gh, runner: new StubRunner({}), gates: new StubGates({}), workspace: new GitWorkspace(exec, { repoDir: r.repoDir, worktreesDir: r.paths.worktreesDir, baseBranch: "main", remote: "origin" }), exec, ledger: new RunsCsvWriter(r.paths.runsCsv), events: new EventLog(r.paths.events), paths: r.paths, now: () => new Date() };
    const { restartTask, runTask } = await import("../src/coordinator.ts");
    const res = await runTask(d, await restartTask(d, issue, "F04 test"));
    const second = r.gh.pulls.get("humyna-labs/resume-sg:factory/resume-sg-610-r2");
    expect(second).toBeDefined();
    expect(res.prUrl).toBe(second?.url);
    expect(second?.number).not.toBe(first.number);
    expect(r.gh.closedPulls).toEqual([{ number: first.number, comment: expect.stringContaining(`Superseded by ${second?.url ?? "?"}`) }]);
    expect([...r.gh.foreignPulls.values()].map((p) => p.number).sort()).toEqual([7001, 7002, 7003]);
    expect(r.gh.calls.some((c) => c.op === "merge" && c.args[2] === first.number)).toBe(false);
  });
});

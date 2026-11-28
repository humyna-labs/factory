// F07 and F08 (external review of v1.3): the scope and risk checks see every path a change touches, unquoted.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exec } from "../src/exec.ts";
import { outOfScope } from "../src/scope.ts";
import { GitWorkspace } from "../src/workspace/git.ts";
import { tmp } from "./helpers.ts";

const ID = ["-c", "user.name=bot", "-c", "user.email=bot@localhost", "-c", "commit.gpgsign=false", "-c", "core.quotepath=true"];
const git = (cwd: string, ...args: string[]) => execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8" }).trim();

function write(dir: string, rel: string, text: string): void {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

/** origin with main = tests/y.ts and src/a.ts, and a task worktree made by GitWorkspace. */
async function task() {
  const root = tmp("factory-scope-");
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, repo]);
  write(repo, "tests/y.ts", "export const t = 1;\n");
  write(repo, "src/a.ts", "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  git(repo, "push", "-q", "origin", "HEAD:main");
  const ws = new GitWorkspace(exec, { repoDir: repo, worktreesDir: join(root, "wts"), baseBranch: "main", remote: "origin" });
  const { worktree } = await ws.prepare({ owner: "humyna-labs", repo: "p", number: 3, title: "t", body: "", labels: [], state: "open" } as never);
  return { ws, wt: worktree };
}

describe("F07: the scope check sees the source of a rename", () => {
  it("a staged rename tests/y.ts -> src/x.ts lists both paths, and the builder is out of scope", async () => {
    const { ws, wt } = await task();
    git(wt, "mv", "tests/y.ts", "src/x.ts");
    const changed = await ws.changedFiles(wt);
    expect(changed.sort()).toEqual(["src/x.ts", "tests/y.ts"]);
    expect(await outOfScope(exec, "builder", wt, changed, [])).toContain("tests/y.ts");
  });

  it("an unstaged move (delete plus new file) lists both paths too", async () => {
    const { ws, wt } = await task();
    execFileSync("mv", [join(wt, "tests/y.ts"), join(wt, "src/x.ts")]);
    expect((await ws.changedFiles(wt)).sort()).toEqual(["src/x.ts", "tests/y.ts"]);
  });

  it("a builder change inside src/ alone stays in scope", async () => {
    const { ws, wt } = await task();
    write(wt, "src/a.ts", "export const a = 2;\n");
    const changed = await ws.changedFiles(wt);
    expect(changed).toEqual(["src/a.ts"]);
    expect(await outOfScope(exec, "builder", wt, changed, [])).toEqual([]);
  });
});

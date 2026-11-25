// One git worktree per task (R-03). The coordinator creates it; every role runs with it as cwd.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Exec } from "../exec.ts";
import type { Issue, LedgerRole } from "../types.ts";

export interface WorkspaceOptions {
  repoDir: string;
  worktreesDir: string;
  baseBranch: string;
  remote: string;
}

export class GitWorkspace {
  private readonly run: Exec;
  readonly o: WorkspaceOptions;
  constructor(run: Exec, o: WorkspaceOptions) {
    this.run = run;
    this.o = o;
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const r = await this.run("git", args, { cwd, kind: "git", timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim().split("\n")[0] ?? ""}`);
    return r.stdout;
  }

  branchFor(issue: Issue): string {
    return `factory/${issue.repo}-${issue.number}`;
  }

  async prepare(issue: Issue): Promise<{ worktree: string; branch: string }> {
    const branch = this.branchFor(issue);
    const worktree = join(this.o.worktreesDir, `${issue.repo}-${issue.number}`);
    if (!existsSync(worktree)) await this.git(this.o.repoDir, ["worktree", "add", "-B", branch, worktree, this.o.baseBranch]);
    return { worktree, branch };
  }

  /** Paths changed in the worktree since the last commit, including untracked files. */
  async changedFiles(worktree: string): Promise<string[]> {
    const out = await this.git(worktree, ["status", "--porcelain", "--untracked-files=all", "-z"]);
    const entries = out.split("\0").filter(Boolean);
    const files: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] ?? "";
      files.push(e.slice(3));
      if (e[0] === "R" || e[0] === "C") i++; // skip the rename source
    }
    return files;
  }

  async reset(worktree: string): Promise<void> {
    await this.git(worktree, ["reset", "--hard", "HEAD"]);
    await this.git(worktree, ["clean", "-fdq"]);
  }

  /** Commit everything with an ASCII message and the Agent-Role trailer (R-07). Returns false if nothing changed. */
  async commit(worktree: string, subject: string, role: LedgerRole): Promise<boolean> {
    if ((await this.changedFiles(worktree)).length === 0) return false;
    await this.git(worktree, ["add", "-A"]);
    await this.git(worktree, ["commit", "-q", "-m", subject.replace(/[^\x20-\x7E]/g, "?"), "-m", `Agent-Role: ${role}`]);
    return true;
  }

  async filesChangedFromBase(worktree: string): Promise<string[]> {
    return (await this.git(worktree, ["diff", "--name-only", `${this.o.baseBranch}...HEAD`])).split("\n").filter(Boolean);
  }

  async push(worktree: string, branch: string): Promise<void> {
    await this.git(worktree, ["push", "-q", "--force-with-lease", this.o.remote, `${branch}:refs/heads/${branch}`]);
  }
}

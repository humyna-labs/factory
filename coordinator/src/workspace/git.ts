// One git worktree per task (R-03). The coordinator creates it; every role runs with it as cwd.
// BL-05 / W2-05: product clones push through the factory pre-push hook, the worktree starts from
// the freshly fetched remote base, and finished worktrees are removed.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ChildKind } from "../env.ts";
import type { Exec } from "../exec.ts";
import type { Issue, LedgerRole } from "../types.ts";

export interface WorkspaceOptions {
  repoDir: string;
  worktreesDir: string;
  baseBranch: string;
  remote: string;
  /**
   * Directory set as core.hooksPath on the product clone (the factory .githooks, R-07). The dry
   * run leaves it unset because its local bare remote is not a GitHub URL, which the hook refuses.
   */
  pushHookPath?: string;
}

export class GitWorkspace {
  private readonly run: Exec;
  readonly o: WorkspaceOptions;
  constructor(run: Exec, o: WorkspaceOptions) {
    this.run = run;
    this.o = o;
  }

  private async git(cwd: string, args: string[], kind: ChildKind = "git"): Promise<string> {
    const r = await this.run("git", args, { cwd, kind, timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim().split("\n")[0] ?? ""}`);
    return r.stdout;
  }

  branchFor(issue: Issue): string {
    return `factory/${issue.repo}-${issue.number}`;
  }

  worktreeFor(issue: Issue): string {
    return join(this.o.worktreesDir, `${issue.repo}-${issue.number}`);
  }

  /** The remote-tracking base, for example origin/main. */
  get base(): string {
    return `${this.o.remote}/${this.o.baseBranch}`;
  }

  async prepare(issue: Issue): Promise<{ worktree: string; branch: string; reused: boolean }> {
    const branch = this.branchFor(issue);
    const worktree = this.worktreeFor(issue);
    if (this.o.pushHookPath) await this.git(this.o.repoDir, ["config", "core.hooksPath", this.o.pushHookPath]);
    if (existsSync(worktree)) return { worktree, branch, reused: true };
    await this.git(this.o.repoDir, ["fetch", "-q", this.o.remote]);
    await this.git(this.o.repoDir, ["worktree", "add", "-q", "-B", branch, worktree, this.base]);
    return { worktree, branch, reused: false };
  }

  /** Remove a finished worktree; the local branch stays for diagnosis. */
  async cleanup(worktree: string): Promise<void> {
    if (existsSync(worktree)) await this.git(this.o.repoDir, ["worktree", "remove", "--force", worktree]);
    await this.git(this.o.repoDir, ["worktree", "prune"]);
  }

  /** Worktree directories still on disk (needs-human tasks, or tasks stopped mid-way). */
  kept(): string[] {
    return existsSync(this.o.worktreesDir) ? readdirSync(this.o.worktreesDir).sort() : [];
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
    await this.git(worktree, ["reset", "-q", "--hard", "HEAD"]);
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
    return (await this.git(worktree, ["diff", "--name-only", `${this.base}...HEAD`])).split("\n").filter(Boolean);
  }

  async push(worktree: string, branch: string): Promise<void> {
    // The push alone gets GH_TOKEN: the credential helper is `gh auth git-credential`, and the
    // plain git env (R-05) has no token, so the first live push failed (jd2cv-m1, resume-sg#4).
    // Roles never reach this code; their settings deny git push.
    await this.git(worktree, ["push", "-q", "--force-with-lease", this.o.remote, `${branch}:refs/heads/${branch}`], "gh");
  }
}

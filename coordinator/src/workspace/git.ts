// One git worktree per task (R-03). The coordinator creates it; every role runs with it as cwd.
// BL-05 / W2-05: product clones push through the factory pre-push hook, the worktree starts from
// the freshly fetched remote base, and finished worktrees are removed.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildKind } from "../env.ts";
import type { Exec } from "../exec.ts";
import type { Issue, LedgerRole } from "../types.ts";

/** F16: file in the task worktree's git dir that holds the base SHA recorded at task start. */
export const BASE_FILE = "factory-base-sha";

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

  /**
   * F04 (owner, 2026-11-28): no force pushes, so a restarted task pushes to a new branch. The branch follows the
   * number of restarts of the task: none gives factory/<repo>-<n>, k restarts give factory/<repo>-<n>-r<k+1>. A plain
   * re-run (same count) keeps its branch and its open PR.
   */
  branchForRun(issue: Issue, restarts: number): string {
    const base = this.branchFor(issue);
    return restarts > 0 ? `${base}-r${restarts + 1}` : base;
  }

  async prepare(issue: Issue, restarts = 0): Promise<{ worktree: string; branch: string; reused: boolean }> {
    const worktree = this.worktreeFor(issue);
    if (this.o.pushHookPath) await this.git(this.o.repoDir, ["config", "core.hooksPath", this.o.pushHookPath]);
    // A reused worktree keeps the branch it was created on (factory/<repo>-<n>, or a -r<k> of a restart).
    if (existsSync(worktree)) return { worktree, branch: (await this.git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"])).trim(), reused: true };
    await this.git(this.o.repoDir, ["fetch", "-q", this.o.remote]);
    const branch = this.branchForRun(issue, restarts);
    await this.git(this.o.repoDir, ["worktree", "add", "-q", "-B", branch, worktree, this.base]);
    // F16: record the task's base SHA in the worktree's own git dir (untracked, gone with the worktree).
    const sha = (await this.git(worktree, ["rev-parse", "HEAD"])).trim();
    writeFileSync(join((await this.git(worktree, ["rev-parse", "--absolute-git-dir"])).trim(), BASE_FILE), `${sha}\n`);
    return { worktree, branch, reused: false };
  }

  /** F16: the base SHA recorded when the task worktree was created, or undefined (older worktree, unreadable). */
  async baseSha(worktree: string): Promise<string | undefined> {
    try {
      const file = join((await this.git(worktree, ["rev-parse", "--absolute-git-dir"])).trim(), BASE_FILE);
      const sha = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
      return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
    } catch {
      return undefined;
    }
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
  /**
   * F07: every path a change touches, including the source of a rename or copy. `--no-renames` reports a rename
   * as a deletion plus an addition; should git still print an R or C entry, its source (the next NUL field) is
   * returned too, so a builder cannot move tests/y.ts to src/x.ts and pass the scope check.
   */
  async changedFiles(worktree: string): Promise<string[]> {
    const out = await this.git(worktree, ["status", "--porcelain", "--no-renames", "--untracked-files=all", "-z"]);
    const entries = out.split("\0").filter(Boolean);
    const files: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] ?? "";
      files.push(e.slice(3));
      if (e[0] === "R" || e[0] === "C" || e[1] === "R" || e[1] === "C") {
        i++;
        const source = entries[i];
        if (source) files.push(source);
      }
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

  /**
   * F08: the paths the risk check rates. NUL-separated (`-z`), so a non-ASCII or unusual path is never returned in
   * git's quoted form ("src/ai/\346\226\207.ts" would not match src/ai/**), and --no-renames, so both sides of a
   * rename are rated.
   */
  /** F01a: commit only the given paths (never `git add -A`). Returns false if they had no change. */
  async commitPaths(worktree: string, paths: string[], subject: string, role: LedgerRole): Promise<boolean> {
    await this.git(worktree, ["add", "--", ...paths]);
    if (!(await this.git(worktree, ["diff", "--cached", "--name-only"])).trim()) return false;
    await this.git(worktree, ["commit", "-q", "-m", subject.replace(/[^\x20-\x7E]/g, "?"), "-m", `Agent-Role: ${role}`, "--", ...paths]);
    return true;
  }

  async filesChangedFromBase(worktree: string): Promise<string[]> {
    return (await this.git(worktree, ["diff", "--no-renames", "--name-only", "-z", `${this.base}...HEAD`])).split("\0").filter(Boolean);
  }

  /**
   * F04 (owner, 2026-11-28): never a force push. If the remote branch has commits the local one lacks (for example
   * the merge commit of the owner's "Update branch"), they are merged in (never rebased), then the push is a
   * fast-forward. A merge that does not apply cleanly is aborted and fails the push.
   */
  async push(worktree: string, branch: string): Promise<void> {
    // Network calls get GH_TOKEN (kind "gh"): the credential helper is `gh auth git-credential`, and the
    // plain git env (R-05) has no token, so the first live push failed (jd2cv-m1, resume-sg#4).
    // Roles never reach this code; their settings deny git push.
    const tracking = `refs/remotes/${this.o.remote}/${branch}`;
    const onRemote = (await this.git(worktree, ["ls-remote", "--heads", this.o.remote, `refs/heads/${branch}`], "gh")).trim() !== "";
    if (onRemote) {
      await this.git(worktree, ["fetch", "-q", this.o.remote, `+refs/heads/${branch}:${tracking}`], "gh");
      const opts = { cwd: worktree, kind: "git" as const, timeoutMs: 120_000 };
      const contained = await this.run("git", ["merge-base", "--is-ancestor", tracking, "HEAD"], opts);
      if (contained.code !== 0) {
        const m = await this.run("git", ["merge", "--no-ff", "--no-edit", "-m", `Merge ${this.o.remote}/${branch} into ${branch}`, "-m", "Agent-Role: coordinator", tracking], opts);
        if (m.code !== 0) {
          await this.run("git", ["merge", "--abort"], opts);
          throw new Error(`the remote branch ${branch} has commits that do not merge cleanly; not pushed (no force push, F04)`);
        }
      }
    }
    await this.git(worktree, ["push", "-q", this.o.remote, `${branch}:refs/heads/${branch}`], "gh");
  }
}

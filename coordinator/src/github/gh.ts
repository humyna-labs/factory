// gh CLI adapter. Written and unit-tested for command assembly; not run against GitHub in Phase 1.
import type { Exec } from "../exec.ts";
import type { Issue } from "../types.ts";
import type { ChecksState, GitHubAdapter, PullRequest } from "./types.ts";

const TIMEOUT_MS = 60_000;

interface GhLabel {
  name: string;
}
interface GhIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: GhLabel[];
  author?: { login?: string } | null;
}

export class GhGitHub implements GitHubAdapter {
  readonly name = "gh" as const;
  private readonly run: Exec;
  constructor(run: Exec) {
    this.run = run;
  }

  private async gh(args: string[], input?: string): Promise<string> {
    const r = await this.run("gh", args, { kind: "gh", timeoutMs: TIMEOUT_MS, ...(input === undefined ? {} : { input }) });
    if (r.timedOut) throw new Error(`gh ${args[0]} ${args[1] ?? ""} timed out`);
    if (r.code !== 0) throw new Error(`gh ${args[0]} ${args[1] ?? ""} failed (${r.code}): ${r.stderr.trim().split("\n")[0] ?? ""}`);
    return r.stdout;
  }

  private toIssue(owner: string, repo: string, g: GhIssue): Issue {
    return { owner, repo, number: g.number, title: g.title, body: g.body, labels: g.labels.map((l) => l.name), state: g.state.toLowerCase() === "open" ? "open" : "closed", ...(g.author?.login ? { author: g.author.login } : {}) };
  }

  async listOpenIssues(owner: string, repo: string, label: string): Promise<Issue[]> {
    const out = await this.gh(["issue", "list", "-R", `${owner}/${repo}`, "--state", "open", "--label", label, "--limit", "100", "--json", "number,title,body,state,labels,author"]);
    return (JSON.parse(out) as GhIssue[]).map((g) => this.toIssue(owner, repo, g));
  }

  async getIssue(owner: string, repo: string, number: number): Promise<Issue> {
    const out = await this.gh(["issue", "view", String(number), "-R", `${owner}/${repo}`, "--json", "number,title,body,state,labels,author"]);
    return this.toIssue(owner, repo, JSON.parse(out) as GhIssue);
  }

  async setLabels(owner: string, repo: string, number: number, add: string[], remove: string[]): Promise<void> {
    const args = ["issue", "edit", String(number), "-R", `${owner}/${repo}`];
    if (add.length) args.push("--add-label", add.join(","));
    if (remove.length) args.push("--remove-label", remove.join(","));
    await this.gh(args);
  }

  async comment(owner: string, repo: string, number: number, body: string): Promise<void> {
    await this.gh(["issue", "comment", String(number), "-R", `${owner}/${repo}`, "--body-file", "-"], body);
  }

  async createIssue(owner: string, repo: string, title: string, body: string, labels: string[]): Promise<{ number: number; url: string }> {
    const out = await this.gh(["issue", "create", "-R", `${owner}/${repo}`, "--title", title, "--body-file", "-", "--label", labels.join(",")], body);
    const url = out.trim().split("\n").pop() ?? "";
    return { number: Number(url.split("/").pop()), url };
  }

  async findOrOpenPullRequest(owner: string, repo: string, head: string, base: string, title: string, body: string): Promise<PullRequest> {
    const R = `${owner}/${repo}`;
    const found = JSON.parse(await this.gh(["pr", "list", "-R", R, "--head", head, "--state", "open", "--json", "number,url,labels"])) as { number: number; url: string; labels: GhLabel[] }[];
    const first = found[0];
    if (first) return { number: first.number, url: first.url, head, merged: false, autoMerge: false, labels: first.labels.map((l) => l.name) };
    const url = (await this.gh(["pr", "create", "-R", R, "--head", head, "--base", base, "--title", title, "--body-file", "-"], body)).trim().split("\n").pop() ?? "";
    return { number: Number(url.split("/").pop()), url, head, merged: false, autoMerge: false, labels: [] };
  }

  async checks(owner: string, repo: string, pr: number): Promise<ChecksState> {
    const r = await this.run("gh", ["pr", "checks", String(pr), "-R", `${owner}/${repo}`, "--json", "bucket"], { kind: "gh", timeoutMs: TIMEOUT_MS });
    if (r.code !== 0 && r.stdout.trim() === "") return "pending";
    const buckets = (JSON.parse(r.stdout || "[]") as { bucket: string }[]).map((b) => b.bucket);
    if (buckets.some((b) => b === "fail" || b === "cancel")) return "failure";
    if (buckets.length === 0 || buckets.some((b) => b === "pending")) return "pending";
    return "success";
  }

  /** Enables GitHub auto-merge: GitHub merges once required checks pass. */
  async merge(owner: string, repo: string, pr: number): Promise<{ merged: boolean; autoMerge: boolean }> {
    await this.gh(["pr", "merge", String(pr), "-R", `${owner}/${repo}`, "--squash", "--auto", "--delete-branch"]);
    return { merged: false, autoMerge: true };
  }
}

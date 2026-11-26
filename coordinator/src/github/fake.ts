import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Issue } from "../types.ts";
import type { ChecksState, GitHubAdapter, PullRequest } from "./types.ts";

interface Call {
  op: string;
  args: unknown[];
}

/** In-memory GitHub for dry runs and tests. Records every call. */
export class FakeGitHub implements GitHubAdapter {
  readonly name = "fake" as const;
  readonly calls: Call[] = [];
  readonly issues = new Map<string, Issue>();
  readonly comments = new Map<string, string[]>();
  readonly pulls = new Map<string, PullRequest>();
  checksState: ChecksState = "success";
  private nextNumber = 1000;

  private readonly stateFile: string | undefined;

  /** With stateFile, state survives a killed process (dry-run resume, W2-06): loaded if present, written after every change. */
  constructor(seed: Issue[] = [], stateFile?: string) {
    this.stateFile = stateFile;
    if (stateFile && existsSync(stateFile)) {
      const s = JSON.parse(readFileSync(stateFile, "utf8")) as { issues: Issue[]; pulls: [string, PullRequest][]; comments: [string, string[]][]; nextNumber: number };
      for (const i of s.issues) this.issues.set(this.key(i.owner, i.repo, i.number), i);
      for (const [k, p] of s.pulls) this.pulls.set(k, p);
      for (const [k, c] of s.comments) this.comments.set(k, c);
      this.nextNumber = s.nextNumber;
      return;
    }
    for (const i of seed) this.issues.set(this.key(i.owner, i.repo, i.number), { ...i, labels: [...i.labels] });
    this.persist();
  }

  private persist(): void {
    if (!this.stateFile) return;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify({ issues: [...this.issues.values()], pulls: [...this.pulls.entries()], comments: [...this.comments.entries()], nextNumber: this.nextNumber }));
  }

  private key(owner: string, repo: string, n: number): string {
    return `${owner}/${repo}#${n}`;
  }

  private record(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args });
  }

  async listOpenIssues(owner: string, repo: string, label: string): Promise<Issue[]> {
    this.record("listOpenIssues", owner, repo, label);
    return [...this.issues.values()].filter((i) => i.owner === owner && i.repo === repo && i.state === "open" && i.labels.includes(label));
  }

  async getIssue(owner: string, repo: string, number: number): Promise<Issue> {
    const i = this.issues.get(this.key(owner, repo, number));
    if (!i) throw new Error(`fake: no issue ${owner}/${repo}#${number}`);
    return i;
  }

  async setLabels(owner: string, repo: string, number: number, add: string[], remove: string[]): Promise<void> {
    this.record("setLabels", owner, repo, number, add, remove);
    const pr = [...this.pulls.values()].find((p) => p.number === number);
    if (pr) {
      pr.labels = [...new Set([...pr.labels.filter((l) => !remove.includes(l)), ...add])];
      this.persist();
      return;
    }
    const i = await this.getIssue(owner, repo, number);
    i.labels = [...new Set([...i.labels.filter((l) => !remove.includes(l)), ...add])];
    this.persist();
  }

  async comment(owner: string, repo: string, number: number, body: string): Promise<void> {
    this.record("comment", owner, repo, number);
    const k = this.key(owner, repo, number);
    this.comments.set(k, [...(this.comments.get(k) ?? []), body]);
    this.persist();
  }

  async createIssue(owner: string, repo: string, title: string, body: string, labels: string[]): Promise<{ number: number; url: string }> {
    this.record("createIssue", owner, repo, title, labels);
    const number = this.nextNumber++;
    this.issues.set(this.key(owner, repo, number), { owner, repo, number, title, body, labels, state: "open" });
    this.persist();
    return { number, url: `https://github.com/${owner}/${repo}/issues/${number}` };
  }

  /** Body of each pull request when it was opened, by head branch (tests only, not persisted). */
  readonly prBodies = new Map<string, string>();

  async findOrOpenPullRequest(owner: string, repo: string, head: string, _base: string, _title: string, body: string): Promise<PullRequest> {
    this.record("findOrOpenPullRequest", owner, repo, head);
    const k = `${owner}/${repo}:${head}`;
    const existing = this.pulls.get(k);
    if (existing) return existing;
    const number = this.nextNumber++;
    const pr: PullRequest = { number, url: `https://github.com/${owner}/${repo}/pull/${number}`, head, merged: false, autoMerge: false, labels: [] };
    this.pulls.set(k, pr);
    this.prBodies.set(head, body);
    this.persist();
    return pr;
  }

  async checks(owner: string, repo: string, pr: number): Promise<ChecksState> {
    this.record("checks", owner, repo, pr);
    return this.checksState;
  }

  async merge(owner: string, repo: string, pr: number): Promise<{ merged: boolean; autoMerge: boolean }> {
    this.record("merge", owner, repo, pr);
    const found = [...this.pulls.values()].find((p) => p.number === pr);
    if (!found) throw new Error(`fake: no pull request ${pr}`);
    found.merged = true;
    this.persist();
    return { merged: true, autoMerge: false };
  }

  closeIssue(owner: string, repo: string, number: number): void {
    const i = this.issues.get(this.key(owner, repo, number));
    if (i) i.state = "closed";
    this.persist();
  }
}

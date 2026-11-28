import type { Issue } from "../types.ts";

export interface PullRequest {
  number: number;
  url: string;
  head: string;
  merged: boolean;
  autoMerge: boolean;
  labels: string[];
}

/** F04: the login of the factory's machine account; the coordinator closes only pull requests it opened. */
export const FACTORY_LOGIN = "humyna-bot";

export interface OpenPullRequest {
  number: number;
  url: string;
  head: string;
  author: string;
}

export type ChecksState = "success" | "failure" | "pending";

/** Where a pull request stands; mergeState is GitHub's mergeStateStatus (CLEAN, BLOCKED, DIRTY, ...). */
export interface PullRequestState {
  state: "open" | "merged" | "closed";
  mergeState: string;
}

/**
 * GitHub access for the coordinator only. Role runners never receive this object (R-02):
 * merge and state labels are changed only by deterministic coordinator code.
 */
export interface GitHubAdapter {
  readonly name: "fake" | "gh";
  listOpenIssues(owner: string, repo: string, label: string): Promise<Issue[]>;
  getIssue(owner: string, repo: string, number: number): Promise<Issue>;
  setLabels(owner: string, repo: string, number: number, add: string[], remove: string[]): Promise<void>;
  comment(owner: string, repo: string, number: number, body: string): Promise<void>;
  createIssue(owner: string, repo: string, title: string, body: string, labels: string[]): Promise<{ number: number; url: string }>;
  findOrOpenPullRequest(owner: string, repo: string, head: string, base: string, title: string, body: string): Promise<PullRequest>;
  /** F04: open pull requests with their head branch and author login. */
  listOpenPullRequests(owner: string, repo: string): Promise<OpenPullRequest[]>;
  /** F04: close (never merge) a pull request with a comment. Only for the coordinator's own superseded PRs. */
  closePullRequest(owner: string, repo: string, pr: number, comment: string): Promise<void>;
  checks(owner: string, repo: string, pr: number): Promise<ChecksState>;
  /** Read-only: whether an auto-merge has landed (queue waits for it, jd2cv-m1). */
  pullRequestState(owner: string, repo: string, pr: number): Promise<PullRequestState>;
  /** Low-risk only; the caller (coordinator/src/merge.ts) enforces that. */
  merge(owner: string, repo: string, pr: number): Promise<{ merged: boolean; autoMerge: boolean }>;
}

import type { Issue } from "../types.ts";

export interface PullRequest {
  number: number;
  url: string;
  head: string;
  merged: boolean;
  autoMerge: boolean;
  labels: string[];
}

export type ChecksState = "success" | "failure" | "pending";

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
  checks(owner: string, repo: string, pr: number): Promise<ChecksState>;
  /** Low-risk only; the caller (coordinator/src/merge.ts) enforces that. */
  merge(owner: string, repo: string, pr: number): Promise<{ merged: boolean; autoMerge: boolean }>;
}

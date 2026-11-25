// R-02: the single merge path. Only the coordinator imports this file (test/structure.test.ts).
import type { GitHubAdapter } from "./github/types.ts";
import type { Risk } from "./state.ts";

export class MergeRefused extends Error {}

export async function mergeLowRisk(
  gh: GitHubAdapter,
  owner: string,
  repo: string,
  pr: number,
  risk: Risk,
): Promise<{ merged: boolean; autoMerge: boolean }> {
  // Defence in depth: even if a caller gets the risk wrong upstream, high risk never merges here.
  if (risk !== "low") throw new MergeRefused(`refusing to merge ${owner}/${repo}#${pr}: risk is ${risk}; a human must approve`);
  const state = await gh.checks(owner, repo, pr);
  if (state === "failure") throw new MergeRefused(`refusing to merge ${owner}/${repo}#${pr}: required checks failed`);
  return gh.merge(owner, repo, pr);
}

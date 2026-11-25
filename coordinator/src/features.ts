// BL-04 / W2-07 (P-06): only the coordinator's verify stage marks a feature as passing. Roles are
// blocked from feature_list.json by path-guard R4. Minimal schema; extra fields pass through so
// the initializer role (BL-12) can add its own.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Issue } from "./types.ts";

export const FeatureSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().optional(),
  passes: z.boolean(),
  verified_at: z.string().optional(),
});
export const FeatureListSchema = z.looseObject({ features: z.array(FeatureSchema) });
export type FeatureList = z.infer<typeof FeatureListSchema>;

export const FEATURE_LIST = "feature_list.json";

/** The feature an issue implements: a body line "Feature: <id>". */
export function featureOf(issue: Pick<Issue, "body">): string | undefined {
  return /^Feature:\s*(\S+)\s*$/m.exec(issue.body)?.[1];
}

export type MarkResult = "updated" | "unchanged" | "no-feature" | "missing-file" | "unknown-feature";

/** Set passes for one feature in <worktree>/feature_list.json. Throws if the file breaks the schema. */
export function markFeature(worktree: string, id: string | undefined, passes: boolean, at: string): MarkResult {
  if (!id) return "no-feature";
  const path = join(worktree, FEATURE_LIST);
  if (!existsSync(path)) return "missing-file";
  const list = FeatureListSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const f = list.features.find((x) => x.id === id);
  if (!f) return "unknown-feature";
  if (f.passes === passes) return "unchanged";
  f.passes = passes;
  if (passes) f.verified_at = at;
  else delete f.verified_at;
  writeFileSync(path, JSON.stringify(list, null, 2) + "\n");
  return "updated";
}

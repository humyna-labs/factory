// Issue-scoped write grants for the builder (jd2cv-m1, owner decision 2026-11-26, option 1).
// An issue line "Grants: public/_headers, src/security/**" lets the builder write those protected
// product paths. A grant counts only when all of these hold (owner condition c):
//   - the issue is labelled risk:high (so its PR always waits for the owner);
//   - the one Grants line lists only entries of GRANTABLE;
//   - the issue was opened by an account in GRANT_AUTHORS.
// Otherwise no path is granted. hooks/path-guard.sh (rule G1) re-checks the same three entries.
import type { Issue } from "./types.ts";
import { matchesAny } from "./risk.ts";

export const GRANTABLE = ["public/_headers", "src/security/**", "src/templates/**"] as const;
export type Grant = (typeof GRANTABLE)[number];
export const GRANT_AUTHORS = ["humyna-bot", "humyna"] as const;

/** What the reviewer must check for each granted path (owner condition c). */
export const GRANT_REVIEW: Record<Grant, string> = {
  "public/_headers":
    "public/_headers: the diff changes only the connect-src directive of the CSP, and only by adding https://api.anthropic.com; every other directive and line stays exactly as on the base branch. FAIL otherwise.",
  "src/security/**":
    "src/security/**: the API key never appears in a log (console.*), a URL, an error text, the preview or an export, on any code path. FAIL otherwise.",
  "src/templates/**":
    "src/templates/**: no images, fonts or external resources (no url(, @import, @font-face, http or https URL, img, link, picture, background-image, font file). FAIL otherwise.",
};

export interface GrantDecision {
  grants: Grant[];
  /** Why a Grants line was not accepted; undefined when there was none or it was accepted. */
  refused?: string;
}

export function decideGrants(issue: Pick<Issue, "body" | "labels" | "author">): GrantDecision {
  const lines = [...issue.body.matchAll(/^Grants:(.*)$/gm)].map((m) => (m[1] ?? "").trim());
  if (lines.length === 0) return { grants: [] };
  if (lines.length > 1) return { grants: [], refused: "more than one Grants line" };
  if (!issue.labels.includes("risk:high")) return { grants: [], refused: "the issue is not labelled risk:high" };
  if (!issue.author || !(GRANT_AUTHORS as readonly string[]).includes(issue.author)) return { grants: [], refused: `the issue was opened by ${issue.author ?? "an unknown author"}, not by ${GRANT_AUTHORS.join(" or ")}` };
  const entries = (lines[0] ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return { grants: [], refused: "the Grants line is empty" };
  const bad = entries.filter((e) => !(GRANTABLE as readonly string[]).includes(e));
  if (bad.length) return { grants: [], refused: `not grantable: ${bad.join(", ")} (only ${GRANTABLE.join(", ")})` };
  return { grants: [...new Set(entries)] as Grant[] };
}

/** Changed paths that only a grant made writable, for the top of the PR body. */
export function grantedChanges(changed: readonly string[], grants: readonly Grant[]): string[] {
  return changed.filter((p) => matchesAny(p, grants) !== undefined);
}

// Risk = max(issue label, changed paths). Missing label counts as high (P-11).
import type { Risk } from "./state.ts";

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? "";
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: readonly string[]): string | undefined {
  return globs.find((g) => globToRegExp(g).test(path));
}

export function labelRisk(labels: readonly string[]): Risk {
  if (labels.includes("risk:high")) return "high";
  if (labels.includes("risk:low")) return "low";
  return "high";
}

export interface RiskDecision {
  risk: Risk;
  reasons: string[];
}

export function assessRisk(labels: readonly string[], changed: readonly string[], highRiskPaths: readonly string[]): RiskDecision {
  const reasons: string[] = [];
  const fromLabel = labelRisk(labels);
  if (fromLabel === "high") reasons.push(labels.includes("risk:high") ? "issue labelled risk:high" : "issue has no risk label");
  for (const p of changed) {
    const g = matchesAny(p, highRiskPaths);
    if (g) reasons.push(`${p} matches high-risk path ${g}`);
  }
  return { risk: reasons.length ? "high" : "low", reasons };
}

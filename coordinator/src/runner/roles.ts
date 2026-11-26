import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { factoryPath } from "../paths.ts";
import type { Role } from "../types.ts";
import { GRANT_REVIEW, type Grant } from "../grants.ts";
import type { RoleConfig, RoleSession } from "./types.ts";

const FrontMatter = z
  .object({
    role: z.enum(["qa", "builder", "reviewer", "compliance"]),
    model: z.string().min(1),
    max_turns: z.number().int().positive(),
    max_budget_usd: z.number().positive(),
    settings: z.string().min(1),
    disallowed_tools: z.array(z.string()).default([]),
    writes: z.array(z.string()),
  })
  .strict();

export function parseRoleFile(text: string, file: string): RoleConfig & { writes: string[] } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m?.[1]) throw new Error(`${file}: missing YAML front matter`);
  const fm = FrontMatter.parse(parse(m[1]));
  return {
    role: fm.role,
    model: fm.model,
    maxTurns: fm.max_turns,
    maxBudgetUsd: fm.max_budget_usd,
    settings: factoryPath(fm.settings),
    disallowedTools: fm.disallowed_tools,
    promptFile: file,
    writes: fm.writes,
  };
}

export function loadRoleConfig(role: Role): RoleConfig & { writes: string[] } {
  const file = factoryPath("roles", `${role}.md`);
  return parseRoleFile(readFileSync(file, "utf8"), file);
}

const OBJECTIVE: Record<Role, string> = {
  qa: "Write tests for this task under tests/ (and eval cases under evals/) that FAIL against the current code. Use synthetic data only.",
  builder: "Make the failing tests pass by changing src/ only. Do not modify tests. One feature only.",
  reviewer: "Review the diff of this branch against the base branch. Read only. Pass only if you would approve it.",
  compliance: "Check the diff for privacy, licence, secret and security-header problems. Read only. Pass only if nothing blocks.",
};

/** The user prompt for one session (P-09: objective, output, tools, boundaries). */
export function sessionPrompt(s: RoleSession, baseBranch: string): string {
  const lines = [
    `Task: ${s.issue.repo}#${s.issue.number}: ${s.issue.title}`,
    `Stage: ${s.stage}, attempt ${s.attempt} of ${s.maxAttempts}. Role: ${s.role}.`,
    `Worktree: ${s.worktree} (branch ${s.branch}, base ${baseBranch}).`,
    `Objective: ${OBJECTIVE[s.role]}`,
  ];
  if (s.previousFailure) lines.push(`Previous attempt failed: ${s.previousFailure}`);
  if (s.grants?.length && (s.role === "builder" || s.role === "reviewer")) {
    lines.push("", `Granted protected paths for this issue (Grants line, owner-approved): ${s.grants.join(", ")}.`);
    if (s.role === "builder") lines.push("You may write these paths too, with the Write and Edit tools (shell commands still may not name src/security or src/templates, B3). Change them only as far as the issue needs; every changed granted path is listed at the top of the PR for the owner.");
    else lines.push("Check every granted path that changed (git diff of the branch against the base), and FAIL if any check fails:", ...s.grants.map((g) => `- ${GRANT_REVIEW[g as Grant] ?? `${g}: not a grantable path; FAIL.`}`));
  }
  lines.push(
    "",
    "Issue body:",
    s.issue.body.trim() || "(empty)",
    "",
    `Report (required, R-20): write it to ${s.reportPath} from ${factoryPath("docs", "templates", "run-report.md")}.`,
    "Sections 5 to 8 must not be empty. The stage fails if the report is missing.",
    "Your final message must start with PASS or FAIL, then one line of reason.",
    "Boundaries: do not commit, push, merge, or change labels; the coordinator does that. Never wait for input.",
  );
  return lines.join("\n");
}

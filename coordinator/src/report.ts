// R-20: every role session must leave a report written from docs/templates/run-report.md.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Stage } from "./state.ts";

export const REQUIRED_SECTIONS = [
  "## 5. Surprises",
  "## 6. Reusable practices",
  "## 7. Proposed principle changes",
  "## 8. Proposed harness fixes",
] as const;

export function handoffId(repo: string, issue: number, stage: Stage, attempt: number): string {
  return `${repo}-${issue}-${stage}-${attempt}`;
}

export function reportPath(reportsDir: string, repo: string, issue: number, stage: Stage, attempt: number, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return join(reportsDir, `${repo}-${issue}`, `${day}-${handoffId(repo, issue, stage, attempt)}.md`);
}

function sectionBody(text: string, heading: string): string | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(heading));
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").replace(/<!--[\s\S]*?-->/g, "").trim();
}

export interface ReportCheck {
  ok: boolean;
  problems: string[];
  /** First proposed harness fix (first table data row or bullet of section 8), if any. */
  proposedHarnessFix?: string;
}

export function checkReport(path: string): ReportCheck {
  if (!existsSync(path)) return { ok: false, problems: [`report missing at ${path}`] };
  const text = readFileSync(path, "utf8");
  const problems: string[] = [];
  for (const h of REQUIRED_SECTIONS) {
    const body = sectionBody(text, h);
    if (body === undefined) problems.push(`missing section "${h}"`);
    else if (body === "") problems.push(`empty section "${h}" (write "none" only if truly none)`);
  }
  const s8 = sectionBody(text, "## 8. Proposed harness fixes") ?? "";
  let proposedHarnessFix: string | undefined;
  for (const line of s8.split("\n")) {
    const t = line.trim();
    if (t.startsWith("|") && !/^\|[\s|:-]+\|$/.test(t) && !/^\|\s*Problem\s*\|/i.test(t)) {
      const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) proposedHarnessFix = `${cells[0]}: ${cells[1]}`;
    } else if (/^[-*]\s+\S/.test(t)) proposedHarnessFix = t.replace(/^[-*]\s+/, "");
    if (proposedHarnessFix) break;
  }
  if (proposedHarnessFix && /^none\.?$/i.test(proposedHarnessFix)) proposedHarnessFix = undefined;
  return proposedHarnessFix === undefined ? { ok: problems.length === 0, problems } : { ok: problems.length === 0, problems, proposedHarnessFix };
}

export const REPORT_INDEX_HEADER = "| path | repo | issue | stage | attempt | utc |\n|---|---|---|---|---|---|\n";

/**
 * W2-10: one line per role-session report in <reportsDir>/INDEX.md, for the human's harvest
 * script (the reports live outside git). Append-only; the header is written once. Roles cannot
 * write this file (path-guard R1 allows only <reportsDir>/<task>/<name>.md).
 */
export function appendReportIndex(reportsDir: string, e: { path: string; repo: string; issue: number; stage: Stage; attempt: number; utc: string }): string {
  const index = join(reportsDir, "INDEX.md");
  mkdirSync(reportsDir, { recursive: true });
  if (!existsSync(index)) appendFileSync(index, REPORT_INDEX_HEADER);
  const cell = (v: string | number) => String(v).replace(/[|\n\r]/g, " ");
  appendFileSync(index, `| ${cell(e.path)} | ${cell(e.repo)} | ${e.issue} | ${e.stage} | ${e.attempt} | ${cell(e.utc)} |\n`);
  return index;
}

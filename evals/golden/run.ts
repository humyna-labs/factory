// Golden-task runner (spec 3.7): run every case in evals/golden/ and compare the end state with
// expected.json (P-10: judged on end state). Phase 1 supports --runner stub only; the claude mode
// is in docs/backlog.md (it needs live sessions).
//   node evals/golden/run.ts [--runner stub]
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture, runFixture } from "../../coordinator/src/index.ts";
import { parseCsv, validateRunsCsv } from "../../coordinator/src/runs-csv.ts";

export interface Expected {
  final: string;
  stages: string[];
  merged: boolean;
  escalated: boolean;
  labels: string[];
  reports: number;
}

export interface CaseResult {
  name: string;
  ok: boolean;
  problems: string[];
}

export const GOLDEN_DIR = import.meta.dirname;

export async function runGoldenCase(dir: string): Promise<CaseResult> {
  const name = dir.split("/").pop() ?? dir;
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Expected;
  const fixture = loadFixture(join(dir, "task.json"));
  const runsDir = mkdtempSync(join(tmpdir(), "factory-golden-"));
  const problems: string[] = [];
  try {
    const r = await runFixture({ fixture, runsDir, maxHours: 1 });
    const csv = readFileSync(r.paths.runsCsv, "utf8");
    problems.push(...validateRunsCsv(csv).map((e) => `runs.csv: ${e}`));
    const rows = parseCsv(csv).slice(1);
    const stages = rows.map((x) => `${x[1]}:${x[7]}`);
    if (JSON.stringify(stages) !== JSON.stringify(expected.stages)) problems.push(`stages ${stages.join(",")} != ${expected.stages.join(",")}`);
    const final = rows.at(-1)?.[7];
    if (final !== expected.final) problems.push(`final ${final} != ${expected.final}`);
    const merged = [...r.gh.pulls.values()].some((p) => p.merged);
    if (merged !== expected.merged) problems.push(`merged ${merged} != ${expected.merged}`);
    if (rows.some((x) => x[8] === "true") !== expected.escalated) problems.push("escalated flag differs");
    const issue = [...r.gh.issues.values()].find((i) => i.repo === fixture.product && i.number === fixture.issues[0]?.number);
    const labels = issue?.labels.filter((l) => l.startsWith("factory:")) ?? [];
    if (JSON.stringify(labels) !== JSON.stringify(expected.labels)) problems.push(`labels ${labels.join(",")} != ${expected.labels.join(",")}`);
    const reports = readdirSync(r.paths.reportsDir, { recursive: true }).filter((f) => String(f).endsWith(".md") && String(f).includes("/")).length; // role reports only, not INDEX.md (W2-10)
    if (reports !== expected.reports) problems.push(`reports ${reports} != ${expected.reports}`);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
  return { name, ok: problems.length === 0, problems };
}

export async function runAll(): Promise<CaseResult[]> {
  const dirs = readdirSync(GOLDEN_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(GOLDEN_DIR, d.name));
  const out: CaseResult[] = [];
  for (const d of dirs.sort()) out.push(await runGoldenCase(d));
  return out;
}

if (process.argv[1] === import.meta.filename) {
  const runner = process.argv.includes("--runner") ? process.argv[process.argv.indexOf("--runner") + 1] : "stub";
  if (runner !== "stub") {
    console.error("golden: only --runner stub exists in Phase 1 (claude mode is a backlog item)");
    process.exit(64);
  }
  const results = await runAll();
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.problems.length ? "\n  " + r.problems.join("\n  ") : ""}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

// R-10: the runs.csv contract. Append-only writer plus a validator used by the schema test.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { STATES } from "./state.ts";

export const RUNS_HEADER = "task,stage,role,start,end,turns,cost,outcome,escalated,harness_fix";
export const OUTCOMES = ["pass", "fail", "auto-merge", "needs-human", "escalated"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const LEDGER_ROLES = ["qa", "builder", "reviewer", "compliance", "coordinator"] as const;

export interface RunRow {
  task: string;
  stage: string;
  role: string;
  start: string;
  end: string;
  turns: number;
  cost: number;
  outcome: Outcome;
  escalated: boolean;
  harness_fix: string;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const TASK = /^[a-z0-9][a-z0-9._-]*#[0-9]+$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;
export const HARNESS_FIX_MAX = 200;

/** ISO 8601 UTC with second precision, for example 2026-11-25T02:30:00Z. */
export function isoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Make a value safe for the harness_fix column: one printable ASCII line, no email, capped. */
export function sanitizeHarnessFix(text: string): string {
  const oneLine = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(EMAIL, "<email removed>")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length > HARNESS_FIX_MAX ? oneLine.slice(0, HARNESS_FIX_MAX - 3) + "..." : oneLine;
}

/** Return the list of contract violations for one row (empty when valid). */
export function validateRow(r: Record<string, string>): string[] {
  const e: string[] = [];
  if (!TASK.test(r.task ?? "")) e.push(`task must look like repo#123, got "${r.task}"`);
  if (!(STATES as readonly string[]).includes(r.stage ?? "") || r.stage === "ready") e.push(`stage invalid: "${r.stage}"`);
  if (!(LEDGER_ROLES as readonly string[]).includes(r.role ?? "")) e.push(`role invalid: "${r.role}"`);
  for (const k of ["start", "end"] as const) if (!ISO_UTC.test(r[k] ?? "")) e.push(`${k} not ISO 8601 UTC: "${r[k]}"`);
  if (ISO_UTC.test(r.start ?? "") && ISO_UTC.test(r.end ?? "") && (r.end ?? "") < (r.start ?? "")) e.push("end before start");
  if (!/^\d+$/.test(r.turns ?? "")) e.push(`turns must be a non-negative integer: "${r.turns}"`);
  if (!/^\d+(\.\d+)?$/.test(r.cost ?? "")) e.push(`cost must be a non-negative decimal: "${r.cost}"`);
  if (!(OUTCOMES as readonly string[]).includes(r.outcome ?? "")) e.push(`outcome invalid: "${r.outcome}"`);
  if (r.escalated !== "true" && r.escalated !== "false") e.push(`escalated must be true or false: "${r.escalated}"`);
  if ((r.escalated === "true") !== (r.outcome === "escalated")) e.push("escalated=true if and only if outcome=escalated");
  const hf = r.harness_fix ?? "";
  if (r.escalated === "true" && hf.trim() === "") e.push("escalated row needs a one-line harness_fix (R-09)");
  if (r.escalated === "false" && hf !== "") e.push("harness_fix only on escalated rows");
  if (!PRINTABLE_ASCII.test(hf)) e.push("harness_fix must be one printable ASCII line");
  if (hf.length > HARNESS_FIX_MAX) e.push(`harness_fix longer than ${HARNESS_FIX_MAX}`);
  for (const [k, v] of Object.entries(r)) if (EMAIL.test(v)) e.push(`no personal data: email-like value in ${k}`);
  return e;
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function rowToRecord(row: RunRow): Record<string, string> {
  return {
    task: row.task,
    stage: row.stage,
    role: row.role,
    start: row.start,
    end: row.end,
    turns: String(row.turns),
    cost: row.cost.toFixed(4),
    outcome: row.outcome,
    escalated: String(row.escalated),
    harness_fix: row.harness_fix,
  };
}

export function formatRow(row: RunRow): string {
  const rec = rowToRecord(row);
  return RUNS_HEADER.split(",").map((k) => csvField(rec[k] ?? "")).join(",");
}

/** Minimal RFC 4180 parser (quotes, escaped quotes, commas). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Validate a whole runs.csv file: exact header, then every row. Returns violations with line numbers. */
export function validateRunsCsv(text: string): string[] {
  const rows = parseCsv(text);
  const errors: string[] = [];
  const headerLine = text.split("\n")[0]?.replace(/\r$/, "");
  if (headerLine !== RUNS_HEADER) errors.push(`line 1: header must be exactly "${RUNS_HEADER}"`);
  const keys = RUNS_HEADER.split(",");
  rows.slice(1).forEach((cells, i) => {
    if (cells.length !== keys.length) {
      errors.push(`line ${i + 2}: expected ${keys.length} fields, got ${cells.length}`);
      return;
    }
    const rec = Object.fromEntries(keys.map((k, j) => [k, cells[j] ?? ""]));
    for (const err of validateRow(rec)) errors.push(`line ${i + 2}: ${err}`);
  });
  return errors;
}

/** Append-only writer. Creates the file with the header; refuses a file with a different header. */
export class RunsCsvWriter {
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }

  append(row: RunRow): void {
    const errs = validateRow(rowToRecord(row));
    if (errs.length) throw new Error(`runs.csv row rejected: ${errs.join("; ")}`);
    mkdirSync(dirname(this.path), { recursive: true });
    if (!existsSync(this.path) || statSync(this.path).size === 0) {
      appendFileSync(this.path, RUNS_HEADER + "\n", { flag: "a" });
    } else {
      const first = readFileSync(this.path, "utf8").split("\n")[0];
      if (first !== RUNS_HEADER) throw new Error(`${this.path} has an unexpected header; refusing to append`);
    }
    appendFileSync(this.path, formatRow(row) + "\n", { flag: "a" });
  }
}

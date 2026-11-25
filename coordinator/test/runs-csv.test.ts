// R-10 schema test. Also run against the dry-run ledger in coordinator.test.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatRow, isoUtc, parseCsv, RUNS_HEADER, RunsCsvWriter, sanitizeHarnessFix, validateRow, validateRunsCsv, type RunRow } from "../src/runs-csv.ts";
import { tmp } from "./helpers.ts";

const row = (o: Partial<RunRow> = {}): RunRow => ({
  task: "resume-sg#12",
  stage: "verify",
  role: "coordinator",
  start: "2026-11-25T01:00:00Z",
  end: "2026-11-25T01:05:00Z",
  turns: 3,
  cost: 0.25,
  outcome: "pass",
  escalated: false,
  harness_fix: "",
  ...o,
});
const rec = (o: Partial<RunRow> = {}) => Object.fromEntries(RUNS_HEADER.split(",").map((k, i) => [k, parseCsv(formatRow(row(o)))[0]?.[i] ?? ""]));

describe("runs.csv contract (R-10)", () => {
  it("has exactly the agreed header", () => {
    expect(RUNS_HEADER).toBe("task,stage,role,start,end,turns,cost,outcome,escalated,harness_fix");
  });
  it("accepts a valid row", () => {
    expect(validateRow(rec())).toEqual([]);
  });
  it.each([
    ["task with a title instead of repo#n", { task: "Fix the page" }],
    ["local time", { start: "2026-11-25T09:00:00+08:00" }],
    ["unknown outcome", { outcome: "ok" as never }],
    ["escalated without harness fix", { outcome: "escalated" as const, escalated: true, harness_fix: "" }],
    ["escalated flag without escalated outcome", { escalated: true, harness_fix: "x" }],
    ["harness_fix on a normal row", { harness_fix: "x" }],
    ["email in harness_fix", { outcome: "escalated" as const, escalated: true, harness_fix: "ask someone@example.com" }],
    ["unknown role", { role: "gardener" }],
    ["end before start", { end: "2026-11-25T00:00:00Z" }],
  ])("rejects %s", (_name, o) => {
    expect(validateRow(rec(o)).length).toBeGreaterThan(0);
  });
  it("quotes commas and quotes in harness_fix", () => {
    const line = formatRow(row({ outcome: "escalated", escalated: true, harness_fix: 'add "x", then y' }));
    expect(line.endsWith('"add ""x"", then y"')).toBe(true);
    expect(validateRunsCsv(`${RUNS_HEADER}\n${line}\n`)).toEqual([]);
  });
  it("sanitizes harness fixes to one ASCII line without emails", () => {
    const s = sanitizeHarnessFix("line one\nline two 中 mail a.b@example.org " + "z".repeat(300));
    expect(s).not.toMatch(/\n|@/);
    expect(s.length).toBeLessThanOrEqual(200);
    expect(/^[\x20-\x7E]*$/.test(s)).toBe(true);
  });
  it("formats UTC timestamps with a Z suffix", () => {
    expect(isoUtc(new Date(Date.UTC(2026, 10, 25, 1, 2, 3, 456)))).toBe("2026-11-25T01:02:03Z");
  });
  it("writer is append-only and writes the header once", () => {
    const p = join(tmp(), "runs.csv");
    const w = new RunsCsvWriter(p);
    w.append(row());
    const first = readFileSync(p, "utf8");
    w.append(row({ stage: "review", role: "reviewer" }));
    const both = readFileSync(p, "utf8");
    expect(both.startsWith(first)).toBe(true);
    expect(both.split("\n").filter((l) => l === RUNS_HEADER)).toHaveLength(1);
    expect(validateRunsCsv(both)).toEqual([]);
  });
  it("writer refuses a file with a different header and rejects invalid rows", () => {
    const p = join(tmp(), "runs.csv");
    writeFileSync(p, "task,stage\n");
    expect(() => new RunsCsvWriter(p).append(row())).toThrow(/unexpected header/);
    expect(() => new RunsCsvWriter(join(tmp(), "r.csv")).append(row({ task: "bad" }))).toThrow(/rejected/);
  });
});

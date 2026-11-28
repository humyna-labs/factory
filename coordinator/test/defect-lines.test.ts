// F12 follow-up (owner, 2026-11-28; resume-sg#21): a Test-defect entry names <test file>:N or <test file>:N-M. A range
// needs N <= M, both inside the file, and at most 30 lines. The file must be a regular file under tests/ that exists;
// the claim still counts only from a clean session (claude.test.ts, F12).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DEFECT_RANGE, validTestDefects } from "../src/coordinator.ts";
import { testDefectOf } from "../src/runner/claude.ts";
import { readEvents } from "../src/events.ts";
import { dryRun } from "./helpers.ts";

const F = "tests/unit/sample-mode.test.tsx";

/** A worktree whose test file has exactly 240 lines (with a final newline), like the #21 file around line 212. */
function worktree(): string {
  const wt = mkdtempSync(join(tmpdir(), "factory-defect-lines-"));
  mkdirSync(join(wt, "tests/unit"), { recursive: true });
  writeFileSync(join(wt, F), Array.from({ length: 240 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
  writeFileSync(join(wt, "tests/unit/short.test.ts"), "one\ntwo\nthree");
  return wt;
}

describe("F12: validTestDefects accepts <file>:N and <file>:N-M", () => {
  const wt = worktree();
  const one = (d: string) => validTestDefects(wt, d);

  it(":212 (one line) counts", () => expect(one(`${F}:212 criterion 2`)).toBe(`${F}:212 criterion 2`));
  it(":209-212 (the #21 claim) counts", () => {
    const d = `${F}:209-212 "with text only in the job description it still asks" (runs for en and zh)`;
    expect(one(d)).toBe(d);
  });
  it(":212-209 (reversed) does not count", () => expect(one(`${F}:212-209 x`)).toBeUndefined());
  it(":N-N (one line written as a range) counts", () => expect(one(`${F}:212-212 x`)).toBe(`${F}:212-212 x`));

  it("a line past the end of the file does not count, alone or as the end of a range", () => {
    expect(one(`${F}:240 x`)).toBe(`${F}:240 x`);
    expect(one(`${F}:241 x`)).toBeUndefined();
    expect(one(`${F}:230-241 x`)).toBeUndefined();
    expect(one(`${F}:0 x`)).toBeUndefined();
    expect(one(`${F}:0-3 x`)).toBeUndefined();
  });

  it("the line count is exact with and without a final newline", () => {
    expect(one("tests/unit/short.test.ts:3 x")).toBe("tests/unit/short.test.ts:3 x");
    expect(one("tests/unit/short.test.ts:4 x")).toBeUndefined();
    expect(one(`${F}:239-240 x`)).toBe(`${F}:239-240 x`);
  });

  it(`a range of more than ${MAX_DEFECT_RANGE} lines does not count; exactly ${MAX_DEFECT_RANGE} does`, () => {
    expect(MAX_DEFECT_RANGE).toBe(30);
    expect(one(`${F}:200-229 x`)).toBe(`${F}:200-229 x`);
    expect(one(`${F}:200-230 x`)).toBeUndefined();
    expect(one(`${F}:1-240 x`)).toBeUndefined();
  });

  it("a file that does not exist, a directory, a path outside tests/ or with .. does not count", () => {
    expect(one("tests/unit/nope.test.ts:3 x")).toBeUndefined();
    expect(one("tests/unit/nope.test.ts:1-3 x")).toBeUndefined();
    expect(one("tests/unit:1 x")).toBeUndefined();
    expect(one("src/a.ts:1-2 x")).toBeUndefined();
    expect(one(`tests/../${F}:1-2 x`)).toBeUndefined();
  });

  it("malformed forms do not count: no number, an open range, a range with spaces", () => {
    expect(one(`${F}: x`)).toBeUndefined();
    expect(one(`${F}:209- x`)).toBeUndefined();
    expect(one(`${F}:209 - 212 x`)).toBe(`${F}:209 - 212 x`); // read as line 209 with the reason "- 212 x"
    expect(one(`${F}:209-212x`)).toBeUndefined();
  });

  it("several entries: only the valid ones are kept, in order", () => {
    expect(validTestDefects(wt, `tests/unit/nope.test.ts:1 a | ${F}:209-212 b | ${F}:212-209 c | ${F}:5 d`)).toBe(`${F}:209-212 b | ${F}:5 d`);
  });

  it("the session parser passes a range through unchanged", () => {
    const text = `FAIL: one QA test cannot pass\nTest-defect: ${F}:209-212 the test calls goNext() on a blank resume`;
    expect(testDefectOf(text)).toBe(`${F}:209-212 the test calls goNext() on a blank resume`);
  });
});

describe("F12: the builder prompt names both forms and the same limit", () => {
  it("roles/builder.md shows <file>:<line> and <file>:<first>-<last>, and the 30-line limit", () => {
    const prompt = readFileSync(join(import.meta.dirname, "..", "..", "roles", "builder.md"), "utf8");
    expect(prompt).toContain("Test-defect: <test file>:<line> ");
    expect(prompt).toContain("Test-defect: <test file>:<first>-<last> ");
    expect(prompt).toContain("`tests/unit/x.test.tsx:209-212`");
    expect(prompt).toContain(`spans at most ${MAX_DEFECT_RANGE} lines`);
  });
});

describe("F12 flow: a defect named with a line range goes to QA", () => {
  it("builder FAIL with tests/unit/<slug>.test.ts:1-2 sends the task back to tests, then it finishes", async () => {
    const r = await dryRun((f) => {
      f.issues = [{ number: 221, title: "Shell", labels: ["factory:ready", "risk:low"], body: "x" }];
      f.scenarios = { "resume-sg#221": { builder: ["defect-range", "pass"] } };
    });
    expect(r.digest.done.map((d) => d.task)).toEqual(["resume-sg#221"]);
    const ev = readEvents(r.paths.events).filter((e) => e.task === "resume-sg#221" && e.type === "stage");
    expect(ev.map((e) => `${String(e.stage)}:${e.passed === true ? "pass" : "fail"}`).slice(0, 4)).toEqual(["tests:pass", "impl:fail", "tests:pass", "impl:pass"]);
    expect(ev.find((e) => e.stage === "impl" && e.passed === false)?.test_defect).toBe("tests/unit/issue-221.test.ts:1-2 contradicts AC1");
  });
});

// Integration tests with stub roles, stub gates, fake GitHub and real git (A2).
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatDigest } from "../src/queue.ts";
import { validateRunsCsv, parseCsv } from "../src/runs-csv.ts";
import { dryRun } from "./helpers.ts";

describe("dry-run acceptance (A2)", async () => {
  const r = await dryRun();
  const csv = readFileSync(r.paths.runsCsv, "utf8");
  const rows = parseCsv(csv).slice(1);
  const finals = Object.fromEntries(rows.filter((x) => ["auto-merge", "needs-human", "escalated"].includes(x[7] ?? "")).map((x) => [x[0], x[7]]));

  it("drives the low-risk task to merged, high-risk to needs-human, failing to escalated", () => {
    expect(finals).toEqual({ "resume-sg#101": "auto-merge", "resume-sg#102": "needs-human", "resume-sg#103": "escalated" });
    const pulls = [...r.gh.pulls.values()];
    expect(pulls.find((p) => p.head === "factory/resume-sg-101")?.merged).toBe(true);
    expect(pulls.find((p) => p.head === "factory/resume-sg-102")?.merged).toBe(false);
  });

  it("calls merge only for the low-risk pull request (R-02)", () => {
    const merges = r.gh.calls.filter((c) => c.op === "merge");
    expect(merges).toHaveLength(1);
    const pr101 = [...r.gh.pulls.values()].find((p) => p.head === "factory/resume-sg-101");
    expect(merges[0]?.args[2]).toBe(pr101?.number);
  });

  it("escalates after exactly 3 builder attempts", () => {
    expect(rows.filter((x) => x[0] === "resume-sg#103" && x[1] === "impl")).toHaveLength(3);
  });

  it("writes runs.csv rows that pass the schema test (R-10)", () => {
    expect(validateRunsCsv(csv)).toEqual([]);
  });

  it("writes one escalated row with a one-line harness_fix (R-09)", () => {
    const esc = rows.filter((x) => x[8] === "true");
    expect(esc).toHaveLength(1);
    expect(esc[0]?.[9]?.length).toBeGreaterThan(10);
  });

  it("drafts a harness-fix issue in the factory repo with the required sections (R-09)", () => {
    const issue = [...r.gh.issues.values()].find((i) => i.labels.includes("harness-fix"));
    expect(issue?.owner).toBe("humyna-labs");
    expect(issue?.repo).toBe("factory");
    for (const h of ["## Context", "## Reproduction", "## Expected behaviour", "## Proposed change", "## Acceptance criteria", "Principles: P-02"]) expect(issue?.body).toContain(h);
    expect(readFileSync(join(r.paths.escalationsDir, "resume-sg-103.md"), "utf8")).toContain("## Acceptance criteria");
  });

  it("sets state labels on issues; only one factory:* label at a time", () => {
    const labels = (n: number) => [...r.gh.issues.values()].find((i) => i.repo === "resume-sg" && i.number === n)?.labels.filter((l) => l.startsWith("factory:"));
    expect(labels(101)).toEqual(["factory:auto-merge"]);
    expect(labels(102)).toEqual(["factory:needs-human"]);
    expect(labels(103)).toEqual(["factory:escalated"]);
    expect(labels(104)).toEqual(["factory:ready"]);
  });

  it("skips the blocked task and prints a digest with every section (R-12)", () => {
    const text = formatDigest(r.digest);
    expect(r.digest.skippedBlocked).toEqual([{ task: "resume-sg#104", reason: "depends on open #102" }]);
    for (const s of ["Done (1)", "Needs human (1)", "Escalated (1)", "Skipped, blocked (1)", "Blocked actions:", "Cost:"]) expect(text).toContain(s);
  });

  it("takes tasks in priority order", () => {
    const order = [...new Set(rows.map((x) => x[0]))];
    expect(order).toEqual(["resume-sg#102", "resume-sg#101", "resume-sg#103"]);
  });

  it("commits each writing stage with an ASCII message and an Agent-Role trailer", async () => {
    const { exec } = await import("../src/exec.ts");
    const log = await exec("git", ["log", "--format=%B%x00", "factory/resume-sg-101"], { cwd: r.repoDir, kind: "git" });
    const msgs = log.stdout.split("\0").map((m) => m.trim()).filter((m) => m.startsWith("factory("));
    expect(msgs.length).toBe(2);
    for (const m of msgs) expect(m).toMatch(/Agent-Role: (qa|builder)$/);
  });
  afterAll(() => rmSync(r.runsDir, { recursive: true, force: true }));
});

describe("stage failures", () => {
  it("fails the stage when a role session leaves no report (R-20)", async () => {
    const r = await dryRun((f) => {
      f.scenarios["resume-sg#101"] = { reviewer: ["no-report", "pass"] };
    });
    const rows = parseCsv(readFileSync(r.paths.runsCsv, "utf8")).slice(1).filter((x) => x[0] === "resume-sg#101");
    const review = rows.filter((x) => x[1] === "review");
    expect(review.map((x) => x[7])).toEqual(["fail", "pass"]);
    const ev = readFileSync(r.paths.events, "utf8");
    expect(ev).toContain("report check failed: report missing");
  });

  it("fails the stage and resets the worktree on an out-of-scope write (R-03)", async () => {
    const r = await dryRun((f) => {
      f.scenarios["resume-sg#101"] = { builder: ["out-of-scope", "out-of-scope", "out-of-scope"] };
    });
    const ev = readFileSync(r.paths.events, "utf8");
    expect(ev).toContain("out-of-scope writes by builder: tests/unit/sneaky.test.ts");
    expect(r.digest.escalated.map((x) => x.task)).toContain("resume-sg#101");
  });

  it("escalates at once when QA tests do not fail first", async () => {
    const r = await dryRun((f) => {
      f.scenarios["resume-sg#101"] = { red: ["fail"] };
    });
    const rows = parseCsv(readFileSync(r.paths.runsCsv, "utf8")).slice(1).filter((x) => x[0] === "resume-sg#101");
    expect(rows.map((x) => `${x[1]}:${x[7]}`)).toEqual(["tests:fail", "tests:escalated"]);
  });

  it("routes a risk:low task that touches a high-risk path to needs-human", async () => {
    const r = await dryRun((f) => {
      f.scenarios["resume-sg#101"] = { changes: ["src/privacy/redact.ts"] };
    });
    expect(r.digest.needsHuman.map((x) => x.task)).toContain("resume-sg#101");
    expect(r.gh.calls.filter((c) => c.op === "merge")).toHaveLength(0);
  });

  it("stops at the time budget without waiting and lists unstarted tasks", async () => {
    let t = Date.UTC(2026, 10, 25, 0, 0, 0);
    const r = await dryRun(undefined, { maxHours: 0.001, now: () => new Date((t += 2000)) });
    expect(r.digest.done).toHaveLength(0);
    expect(r.digest.stopped.length + r.digest.notStarted.length).toBeGreaterThan(0);
  });
});

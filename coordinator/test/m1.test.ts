// jd2cv-m1 (first live run, resume-sg#4): fixes for the failures that escalated #4.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readEvents } from "../src/events.ts";
import type { Exec } from "../src/exec.ts";
import { reportsFailures, ShellGates } from "../src/gates/shell.ts";
import { parseCsv } from "../src/runs-csv.ts";
import { testDefectOf } from "../src/runner/claude.ts";
import { MAX_TEST_REWRITES, transition } from "../src/state.ts";
import { parseFactoryConfig } from "../src/config.ts";
import { GitWorkspace } from "../src/workspace/git.ts";
import { dryRun } from "./helpers.ts";

function rowsOf(file: string, task: string): { stage: string; role: string; outcome: string }[] {
  const [head, ...rest] = parseCsv(readFileSync(file, "utf8"));
  const at = (n: string) => (head ?? []).indexOf(n);
  return rest.filter((r) => r[at("task")] === task).map((r) => ({ stage: r[at("stage")] ?? "", role: r[at("role")] ?? "", outcome: r[at("outcome")] ?? "" }));
}

const VITEST_ASSERTION = " Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 11 passed (12)\n";
const VITEST_IMPORT = " Test Files  1 failed | 2 passed (3)\n      Tests  11 passed (11)\n";
const VITEST_COLOURED = "\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m1 failed\x1b[39m\x1b[22m\x1b[90m (1)\x1b[39m\n";
const VITEST_CRASH = "failed to load config from /w/vite.config.ts\nError [ERR_MODULE_NOT_FOUND]: Cannot find package '@vitejs/plugin-react' imported from /w/vite.config.ts\n";
const PLAYWRIGHT = "  1 failed\n    [chromium] > tests/e2e/a.spec.ts:3:1 > x\n  4 passed (3.1s)\n";

describe("red check needs failing tests, not a crashed runner", () => {
  it("recognises Vitest and Playwright failure summaries", () => {
    expect(reportsFailures(VITEST_ASSERTION)).toBe(true);
    expect(reportsFailures(VITEST_IMPORT)).toBe(true);
    expect(reportsFailures(VITEST_COLOURED)).toBe(true);
    expect(reportsFailures(PLAYWRIGHT)).toBe(true);
  });
  it("does not count a startup crash or a run with 0 failed", () => {
    expect(reportsFailures(VITEST_CRASH)).toBe(false);
    expect(reportsFailures(" Test Files  0 failed | 3 passed (3)\n")).toBe(false);
    expect(reportsFailures("")).toBe(false);
  });
  const cfg = parseFactoryConfig("version: 1\nproduct: p\nrepo: humyna-labs/p\nhigh_risk_paths: [package.json]\ngates: { typecheck: t, lint: l, unit: u, e2e: e }\ndeploy: { provider: cloudflare-pages, mode: git-integration }\n");
  const gates = (code: number, out: string) => new ShellGates(cfg, (async () => ({ code, stdout: out, stderr: "", timedOut: false })) as Exec);
  it("ShellGates.red: crash is not red, failing tests are, passing tests are not", async () => {
    const ctx = { worktree: "/tmp", task: "p#1", attempt: 1 };
    expect((await gates(1, VITEST_CRASH).red(ctx)).ok).toBe(false);
    expect((await gates(1, VITEST_CRASH).red(ctx)).detail).toMatch(/did not run/);
    expect((await gates(1, VITEST_ASSERTION).red(ctx)).ok).toBe(true);
    expect((await gates(0, " Tests  12 passed (12)\n").red(ctx)).ok).toBe(false);
  });
});

describe("Test-defect: the builder can send a defective test back to QA once", () => {
  const ctx = (implAttempts: number, testDefect: boolean, testRewrites: number) => ({ implAttempts, maxImplAttempts: 3, risk: "low" as const, testDefect, testRewrites });
  it("goes back to tests on a test defect, once per task, even on the last attempt", () => {
    expect(MAX_TEST_REWRITES).toBe(1);
    expect(transition("impl", false, ctx(1, true, 0))).toBe("tests");
    expect(transition("impl", false, ctx(3, true, 0))).toBe("tests");
    expect(transition("impl", false, ctx(1, true, 1))).toBe("impl");
    expect(transition("impl", false, ctx(3, true, 1))).toBe("escalated");
  });
  it("only from impl, only on failure", () => {
    expect(transition("impl", true, ctx(1, true, 0))).toBe("verify");
    expect(transition("verify", false, ctx(1, true, 0))).toBe("impl");
    expect(transition("review", false, ctx(1, true, 0))).toBe("impl");
  });
  it("reads the Test-defect line only from a FAIL final message", () => {
    expect(testDefectOf("FAIL tests contradict the issue\nBlocker: x\nTest-defect: tests/unit/a.test.tsx:158 matches two links named Start\n")).toBe("tests/unit/a.test.tsx:158 matches two links named Start");
    expect(testDefectOf("PASS done\nTest-defect: tests/unit/a.test.tsx:1 x")).toBeUndefined();
    expect(testDefectOf("FAIL something else")).toBeUndefined();
    expect(testDefectOf("FAIL x\nTest-defect: 开始定制 " + "y".repeat(400))).toMatch(/^\?{4} y+$/);
    expect(testDefectOf("FAIL x\nTest-defect: " + "y".repeat(400))?.length).toBe(300);
  });

  it("flow: QA re-runs with the builder's reason, then the task finishes (stub roles)", async () => {
    const r = await dryRun((f) => {
      f.issues = [{ number: 201, title: "Shell", labels: ["factory:ready", "risk:low"], body: "x" }];
      f.scenarios = { "resume-sg#201": { builder: ["test-defect", "pass"] } };
    });
    expect(r.digest.done.map((d) => d.task)).toEqual(["resume-sg#201"]);
    const rows = rowsOf(r.paths.runsCsv, "resume-sg#201");
    expect(rows.map((x) => `${x.stage}:${x.outcome}`).slice(0, 4)).toEqual(["tests:pass", "impl:fail", "tests:pass", "impl:pass"]);
    const ev = readEvents(r.paths.events).filter((e) => e.task === "resume-sg#201");
    const starts = ev.filter((e) => e.type === "stage-start" && e.stage === "tests").map((e) => e.attempt);
    expect(starts).toEqual([1, 2]);
    expect(ev.find((e) => e.type === "stage" && e.stage === "impl" && e.passed === false)?.test_defect).toMatch(/contradicts AC1/);
  });

  it("flow: a second test defect does not loop; the builder keeps its attempts and the task escalates", async () => {
    const r = await dryRun((f) => {
      f.issues = [{ number: 202, title: "Shell", labels: ["factory:ready", "risk:low"], body: "x" }];
      f.scenarios = { "resume-sg#202": { builder: ["test-defect", "test-defect", "test-defect", "test-defect"] } };
    });
    expect(r.digest.escalated.map((d) => d.task)).toEqual(["resume-sg#202"]);
    const rows = rowsOf(r.paths.runsCsv, "resume-sg#202").filter((x) => x.role !== "coordinator");
    expect(rows.map((x) => x.stage)).toEqual(["tests", "impl", "tests", "impl", "impl"]);
  });
});

describe("push authenticates with the gh token, other git calls do not get it", () => {
  it("push runs as kind gh, status and fetch as kind git", async () => {
    const kinds: string[] = [];
    const fake: Exec = async (_cmd, args, opts) => {
      kinds.push(`${args[0] ?? ""}:${opts?.kind ?? ""}`);
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    };
    const ws = new GitWorkspace(fake, { repoDir: "/tmp/r", worktreesDir: "/tmp/w", baseBranch: "main", remote: "origin" });
    await ws.push("/tmp/w/x", "factory/x-1");
    await ws.changedFiles("/tmp/w/x");
    await ws.filesChangedFromBase("/tmp/w/x");
    expect(kinds).toEqual(["push:gh", "status:git", "diff:git"]);
  });
});

describe("blocked actions are counted once", () => {
  it("a hook denial in guard.log and in the session result counts as 1", async () => {
    const r = await dryRun((f) => {
      f.issues = [{ number: 203, title: "Shell", labels: ["factory:ready", "risk:low"], body: "x" }];
      f.scenarios = { "resume-sg#203": { builder: ["blocked-once"] } };
    });
    expect(r.digest.blockedActions).toBe(1);
  });
});

describe("the queue waits for an auto-merge to land before the next task (resume-sg#18)", () => {
  it("waits while the PR is open, then starts the next task from the merged base", async () => {
    const r = await dryRun((f) => {
      f.issues = [
        { number: 401, title: "A", labels: ["factory:ready", "risk:low"], body: "x" },
        { number: 402, title: "B", labels: ["factory:ready", "risk:low"], body: "x" },
      ];
      f.scenarios = {};
    });
    expect(r.digest.done.map((t) => t.task)).toEqual(["resume-sg#401", "resume-sg#402"]);
    expect(r.digest.unmerged).toEqual([]);
    const waits = readEvents(r.paths.events).filter((e) => e.type === "merge-wait");
    expect(waits.map((e) => `${e.task}:${e.result}`)).toEqual(["resume-sg#401:merged", "resume-sg#402:merged"]);
    // the wait comes before the next task starts
    const ev = readEvents(r.paths.events).map((e) => `${e.type}:${e.task}`);
    expect(ev.indexOf("merge-wait:resume-sg#401")).toBeLessThan(ev.indexOf("task-start:resume-sg#402"));
  });
  it("waitForMerge: pending polls sleep, DIRTY stops at once, a long wait times out", async () => {
    const { FakeGitHub } = await import("../src/github/fake.ts");
    const { waitForMerge, MERGE_POLL_MS, MERGE_WAIT_MS } = await import("../src/queue.ts");
    const gh = new FakeGitHub([]);
    const pr = await gh.findOrOpenPullRequest("o", "r", "h", "main", "t", "b");
    await gh.merge("o", "r", pr.number);
    let t = 0;
    const slept: number[] = [];
    const d = { gh, now: () => new Date(t), sleep: async (ms: number) => { slept.push(ms); t += ms; } } as unknown as Parameters<typeof waitForMerge>[0];
    gh.pendingPolls = 3;
    expect(await waitForMerge(d, "o", "r", pr.number)).toBe("merged");
    expect(slept).toEqual([MERGE_POLL_MS, MERGE_POLL_MS, MERGE_POLL_MS]);
    gh.mergeStateOverride = "DIRTY";
    slept.length = 0;
    expect(await waitForMerge(d, "o", "r", pr.number)).toBe("conflict");
    expect(slept).toEqual([]);
    gh.mergeStateOverride = "BLOCKED";
    expect(await waitForMerge(d, "o", "r", pr.number)).toBe("timeout");
    expect(slept.length).toBe(MERGE_WAIT_MS / MERGE_POLL_MS);
  });
  it("gh adapter maps pr view state", async () => {
    const out = (state: string, m: string): Exec => async () => ({ code: 0, stdout: JSON.stringify({ state, mergeStateStatus: m }), stderr: "", timedOut: false });
    const { GhGitHub } = await import("../src/github/gh.ts");
    expect(await new GhGitHub(out("MERGED", "UNKNOWN")).pullRequestState("o", "r", 1)).toEqual({ state: "merged", mergeState: "UNKNOWN" });
    expect(await new GhGitHub(out("OPEN", "DIRTY")).pullRequestState("o", "r", 1)).toEqual({ state: "open", mergeState: "DIRTY" });
    expect(await new GhGitHub(out("CLOSED", "")).pullRequestState("o", "r", 1)).toEqual({ state: "closed", mergeState: "" });
  });
});

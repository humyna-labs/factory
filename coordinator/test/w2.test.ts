// Handoff D2-W2: W2-05 (push hook, fetch, cleanup), W2-06 (resume after SIGKILL), W2-07
// (feature list), W2-10 (report index).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exec } from "../src/exec.ts";
import { featureOf, markFeature } from "../src/features.ts";
import { factoryPath } from "../src/paths.ts";
import { REPORT_INDEX_HEADER } from "../src/report.ts";
import { parseCsv, validateRunsCsv } from "../src/runs-csv.ts";
import type { Issue } from "../src/types.ts";
import { GitWorkspace } from "../src/workspace/git.ts";
import { dryRun, fixture, tmp } from "./helpers.ts";

const CLI = factoryPath("coordinator", "src", "cli.ts");
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const issue = (n: number): Issue => ({ owner: "humyna-labs", repo: "p", number: n, title: "t", body: "", labels: [], state: "open" });

describe("W2-10 report index", async () => {
  const r = await dryRun();
  it("has one line per role-session report, with path, repo, issue, stage, attempt and UTC time", () => {
    const index = readFileSync(join(r.paths.reportsDir, "INDEX.md"), "utf8");
    expect(index.startsWith(REPORT_INDEX_HEADER)).toBe(true);
    const rows = index.split("\n").slice(2).filter(Boolean);
    const reports = readdirSync(r.paths.reportsDir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".md") && f.includes("/"));
    expect(rows.length).toBe(reports.length);
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(row).toMatch(/^\| \/\S+\.md \| resume-sg \| \d+ \| (tests|impl|review|compliance) \| \d+ \| \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \|$/);
  });
});

describe("W2-05 product clones: push hook, fetch, cleanup", async () => {
  const r = await dryRun();
  it("removes finished worktrees, keeps needs-human ones and lists them in the digest", () => {
    expect(existsSync(join(r.paths.worktreesDir, "resume-sg-101"))).toBe(false);
    expect(existsSync(join(r.paths.worktreesDir, "resume-sg-103"))).toBe(false);
    expect(existsSync(join(r.paths.worktreesDir, "resume-sg-102"))).toBe(true);
    expect(r.digest.keptWorktrees).toEqual(["resume-sg-102"]);
    expect(git(r.repoDir, "branch", "--list", "factory/*")).toContain("factory/resume-sg-103");
  });

  function clone() {
    const dir = tmp("factory-ws-");
    const bare = join(dir, "remote.git");
    git(dir, "init", "-q", "--bare", "-b", "main", bare);
    const seed = join(dir, "seed");
    git(dir, "clone", "-q", bare, seed);
    git(seed, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "--allow-empty", "-m", "one");
    git(seed, "push", "-q", "origin", "main");
    const repoDir = join(dir, "product");
    git(dir, "clone", "-q", bare, repoDir);
    git(repoDir, "config", "user.name", "bot");
    git(repoDir, "config", "user.email", "bot@localhost");
    return { dir, seed, repoDir };
  }

  it("fetches before creating a worktree, so the task starts from the current remote base", async () => {
    const c = clone();
    git(c.seed, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "--allow-empty", "-m", "two, pushed after the clone");
    git(c.seed, "push", "-q", "origin", "main");
    const ws = new GitWorkspace(exec, { repoDir: c.repoDir, worktreesDir: join(c.dir, "wt"), baseBranch: "main", remote: "origin" });
    const { worktree } = await ws.prepare(issue(1));
    expect(git(worktree, "log", "-1", "--format=%s").trim()).toBe("two, pushed after the clone");
  });

  it("sets the factory pre-push hook on the clone, and the hook really runs on push", async () => {
    const c = clone();
    const ws = new GitWorkspace(exec, { repoDir: c.repoDir, worktreesDir: join(c.dir, "wt"), baseBranch: "main", remote: "origin", pushHookPath: factoryPath(".githooks") });
    const { worktree, branch } = await ws.prepare(issue(2));
    expect(git(c.repoDir, "config", "core.hooksPath").trim()).toBe(factoryPath(".githooks"));
    writeFileSync(join(worktree, "a.txt"), "a");
    await ws.commit(worktree, "feat: a", "builder");
    // The local bare remote is not a humyna-labs GitHub URL, so the factory hook must refuse it.
    await expect(ws.push(worktree, branch)).rejects.toThrow(/pre-push: REJECTED/);
  });

  it("cleanup removes the worktree and keeps the branch", async () => {
    const c = clone();
    const ws = new GitWorkspace(exec, { repoDir: c.repoDir, worktreesDir: join(c.dir, "wt"), baseBranch: "main", remote: "origin" });
    const { worktree } = await ws.prepare(issue(3));
    await ws.cleanup(worktree);
    expect(existsSync(worktree)).toBe(false);
    expect(ws.kept()).toEqual([]);
    expect(git(c.repoDir, "branch", "--list", "factory/p-3")).toContain("factory/p-3");
  });
});

describe("W2-07 feature_list.json is updated by verify only", () => {
  const list = (dir: string, features: unknown[]) => writeFileSync(join(dir, "feature_list.json"), JSON.stringify({ features, extra: "kept" }));
  it("reads the feature from the issue body", () => {
    expect(featureOf({ body: "Do x.\nFeature: greeting-line\n" })).toBe("greeting-line");
    expect(featureOf({ body: "no feature here" })).toBeUndefined();
  });
  it("marks passing with a time, back to failing, and keeps extra fields", () => {
    const d = tmp();
    list(d, [{ id: "greeting-line", title: "Greeting", passes: false, owner_note: "x" }]);
    expect(markFeature(d, "greeting-line", true, "2026-11-25T05:00:00Z")).toBe("updated");
    const after = JSON.parse(readFileSync(join(d, "feature_list.json"), "utf8"));
    expect(after).toEqual({ features: [{ id: "greeting-line", title: "Greeting", passes: true, verified_at: "2026-11-25T05:00:00Z", owner_note: "x" }], extra: "kept" });
    expect(markFeature(d, "greeting-line", true, "later")).toBe("unchanged");
    expect(markFeature(d, "greeting-line", false, "later")).toBe("updated");
    expect(JSON.parse(readFileSync(join(d, "feature_list.json"), "utf8")).features[0]).not.toHaveProperty("verified_at");
  });
  it("reports missing pieces instead of failing the stage", () => {
    const d = tmp();
    expect(markFeature(d, undefined, true, "t")).toBe("no-feature");
    expect(markFeature(d, "x", true, "t")).toBe("missing-file");
    list(d, [{ id: "y", passes: false }]);
    expect(markFeature(d, "x", true, "t")).toBe("unknown-feature");
    writeFileSync(join(d, "feature_list.json"), JSON.stringify({ features: [{ id: "x" }] }));
    expect(() => markFeature(d, "x", true, "t")).toThrow();
  });
  it("the coordinator, not a role, commits the change in the verify stage", async () => {
    const r = await dryRun((f) => {
      const i = f.issues.find((x) => x.number === 102);
      if (i) i.body += "\nFeature: csp-font";
    });
    // The template's list is empty, so the verify stage records unknown-feature and goes on.
    const ev = readFileSync(r.paths.events, "utf8").split("\n").filter((l) => l.includes('"feature-list"'));
    expect(ev.some((l) => l.includes('"feature":"csp-font"') && l.includes('"result":"unknown-feature"'))).toBe(true);
    const wt = join(r.paths.worktreesDir, "resume-sg-102");
    list(wt, [{ id: "csp-font", passes: false }]);
    expect(markFeature(wt, "csp-font", true, "t")).toBe("updated");
  });
});

describe("W2-06 resume after an interruption", () => {
  function counts(runsDir: string) {
    const rows = parseCsv(readFileSync(join(runsDir, "runs.csv"), "utf8")).slice(1).filter((x) => x.length > 1);
    const state = JSON.parse(readFileSync(join(runsDir, "fake-github.json"), "utf8")) as { issues: Issue[]; pulls: unknown[] };
    return { rows, state, harnessFix: state.issues.filter((i) => i.labels.includes("harness-fix")).length };
  }
  const label = (s: { issues: Issue[] }, n: number) => s.issues.find((i) => i.number === n)?.labels.filter((l) => l.startsWith("factory:"));

  it("SIGKILL mid-stage, then --resume: same end states, no duplicate PR, issue or ledger row", async () => {
    const runsDir = tmp("factory-resume-");
    const fx = fixture((f) => {
      const s = f.scenarios["resume-sg#103"];
      if (s) s.builder = ["fail", "pass", "hang-once"];
    });
    const fxFile = join(runsDir, "fixture.json");
    writeFileSync(fxFile, JSON.stringify(fx));
    const args = [CLI, "--dry-run", "--runs-dir", runsDir, "--fixture", fxFile];
    const child = spawn(process.execPath, args, { stdio: "ignore" });
    const events = join(runsDir, "events.jsonl");
    const hung = () => existsSync(events) && /"type":"stage-start","task":"resume-sg#103","stage":"impl","attempt":3/.test(readFileSync(events, "utf8"));
    for (let i = 0; i < 300 && !hung(); i++) await new Promise((r) => setTimeout(r, 100));
    expect(hung()).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    const mid = counts(runsDir);
    expect(label(mid.state, 103)).toEqual(["factory:impl"]);
    expect(mid.harnessFix).toBe(0);

    const resumed = spawnSync(process.execPath, [...args, "--resume"], { encoding: "utf8" });
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(resumed.stdout).toContain("Resumed after an interruption (1): resume-sg#103");
    expect(resumed.stdout).toContain("Worktrees kept (1): resume-sg-102");
    const end = counts(runsDir);
    expect(label(end.state, 101)).toEqual(["factory:auto-merge"]);
    expect(label(end.state, 102)).toEqual(["factory:needs-human"]);
    expect(label(end.state, 103)).toEqual(["factory:escalated"]);
    expect(label(end.state, 104)).toEqual(["factory:ready"]);
    expect(end.state.pulls.length).toBe(2);
    expect(end.harnessFix).toBe(1);
    expect(validateRunsCsv(readFileSync(join(runsDir, "runs.csv"), "utf8"))).toEqual([]);
    const r103 = end.rows.filter((x) => x[0] === "resume-sg#103");
    expect(r103.filter((x) => x[1] === "impl").length).toBe(3);
    for (const t of ["resume-sg#101", "resume-sg#102", "resume-sg#103"]) expect(end.rows.filter((x) => x[0] === t && x[2] === "coordinator" && x[7] !== "pass" && x[7] !== "fail").length, t).toBe(1);
    expect(end.rows.filter((x) => x[0] !== "resume-sg#103")).toEqual(mid.rows.filter((x) => x[0] !== "resume-sg#103"));

    // A further resume has nothing in flight and changes nothing.
    const again = spawnSync(process.execPath, [...args, "--resume"], { encoding: "utf8" });
    expect(again.status, again.stderr).toBe(0);
    const last = counts(runsDir);
    expect(last.rows).toEqual(end.rows);
    expect(last.harnessFix).toBe(1);
  }, 60_000);

  it("a stage that finished before the kill is not re-run, and escalation is not repeated", async () => {
    const r = await dryRun();
    const before = { rows: readFileSync(r.paths.runsCsv, "utf8"), issues: r.gh.calls.filter((c) => c.op === "createIssue").length };
    // Simulate a kill after the last verify of #103 finished but before its label moved.
    const i103 = r.gh.issues.get("humyna-labs/resume-sg#103");
    if (!i103) throw new Error("no #103");
    i103.labels = ["factory:verify", "risk:low", "priority:p2"];
    const { runQueue } = await import("../src/queue.ts");
    const { loadFactoryConfig } = await import("../src/config.ts");
    const { EventLog } = await import("../src/events.ts");
    const { RunsCsvWriter } = await import("../src/runs-csv.ts");
    const { StubRunner } = await import("../src/runner/stub.ts");
    const { StubGates } = await import("../src/gates/stub.ts");
    const f = fixture();
    const cfg = loadFactoryConfig(join(r.repoDir, ".factory", "factory.yaml"));
    const dg = await runQueue(
      { cfg, gh: r.gh, runner: new StubRunner(f.scenarios), gates: new StubGates(f.scenarios), workspace: new GitWorkspace(exec, { repoDir: r.repoDir, worktreesDir: r.paths.worktreesDir, baseBranch: "main", remote: "origin" }), exec, ledger: new RunsCsvWriter(r.paths.runsCsv), events: new EventLog(r.paths.events), paths: r.paths, now: () => new Date() },
      1,
    );
    expect(dg.resumed).toEqual(["resume-sg#103"]);
    expect(dg.escalated.map((x) => x.task)).toEqual(["resume-sg#103"]);
    expect(i103.labels).toContain("factory:escalated");
    expect(readFileSync(r.paths.runsCsv, "utf8")).toBe(before.rows);
    expect(r.gh.calls.filter((c) => c.op === "createIssue").length).toBe(before.issues);
    expect(r.gh.comments.get("humyna-labs/resume-sg#103")?.length).toBe(1);
  });

  it("gives up after two interrupted starts of the same stage and says so in the digest", async () => {
    const r = await dryRun();
    const i101 = r.gh.issues.get("humyna-labs/resume-sg#101");
    if (!i101) throw new Error("no #101");
    i101.labels = ["factory:review"];
    mkdirSync(r.paths.runsDir, { recursive: true });
    const ts = "2026-11-25T05:00:00Z";
    const lines = [{ ts, type: "task-start", task: "resume-sg#101" }, { ts, type: "stage-start", task: "resume-sg#101", stage: "review", attempt: 1 }, { ts, type: "stage-start", task: "resume-sg#101", stage: "review", attempt: 1 }];
    writeFileSync(r.paths.events, readFileSync(r.paths.events, "utf8") + lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const { runTask } = await import("../src/coordinator.ts");
    const { loadFactoryConfig } = await import("../src/config.ts");
    const { EventLog } = await import("../src/events.ts");
    const { RunsCsvWriter } = await import("../src/runs-csv.ts");
    const { StubRunner } = await import("../src/runner/stub.ts");
    const { StubGates } = await import("../src/gates/stub.ts");
    const f = fixture();
    const cfg = loadFactoryConfig(join(r.repoDir, ".factory", "factory.yaml"));
    const res = await runTask({ cfg, gh: r.gh, runner: new StubRunner(f.scenarios), gates: new StubGates(f.scenarios), workspace: new GitWorkspace(exec, { repoDir: r.repoDir, worktreesDir: r.paths.worktreesDir, baseBranch: "main", remote: "origin" }), exec, ledger: new RunsCsvWriter(r.paths.runsCsv), events: new EventLog(r.paths.events), paths: r.paths, now: () => new Date() }, i101);
    expect(res.resumeLoop).toBe(true);
    expect(i101.labels).toEqual(["factory:review"]);
  });
});

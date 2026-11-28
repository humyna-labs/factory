// F01a and F01b (external review of v1.3): gates run as the same user as the coordinator, with /workspace
// writable, so a test can change files. The verify stage stages only what it owns, every gate must leave the task
// worktree unchanged, and the factory's own checkout must be clean and at the approved SHA after every gate.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFactoryConfig } from "../src/config.ts";
import { exec } from "../src/exec.ts";
import { ShellGates } from "../src/gates/shell.ts";
import type { GateRunner } from "../src/gates/types.ts";
import { transition } from "../src/state.ts";
import { dryRun, tmp } from "./helpers.ts";

const ID = ["-c", "user.name=bot", "-c", "user.email=bot@localhost", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...args: string[]) => execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8" }).trim();

function repo(): string {
  const dir = tmp("factory-integrity-");
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, ".gitignore"), "dist/\n");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  return dir;
}

const cfgWith = (unit: string) =>
  parseFactoryConfig(`version: 1\nproduct: p\nrepo: humyna-labs/p\nhigh_risk_paths: [package.json]\ngates: { typecheck: 'true', lint: 'true', unit: '${unit}', e2e: 'true' }\nred_gate: unit\ndeploy: { provider: cloudflare-pages, mode: git-integration }\n`);
const ctx = (wt: string) => ({ worktree: wt, task: "p#1", attempt: 1 });

describe("F01a: every gate leaves the task worktree unchanged", () => {
  it("a gate that writes src/x.ts escalates, names the file and stops the remaining gates", async () => {
    const wt = repo();
    const res = await new ShellGates(cfgWith("mkdir -p src && echo x > src/x.ts"), exec).verify(ctx(wt));
    const last = res[res.length - 1];
    expect(last).toMatchObject({ name: "worktree", ok: false, escalate: true });
    expect(last?.detail).toMatch(/gate unit changed files in the task worktree: src\/x.ts/);
    expect(res.map((g) => g.name)).toEqual(["typecheck", "lint", "unit", "worktree"]);
  });

  it("a gate that edits a tracked file escalates too", async () => {
    const wt = repo();
    const res = await new ShellGates(cfgWith("echo changed > a.txt"), exec).verify(ctx(wt));
    expect(res.find((g) => g.escalate)?.detail).toMatch(/a.txt/);
  });

  it("ignored build output (dist/) is not a change", async () => {
    const wt = repo();
    const res = await new ShellGates(cfgWith("mkdir -p dist && echo x > dist/o.js"), exec).verify(ctx(wt));
    expect(res.some((g) => g.escalate)).toBe(false);
  });

  it("an escalating stage goes to escalated at once, whatever attempts remain", () => {
    expect(transition("verify", false, { implAttempts: 1, maxImplAttempts: 3, risk: "low", escalateNow: true })).toBe("escalated");
    expect(transition("verify", false, { implAttempts: 1, maxImplAttempts: 3, risk: "low" })).toBe("impl");
  });

  it("flow: a verify result with escalate ends the task at escalated after one builder attempt", async () => {
    const r = await dryRun((f) => {
      f.issues = [{ number: 701, title: "Shell", labels: ["factory:ready", "risk:low"], body: "Feature: x" }];
      f.scenarios = {};
    });
    const issue = r.gh.issues.get("humyna-labs/resume-sg#701");
    if (!issue) throw new Error("fixture");
    issue.labels = ["factory:ready", "risk:low"];
    issue.state = "open";
    const gates: GateRunner = {
      name: "stub",
      red: async () => ({ name: "red", ok: true, detail: "fails as expected" }),
      verify: async () => [{ name: "worktree", ok: false, escalate: true, detail: "gate unit changed files in the task worktree: src/x.ts" }],
    };
    const { loadFactoryConfig } = await import("../src/config.ts");
    const { EventLog } = await import("../src/events.ts");
    const { RunsCsvWriter } = await import("../src/runs-csv.ts");
    const { StubRunner } = await import("../src/runner/stub.ts");
    const { GitWorkspace } = await import("../src/workspace/git.ts");
    const { restartTask, runTask } = await import("../src/coordinator.ts");
    const cfg = loadFactoryConfig(join(r.repoDir, ".factory", "factory.yaml"));
    const d = { cfg, gh: r.gh, runner: new StubRunner({}), gates, workspace: new GitWorkspace(exec, { repoDir: r.repoDir, worktreesDir: r.paths.worktreesDir, baseBranch: "main", remote: "origin" }), exec, ledger: new RunsCsvWriter(r.paths.runsCsv), events: new EventLog(r.paths.events), paths: r.paths, now: () => new Date() };
    issue.labels = ["factory:escalated", "risk:low"];
    const res = await runTask(d, await restartTask(d, issue, "F01a test"));
    expect(res.final).toBe("escalated");
    const { readEvents } = await import("../src/events.ts");
    const ev = readEvents(r.paths.events).filter((e) => e.task === "resume-sg#701");
    const restartAt = ev.map((e) => e.type).lastIndexOf("task-restart");
    const stages = ev.slice(restartAt).filter((e) => e.type === "stage").map((e) => `${String(e.stage)}:${e.passed === true ? "pass" : "fail"}`);
    expect(stages).toEqual(["tests:pass", "impl:pass", "verify:fail"]);
  });

  it("commitPaths stages only the given path; another changed file is left out of the commit", async () => {
    const { GitWorkspace } = await import("../src/workspace/git.ts");
    const wt = repo();
    writeFileSync(join(wt, "feature_list.json"), "{}\n");
    mkdirSync(join(wt, "src"), { recursive: true });
    writeFileSync(join(wt, "src/x.ts"), "x\n");
    const ws = new GitWorkspace(exec, { repoDir: wt, worktreesDir: join(wt, ".."), baseBranch: "main", remote: "origin" });
    expect(await ws.commitPaths(wt, ["feature_list.json"], "factory(verify): p#1 feature x passing", "coordinator")).toBe(true);
    expect(git(wt, "show", "--name-only", "--format=", "HEAD")).toBe("feature_list.json");
    expect(git(wt, "status", "--porcelain")).toBe("?? src/");
  });
});

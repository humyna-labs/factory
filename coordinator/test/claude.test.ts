// R-04: command assembly for headless Claude Code. No real CLI call here.
import { describe, expect, it } from "vitest";
import { buildClaudeInvocation, ClaudeRunner, summarizeStream } from "../src/runner/claude.ts";
import { loadRoleConfig } from "../src/runner/roles.ts";
import type { RoleSession } from "../src/runner/types.ts";
import type { Exec } from "../src/exec.ts";
import { ROLES } from "../src/types.ts";

const session = (role: RoleSession["role"] = "builder"): RoleSession => ({
  role,
  issue: { owner: "humyna-labs", repo: "resume-sg", number: 12, title: "Add a line", body: "Body", labels: [], state: "open" },
  stage: role === "qa" ? "tests" : role === "builder" ? "impl" : role === "reviewer" ? "review" : "compliance",
  attempt: 2,
  maxAttempts: 3,
  worktree: "/workspace/runs/worktrees/resume-sg-12",
  branch: "factory/resume-sg-12",
  reportPath: "/workspace/runs/reports/resume-sg-12/2026-11-25-resume-sg-12-impl-2.md",
  tracePath: "/tmp/trace.jsonl",
  previousFailure: "verify: unit failed",
  timeoutMs: 60_000,
});
const opts = { baseBranch: "main", reportsDir: "/workspace/runs/reports", guardLog: "/workspace/runs/guard.log" };
const flag = (args: string[], f: string) => args[args.indexOf(f) + 1];

describe("claude command assembly", () => {
  it.each(ROLES)("role %s: -p, auto permission mode, prompt file, settings, model, limits, stream-json", (role) => {
    const rc = loadRoleConfig(role);
    const inv = buildClaudeInvocation(session(role), rc, opts);
    expect(inv.cmd).toBe("claude");
    expect(inv.args[0]).toBe("-p");
    expect(inv.args.filter((a) => a === "--permission-mode")).toHaveLength(1);
    expect(flag(inv.args, "--permission-mode")).toBe("auto");
    expect(flag(inv.args, "--append-system-prompt-file")).toBe(rc.promptFile);
    expect(flag(inv.args, "--settings")).toMatch(new RegExp(`settings/${role}\\.json$`));
    expect(flag(inv.args, "--model")).toBe(rc.model);
    expect(flag(inv.args, "--max-turns")).toBe(String(rc.maxTurns));
    expect(flag(inv.args, "--max-budget-usd")).toBe(String(rc.maxBudgetUsd));
    expect(flag(inv.args, "--output-format")).toBe("stream-json");
    expect(inv.args).toContain("--verbose");
    expect(flag(inv.args, "--add-dir")).toBe("/workspace/runs/reports");
    expect(inv.cwd).toBe("/workspace/runs/worktrees/resume-sg-12");
  });

  it("never bypasses permissions (R-04)", () => {
    const joined = buildClaudeInvocation(session(), loadRoleConfig("builder"), opts).args.join(" ");
    expect(joined).not.toMatch(/dangerously|bypassPermissions|acceptEdits|dontAsk/);
  });

  it("passes the prompt on stdin with objective, report path and boundaries (P-09, R-20)", () => {
    const inv = buildClaudeInvocation(session(), loadRoleConfig("builder"), opts);
    expect(inv.args.join(" ")).not.toContain("Add a line");
    expect(inv.input).toContain("resume-sg#12: Add a line");
    expect(inv.input).toContain("attempt 2 of 3");
    expect(inv.input).toContain("Previous attempt failed: verify: unit failed");
    expect(inv.input).toContain(session().reportPath);
    expect(inv.input).toMatch(/do not commit, push, merge, or change labels/);
  });

  it("gives hooks their directories through the child env, nothing else", () => {
    const inv = buildClaudeInvocation(session(), loadRoleConfig("builder"), opts);
    expect(Object.keys(inv.env).sort()).toEqual(["FACTORY_GUARD_LOG", "FACTORY_REPORTS_DIR", "FACTORY_REPORT_PATH"]);
  });

  it("uses the agreed models: qa=sonnet, builder=sonnet, reviewer=opus, compliance=haiku", () => {
    expect(ROLES.map((r) => loadRoleConfig(r).model)).toEqual(["sonnet", "sonnet", "opus", "haiku"]);
  });
});

// Shape recorded from the one live call allowed in Phase 1 (Claude Code 2.1.331, haiku).
const LIVE_RESULT = '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"total_cost_usd":0.00218491,"result":"OK","permission_denials":[],"safety_stops":0}';

describe("stream-json parsing", () => {
  it("reads turns, cost and blocked actions from the result event", () => {
    const s = summarizeStream(['{"type":"system","subtype":"init","permissionMode":"auto"}', "not json", LIVE_RESULT]);
    expect(s).toMatchObject({ sawResult: true, isError: false, turns: 1, costUsd: 0.00218491, permissionDenials: 0, finalText: "OK" });
  });
  it("counts permission denials and safety stops", () => {
    const s = summarizeStream([JSON.stringify({ type: "result", is_error: false, num_turns: 4, total_cost_usd: 1, result: "PASS x", permission_denials: [{}, {}], safety_stops: 1 })]);
    expect(s.permissionDenials).toBe(3);
  });
  it("treats a missing result event as an error", () => {
    expect(summarizeStream(["{}"]).sawResult).toBe(false);
  });
  // resume-sg#11 (2026-11-26): a background subagent finished after QA's PASS and started one more turn.
  const res = (o: Record<string, unknown>): string => JSON.stringify({ type: "result", is_error: false, subtype: "success", permission_denials: [], ...o });
  it("keeps the verdict when a later result event carries no verdict", () => {
    const s = summarizeStream([
      res({ num_turns: 35, total_cost_usd: 1.1267, result: "PASS: the tests are written", permission_denials: [{}, {}] }),
      res({ num_turns: 1, total_cost_usd: 1.1453, result: "The monitor was only waiting on the Explore subagent.", is_error: true, subtype: "error_during_execution", permission_denials: [{}] }),
    ]);
    expect(s).toMatchObject({ sawResult: true, isError: false, subtype: "success", turns: 36, costUsd: 1.1453, permissionDenials: 2, finalText: "PASS: the tests are written" });
  });
  it("takes a verdict that arrives after a result event without one", () => {
    const s = summarizeStream([res({ num_turns: 3, total_cost_usd: 0.2, result: "Waiting for the subagent." }), res({ num_turns: 2, total_cost_usd: 0.3, result: "FAIL: one test\nTest-defect: a.ts:1 x" })]);
    expect(s.finalText.startsWith("FAIL: one test")).toBe(true);
    expect(s.turns).toBe(5);
  });
  it("keeps the session cost when a later result event has no cost", () => {
    const s = summarizeStream([res({ num_turns: 2, total_cost_usd: 0.8, result: "PASS ok" }), JSON.stringify({ type: "result", is_error: false, num_turns: 1, result: "done" })]);
    expect(s.costUsd).toBe(0.8);
  });
  it("lets a later verdict replace an earlier one", () => {
    const s = summarizeStream([res({ num_turns: 1, result: "PASS early" }), res({ num_turns: 1, result: "FAIL late" })]);
    expect(s.finalText).toBe("FAIL late");
  });
  it("uses the last result event when none carries a verdict", () => {
    const s = summarizeStream([res({ num_turns: 1, result: "first" }), res({ num_turns: 1, result: "second", is_error: true, subtype: "error_max_turns" })]);
    expect(s).toMatchObject({ finalText: "second", isError: true, subtype: "error_max_turns" });
  });
});

describe("ClaudeRunner", () => {
  it("passes when a follow-up turn after the PASS verdict has no verdict (resume-sg#11)", async () => {
    const fakeExec: Exec = async (_c, _a, o) => {
      o?.onStdoutLine?.(JSON.stringify({ type: "result", is_error: false, num_turns: 35, total_cost_usd: 1.1, result: "PASS: done" }));
      o?.onStdoutLine?.(JSON.stringify({ type: "result", is_error: false, num_turns: 1, total_cost_usd: 1.2, result: "Nothing left to re-arm." }));
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    };
    const runner = new ClaudeRunner({ exec: fakeExec, loadRole: loadRoleConfig, ...opts });
    const r = await runner.run(session("qa"));
    expect(r).toMatchObject({ ok: true, turns: 36, costUsd: 1.2, summary: "PASS: done" });
  });
  it("passes only with exit 0, a result event and a PASS verdict", async () => {
    let seenKind = "";
    const fakeExec: Exec = async (_c, _a, o) => {
      seenKind = o?.kind ?? "";
      o?.onStdoutLine?.(JSON.stringify({ type: "result", is_error: false, num_turns: 7, total_cost_usd: 0.5, result: "PASS done", permission_denials: [{}] }));
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    };
    const runner = new ClaudeRunner({ exec: fakeExec, loadRole: loadRoleConfig, ...opts });
    const s = { ...session(), tracePath: `/tmp/factory-claude-test-${process.pid}.jsonl` };
    expect(await runner.run(s)).toMatchObject({ ok: true, turns: 7, costUsd: 0.5, blockedActions: 1 });
    expect(seenKind).toBe("claude");
    const failing: Exec = async (_c, _a, o) => {
      o?.onStdoutLine?.(JSON.stringify({ type: "result", is_error: false, num_turns: 1, result: "FAIL tests wrong" }));
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    };
    expect((await new ClaudeRunner({ exec: failing, loadRole: loadRoleConfig, ...opts }).run(s)).ok).toBe(false);
  });
});

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
});

describe("ClaudeRunner", () => {
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

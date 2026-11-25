// Headless Claude Code runner (R-04). Phase 1: command assembly is unit-tested; one minimal
// live call verified flag parsing (see docs/reports/2026-11-25-D2-phase1.md).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Exec } from "../exec.ts";
import { sessionPrompt } from "./roles.ts";
import type { RoleConfig, RoleResult, RoleRunner, RoleSession } from "./types.ts";

export const PERMISSION_MODE = "auto";

export interface Invocation {
  cmd: string;
  args: string[];
  cwd: string;
  input: string;
  env: Record<string, string>;
}

export interface ClaudeRunnerOptions {
  exec: Exec;
  loadRole: (role: RoleSession["role"]) => RoleConfig;
  baseBranch: string;
  reportsDir: string;
  guardLog: string;
  /** For hooks/session-start.sh (W2-08); the hook's default applies when unset. */
  escalationsDir?: string;
}

export function buildClaudeInvocation(s: RoleSession, rc: RoleConfig, o: Pick<ClaudeRunnerOptions, "baseBranch" | "reportsDir" | "guardLog" | "escalationsDir">): Invocation {
  const args = [
    "-p",
    "--permission-mode",
    PERMISSION_MODE,
    "--append-system-prompt-file",
    rc.promptFile,
    "--settings",
    rc.settings,
    "--model",
    rc.model,
    "--max-turns",
    String(rc.maxTurns),
    "--max-budget-usd",
    String(rc.maxBudgetUsd),
    "--output-format",
    "stream-json",
    "--verbose",
    // The report file lives outside the worktree (R-20); make that one directory reachable.
    "--add-dir",
    o.reportsDir,
  ];
  if (rc.disallowedTools.length) args.push("--disallowedTools", rc.disallowedTools.join(","));
  return {
    cmd: "claude",
    args,
    cwd: s.worktree,
    input: sessionPrompt(s, o.baseBranch),
    // Hooks inherit this env: path-guard (reports dir, guard log), stop-report (this session's
    // report, W2-08) and session-start (escalations dir).
    env: { FACTORY_REPORTS_DIR: o.reportsDir, FACTORY_GUARD_LOG: o.guardLog, FACTORY_REPORT_PATH: s.reportPath, ...(o.escalationsDir ? { FACTORY_ESCALATIONS_DIR: o.escalationsDir } : {}) },
  };
}

export interface StreamSummary {
  sawResult: boolean;
  isError: boolean;
  subtype: string;
  turns: number;
  costUsd: number;
  permissionDenials: number;
  finalText: string;
}

/** Parse Claude Code stream-json output (one JSON object per line). Ignores lines it cannot parse. */
export function summarizeStream(lines: string[]): StreamSummary {
  const s: StreamSummary = { sawResult: false, isError: true, subtype: "missing", turns: 0, costUsd: 0, permissionDenials: 0, finalText: "" };
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (ev.type !== "result") continue;
    s.sawResult = true;
    s.isError = ev.is_error === true;
    s.subtype = typeof ev.subtype === "string" ? ev.subtype : "unknown";
    s.turns = typeof ev.num_turns === "number" ? ev.num_turns : 0;
    s.costUsd = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : 0;
    // Verified on Claude Code 2.1.331 (one live call, 2026-11-25): permission_denials is an
    // array and safety_stops is a number on the result event. Both count as blocked actions.
    s.permissionDenials = (Array.isArray(ev.permission_denials) ? ev.permission_denials.length : 0) + (typeof ev.safety_stops === "number" ? ev.safety_stops : 0);
    s.finalText = typeof ev.result === "string" ? ev.result : "";
  }
  return s;
}

export class ClaudeRunner implements RoleRunner {
  readonly name = "claude" as const;
  private readonly o: ClaudeRunnerOptions;
  constructor(o: ClaudeRunnerOptions) {
    this.o = o;
  }

  async run(s: RoleSession): Promise<RoleResult> {
    const inv = buildClaudeInvocation(s, this.o.loadRole(s.role), this.o);
    mkdirSync(dirname(s.tracePath), { recursive: true });
    const lines: string[] = [];
    const r = await this.o.exec(inv.cmd, inv.args, { cwd: inv.cwd, input: inv.input, env: inv.env, kind: "claude", timeoutMs: s.timeoutMs, onStdoutLine: (l) => lines.push(l) });
    writeFileSync(s.tracePath, lines.join("\n") + "\n");
    const sum = summarizeStream(lines);
    const verdictPass = /^\s*PASS\b/.test(sum.finalText);
    const ok = r.code === 0 && !r.timedOut && sum.sawResult && !sum.isError && verdictPass;
    const reason = r.timedOut
      ? `session timed out after ${Math.round(s.timeoutMs / 60000)} min`
      : !sum.sawResult
        ? `no result event (exit ${r.code})`
        : sum.isError
          ? `session ended with ${sum.subtype}`
          : (sum.finalText.split("\n")[0] ?? "").slice(0, 160);
    return { ok, turns: sum.turns, costUsd: sum.costUsd, blockedActions: sum.permissionDenials, summary: reason };
  }
}

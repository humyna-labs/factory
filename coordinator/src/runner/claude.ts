// Headless Claude Code runner (R-04). Phase 1: command assembly is unit-tested; one minimal
// live call verified flag parsing (see docs/reports/2026-11-25-D2-phase1.md).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Exec } from "../exec.ts";
import { factoryPath } from "../paths.ts";
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
    // A granted builder session uses the settings without the Edit denies of the granted dirs;
    // path-guard G1 then allows exactly the granted entries (jd2cv-m1).
    s.role === "builder" && s.grants?.length ? factoryPath("settings", "builder-grants.json") : rc.settings,
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
    env: { ...(s.role === "builder" && s.grants?.length ? { FACTORY_GRANTS: s.grants.join(",") } : {}), FACTORY_REPORTS_DIR: o.reportsDir, FACTORY_GUARD_LOG: o.guardLog, FACTORY_REPORT_PATH: s.reportPath, ...(o.escalationsDir ? { FACTORY_ESCALATIONS_DIR: o.escalationsDir } : {}) },
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

const VERDICT_RE = /^\s*(?:PASS|FAIL)\b/;

/**
 * Parse Claude Code stream-json output (one JSON object per line). Ignores lines it cannot parse.
 * A session can emit several result events: a background task (subagent, Monitor) that finishes after the
 * verdict starts one more turn, with its own result event (resume-sg#11, 2026-11-26: QA's PASS was replaced
 * by "The monitor was only waiting on the Explore subagent ..." and the task escalated). The verdict, error
 * state and final text therefore come from the last result event that starts with PASS or FAIL (the last
 * result event when none does); turns are summed; cost and blocked actions are the session maximum, because
 * total_cost_usd is cumulative and the denial count may be.
 */
export function summarizeStream(lines: string[]): StreamSummary {
  const s: StreamSummary = { sawResult: false, isError: true, subtype: "missing", turns: 0, costUsd: 0, permissionDenials: 0, finalText: "" };
  let verdictSeen = false;
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
    s.turns += typeof ev.num_turns === "number" ? ev.num_turns : 0;
    s.costUsd = Math.max(s.costUsd, typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : 0);
    // Verified on Claude Code 2.1.331 (one live call, 2026-11-25): permission_denials is an
    // array and safety_stops is a number on the result event. Both count as blocked actions.
    s.permissionDenials = Math.max(s.permissionDenials, (Array.isArray(ev.permission_denials) ? ev.permission_denials.length : 0) + (typeof ev.safety_stops === "number" ? ev.safety_stops : 0));
    const text = typeof ev.result === "string" ? ev.result : "";
    const isVerdict = VERDICT_RE.test(text);
    if (verdictSeen && !isVerdict) continue;
    verdictSeen ||= isVerdict;
    s.isError = ev.is_error === true;
    s.subtype = typeof ev.subtype === "string" ? ev.subtype : "unknown";
    s.finalText = text;
  }
  return s;
}

/**
 * A FAIL final message may carry "Test-defect: <file:line> <reason>" lines (builder, jd2cv-m1), one per defect.
 * All of them go to QA, joined with " | " (resume-sg#13: the builder found two defects, only the first reached QA,
 * and the second escalated the task). Each is cut to 300 bytes, at most 4 are kept.
 */
export function testDefectOf(finalText: string): string | undefined {
  if (!/^\s*FAIL\b/.test(finalText)) return undefined;
  const all = [...finalText.matchAll(/^Test-defect:[ \t]*(\S.*)$/gm)].map((m) => (m[1] ?? "").replace(/[^\x20-\x7E]/g, "?").slice(0, 300));
  return all.length ? all.slice(0, 4).join(" | ") : undefined;
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
    const defect = testDefectOf(sum.finalText);
    return { ok, turns: sum.turns, costUsd: sum.costUsd, blockedActions: sum.permissionDenials, summary: reason, ...(defect ? { testDefect: defect } : {}) };
  }
}

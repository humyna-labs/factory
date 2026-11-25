// The deterministic coordinator (P-01): drives one task through the state machine.
// It alone changes state labels and merges (R-02). Roles only run inside a stage.
import { existsSync, readFileSync } from "node:fs";
import type { FactoryConfig } from "./config.ts";
import { writeEscalationDraft, harnessFixIssue, harnessFixLine, type AttemptRecord } from "./escalation.ts";
import type { EventLog } from "./events.ts";
import type { Exec } from "./exec.ts";
import type { GateRunner } from "./gates/types.ts";
import type { GitHubAdapter } from "./github/types.ts";
import { mergeLowRisk } from "./merge.ts";
import type { RunPaths } from "./paths.ts";
import { checkReport, reportPath } from "./report.ts";
import { assessRisk } from "./risk.ts";
import { isoUtc, type RunsCsvWriter } from "./runs-csv.ts";
import type { RoleRunner } from "./runner/types.ts";
import { outOfScope } from "./scope.ts";
import { isTerminal, stateLabel, STATES, transition, type Risk, type Stage, type State } from "./state.ts";
import { STAGE_ROLE, taskId, type Issue, type Role, type StageOutcome } from "./types.ts";
import type { GitWorkspace } from "./workspace/git.ts";

export interface Deps {
  cfg: FactoryConfig;
  gh: GitHubAdapter;
  runner: RoleRunner;
  gates: GateRunner;
  workspace: GitWorkspace;
  exec: Exec;
  ledger: RunsCsvWriter;
  events: EventLog;
  paths: RunPaths;
  now: () => Date;
  /** Stop starting new stages after this time (queue mode, R-12). */
  deadline?: Date;
}

export interface TaskResult {
  task: string;
  final: State;
  stoppedForTime: boolean;
  risk?: Risk;
  prUrl?: string;
  harnessFixIssue?: string;
  turns: number;
  costUsd: number;
  blockedActions: number;
}

const ALL_STATE_LABELS = STATES.map(stateLabel);

function guardLines(path: string): number {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).length : 0;
}

export async function setState(d: Deps, issue: Issue, s: State): Promise<void> {
  const label = stateLabel(s);
  await d.gh.setLabels(issue.owner, issue.repo, issue.number, [label], ALL_STATE_LABELS.filter((l) => l !== label));
  d.events.write({ ts: isoUtc(d.now()), type: "state", task: taskId(issue), state: s });
}

export async function runTask(d: Deps, issue: Issue): Promise<TaskResult> {
  const id = taskId(issue);
  const res: TaskResult = { task: id, final: "ready", stoppedForTime: false, turns: 0, costUsd: 0, blockedActions: 0 };
  const history: AttemptRecord[] = [];
  const reports: string[] = [];
  const max = d.cfg.max_impl_attempts;
  let implAttempts = 0;
  let previousFailure: string | undefined;
  let lastHarnessFix: string | undefined;
  let risk: Risk = "high";
  let state: State = transition("ready", true, { implAttempts, maxImplAttempts: max, risk });
  const { worktree, branch } = await d.workspace.prepare(issue);
  await setState(d, issue, state);

  while (!isTerminal(state)) {
    if (d.deadline && d.now() >= d.deadline) {
      res.stoppedForTime = true;
      d.events.write({ ts: isoUtc(d.now()), type: "stopped-time-budget", task: id, stage: state });
      break;
    }
    const stage = state as Stage;
    if (stage === "impl") implAttempts++;
    const attempt = Math.max(implAttempts, 1);
    const start = d.now();
    const out = await runStage(d, issue, stage, attempt, { worktree, branch, previousFailure, reports });
    const end = d.now();
    res.turns += out.turns;
    res.costUsd += out.costUsd;
    res.blockedActions += out.blockedActions;
    if (out.risk) risk = out.risk;
    if (out.prUrl) res.prUrl = out.prUrl;
    if (out.proposedHarnessFix) lastHarnessFix = out.proposedHarnessFix;
    history.push({ stage, attempt, passed: out.passed, reason: out.reason });
    d.ledger.append({ task: id, stage, role: STAGE_ROLE[stage], start: isoUtc(start), end: isoUtc(end), turns: out.turns, cost: out.costUsd, outcome: out.passed ? "pass" : "fail", escalated: false, harness_fix: "" });
    d.events.write({ ts: isoUtc(end), type: "stage", task: id, stage, attempt, passed: out.passed, reason: out.reason, blocked: out.blockedActions });
    previousFailure = out.passed ? undefined : `${stage}: ${out.reason}`;
    const next = transition(stage, out.passed, { implAttempts, maxImplAttempts: max, risk });

    if (next === "escalated") {
      const input = { issue, failedStage: stage, history, maxImplAttempts: max, reportPaths: reports, ...(lastHarnessFix ? { proposedHarnessFix: lastHarnessFix } : {}) };
      const line = harnessFixLine(input);
      writeEscalationDraft(d.paths.escalationsDir, input);
      const draft = harnessFixIssue(input);
      const [fOwner, fRepo] = d.cfg.factory_repo.split("/") as [string, string];
      const created = await d.gh.createIssue(fOwner, fRepo, draft.title, draft.body, ["harness-fix"]);
      res.harnessFixIssue = created.url;
      await d.gh.comment(issue.owner, issue.repo, issue.number, `Escalated after ${max} builder attempts. Harness fix: ${created.url}\n\n${draft.body.split("## Options for the human")[1] ? "Options:" + draft.body.split("## Options for the human")[1] : ""}`);
      const t = isoUtc(d.now());
      d.ledger.append({ task: id, stage, role: "coordinator", start: t, end: t, turns: 0, cost: 0, outcome: "escalated", escalated: true, harness_fix: line });
    } else if (next === "auto-merge" || next === "needs-human") {
      const t = isoUtc(d.now());
      d.ledger.append({ task: id, stage: "pr", role: "coordinator", start: t, end: t, turns: 0, cost: 0, outcome: next, escalated: false, harness_fix: "" });
    }
    state = next;
    await setState(d, issue, state);
  }
  res.final = state;
  res.risk = risk;
  return res;
}

interface StageCtx {
  worktree: string;
  branch: string;
  previousFailure: string | undefined;
  reports: string[];
}

const ZERO = { turns: 0, costUsd: 0, blockedActions: 0 };

async function runRole(d: Deps, issue: Issue, role: Role, stage: Stage, attempt: number, c: StageCtx): Promise<StageOutcome> {
  const rp = reportPath(d.paths.reportsDir, issue.repo, issue.number, stage, attempt, d.now());
  c.reports.push(rp);
  const before = guardLines(d.paths.guardLog);
  const r = await d.runner.run({
    role,
    issue,
    stage,
    attempt,
    maxAttempts: d.cfg.max_impl_attempts,
    worktree: c.worktree,
    branch: c.branch,
    reportPath: rp,
    tracePath: `${d.paths.tracesDir}/${issue.repo}-${issue.number}/${stage}-${attempt}.jsonl`,
    timeoutMs: d.cfg.session_timeout_minutes * 60_000,
    ...(c.previousFailure ? { previousFailure: c.previousFailure } : {}),
  });
  const blocked = r.blockedActions + Math.max(0, guardLines(d.paths.guardLog) - before);
  const base = { turns: r.turns, costUsd: r.costUsd, blockedActions: blocked };
  const report = checkReport(rp);
  const fix = report.proposedHarnessFix ? { proposedHarnessFix: report.proposedHarnessFix } : {};
  const changed = await d.workspace.changedFiles(c.worktree);
  const denied = await outOfScope(d.exec, role, c.worktree, changed);
  let failure: string | undefined;
  if (denied.length) failure = `out-of-scope writes by ${role}: ${denied.join(", ")}`;
  else if (!report.ok) failure = `report check failed: ${report.problems.join("; ")}`;
  else if (!r.ok) failure = r.summary;
  if (failure) {
    await d.workspace.reset(c.worktree);
    return { passed: false, reason: failure, ...base, ...fix };
  }
  if (role === "reviewer" || role === "compliance") {
    if (changed.length) return { passed: false, reason: `read-only role ${role} changed files`, ...base, ...fix };
  } else {
    await d.workspace.commit(c.worktree, `factory(${stage}): ${issue.repo}#${issue.number} attempt ${attempt}`, role);
  }
  return { passed: true, reason: r.summary, ...base, ...fix };
}

async function runStage(d: Deps, issue: Issue, stage: Stage, attempt: number, c: StageCtx): Promise<StageOutcome> {
  const id = taskId(issue);
  switch (stage) {
    case "tests": {
      const out = await runRole(d, issue, "qa", stage, attempt, c);
      if (!out.passed) return out;
      const red = await d.gates.red({ worktree: c.worktree, task: id, attempt });
      return red.ok ? out : { ...out, passed: false, reason: `red check: ${red.detail}` };
    }
    case "impl":
      return runRole(d, issue, "builder", stage, attempt, c);
    case "review":
      return runRole(d, issue, "reviewer", stage, attempt, c);
    case "compliance":
      return runRole(d, issue, "compliance", stage, attempt, c);
    case "verify": {
      const results = await d.gates.verify({ worktree: c.worktree, task: id, attempt });
      const failed = results.filter((g) => !g.ok);
      return { passed: failed.length === 0, reason: failed.length ? failed.map((g) => `${g.name}: ${g.detail}`).join("; ") : "all gates pass", ...ZERO };
    }
    case "pr": {
      const changed = await d.workspace.filesChangedFromBase(c.worktree);
      const decision = assessRisk(issue.labels, changed, d.cfg.high_risk_paths);
      await d.workspace.push(c.worktree, c.branch);
      const body = [`Closes #${issue.number}`, "", `Risk: ${decision.risk}`, ...decision.reasons.map((r) => `- ${r}`), "", "Opened by the factory coordinator. Agent-Role: coordinator"].join("\n");
      const pr = await d.gh.findOrOpenPullRequest(issue.owner, issue.repo, c.branch, d.cfg.base_branch, `${issue.title} (#${issue.number})`, body);
      await d.gh.setLabels(issue.owner, issue.repo, pr.number, [`risk:${decision.risk}`], [`risk:${decision.risk === "low" ? "high" : "low"}`]);
      if (decision.risk === "high") {
        await d.gh.comment(issue.owner, issue.repo, pr.number, `Needs human approval (high risk):\n${decision.reasons.map((r) => `- ${r}`).join("\n")}`);
        return { passed: true, reason: `high risk: ${decision.reasons.join("; ")}`, risk: "high", prUrl: pr.url, ...ZERO };
      }
      try {
        const m = await mergeLowRisk(d.gh, issue.owner, issue.repo, pr.number, decision.risk);
        return { passed: true, reason: m.merged ? "merged" : "auto-merge enabled", risk: "low", prUrl: pr.url, ...ZERO };
      } catch (err) {
        return { passed: false, reason: (err as Error).message, risk: "low", prUrl: pr.url, ...ZERO };
      }
    }
  }
}

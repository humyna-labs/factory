// The deterministic coordinator (P-01): drives one task through the state machine.
// It alone changes state labels and merges (R-02). Roles only run inside a stage.
//
// Resume (BL-03, W2-06): events.jsonl is the commit point. For every stage the coordinator writes
// "stage-start", runs the stage, appends the runs.csv row, writes a "stage" event that carries
// the outcome, then moves the label. A re-run that finds a factory:<stage> label rebuilds the task
// from the events after the task's last "task-start": a finished stage is never re-run (its
// transition is applied), an interrupted one re-runs with the same attempt number in a reset
// worktree. Escalation, PR and merge steps check before they act, so nothing is created twice.
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { FactoryConfig } from "./config.ts";
import { writeEscalationDraft, harnessFixIssue, harnessFixLine, type AttemptRecord } from "./escalation.ts";
import { readEvents, type EventLog, type FactoryEvent } from "./events.ts";
import type { Exec } from "./exec.ts";
import { featureOf, markFeature } from "./features.ts";
import type { GateRunner } from "./gates/types.ts";
import type { GitHubAdapter } from "./github/types.ts";
import { mergeLowRisk } from "./merge.ts";
import type { RunPaths } from "./paths.ts";
import { appendReportIndex, checkReport, reportPath } from "./report.ts";
import { assessRisk } from "./risk.ts";
import { isoUtc, type RunsCsvWriter } from "./runs-csv.ts";
import type { RoleRunner } from "./runner/types.ts";
import { outOfScope } from "./scope.ts";
import { isTerminal, stateLabel, STAGES, STATES, transition, type Risk, type Stage, type State } from "./state.ts";
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
  /** Resumed after an interruption (W2-06). */
  resumed?: boolean;
  /** Skipped because the same stage was interrupted twice in a row (W2-06). */
  resumeLoop?: boolean;
  risk?: Risk;
  prUrl?: string;
  harnessFixIssue?: string;
  turns: number;
  costUsd: number;
  blockedActions: number;
}

const ALL_STATE_LABELS = STATES.map(stateLabel);
/** Interrupted starts of one stage, in a row, after which a resume gives up (W2-06). */
export const MAX_INTERRUPTED_STARTS = 2;

function guardLines(path: string): number {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).length : 0;
}

export async function setState(d: Deps, issue: Issue, s: State): Promise<void> {
  const label = stateLabel(s);
  await d.gh.setLabels(issue.owner, issue.repo, issue.number, [label], ALL_STATE_LABELS.filter((l) => l !== label));
  d.events.write({ ts: isoUtc(d.now()), type: "state", task: taskId(issue), state: s });
}

/** The in-flight stage named by the issue's labels, if any. */
export function labelledStage(issue: Issue): Stage | undefined {
  return STAGES.find((s) => issue.labels.includes(stateLabel(s)));
}

interface TaskCtx {
  issue: Issue;
  id: string;
  max: number;
  implAttempts: number;
  history: AttemptRecord[];
  reports: string[];
  previousFailure: string | undefined;
  lastHarnessFix: string | undefined;
  risk: Risk;
  /** Events of this task since its last task-start. */
  past: FactoryEvent[];
}

function taskEvents(d: Deps, id: string): FactoryEvent[] {
  const all = readEvents(d.paths.events).filter((e) => e.task === id);
  const start = all.map((e) => e.type).lastIndexOf("task-start");
  return start < 0 ? [] : all.slice(start + 1);
}

/** Rebuild the task context from events (W2-06). */
function rebuild(c: TaskCtx): void {
  for (const e of c.past) {
    if (e.type === "stage-start" && typeof e.report === "string") c.reports.push(e.report);
    if (e.type !== "stage") continue;
    const stage = e.stage as Stage;
    if (stage === "impl") c.implAttempts++;
    c.history.push({ stage, attempt: Number(e.attempt), passed: e.passed === true, reason: String(e.reason ?? "") });
    c.previousFailure = e.passed === true ? undefined : `${stage}: ${String(e.reason ?? "")}`;
    if (typeof e.harness_fix_proposal === "string") c.lastHarnessFix = e.harness_fix_proposal;
    if (e.risk === "low" || e.risk === "high") c.risk = e.risk;
  }
}

export async function runTask(d: Deps, issue: Issue): Promise<TaskResult> {
  const id = taskId(issue);
  const res: TaskResult = { task: id, final: "ready", stoppedForTime: false, turns: 0, costUsd: 0, blockedActions: 0 };
  const c: TaskCtx = { issue, id, max: d.cfg.max_impl_attempts, implAttempts: 0, history: [], reports: [], previousFailure: undefined, lastHarnessFix: undefined, risk: "high", past: [] };
  const resumeAt = labelledStage(issue);
  const { worktree, branch } = await d.workspace.prepare(issue);
  let state: State;

  if (resumeAt === undefined) {
    d.events.write({ ts: isoUtc(d.now()), type: "task-start", task: id });
    state = transition("ready", true, { implAttempts: 0, maxImplAttempts: c.max, risk: c.risk });
    await setState(d, issue, state);
  } else {
    c.past = taskEvents(d, id);
    rebuild(c);
    res.resumed = true;
    state = resumeAt;
    const lastStep = [...c.past].reverse().find((e) => e.type === "stage" || e.type === "stage-start");
    let interrupted = 0;
    for (const e of [...c.past].reverse()) {
      if (e.type === "stage") break;
      if (e.type === "stage-start") interrupted++;
    }
    d.events.write({ ts: isoUtc(d.now()), type: "task-resume", task: id, state, interrupted });
    if (interrupted >= MAX_INTERRUPTED_STARTS) {
      res.resumeLoop = true;
      res.final = state;
      d.events.write({ ts: isoUtc(d.now()), type: "resume-loop", task: id, stage: state });
      return res;
    }
    await d.workspace.reset(worktree);
    if (lastStep?.type === "stage" && lastStep.stage === state) {
      // The stage finished before the interruption but the label did not move: do not re-run it.
      state = await advance(d, c, state, lastStep.passed === true, res);
    }
  }

  while (!isTerminal(state)) {
    if (d.deadline && d.now() >= d.deadline) {
      res.stoppedForTime = true;
      d.events.write({ ts: isoUtc(d.now()), type: "stopped-time-budget", task: id, stage: state });
      break;
    }
    const stage = state as Stage;
    const attempt = stage === "impl" ? c.implAttempts + 1 : Math.max(c.implAttempts, 1);
    const start = d.now();
    const rp = STAGE_ROLE[stage] === "coordinator" ? undefined : reportPath(d.paths.reportsDir, issue.repo, issue.number, stage, attempt, start);
    d.events.write({ ts: isoUtc(start), type: "stage-start", task: id, stage, attempt, ...(rp ? { report: rp } : {}) });
    const out = await runStage(d, issue, stage, attempt, { worktree, branch, previousFailure: c.previousFailure, reports: c.reports, reportPath: rp });
    const end = d.now();
    if (stage === "impl") c.implAttempts++;
    res.turns += out.turns;
    res.costUsd += out.costUsd;
    res.blockedActions += out.blockedActions;
    if (out.risk) c.risk = out.risk;
    if (out.prUrl) res.prUrl = out.prUrl;
    if (out.proposedHarnessFix) c.lastHarnessFix = out.proposedHarnessFix;
    c.history.push({ stage, attempt, passed: out.passed, reason: out.reason });
    // Row first, then the event: a resume trusts the event, so a finished stage is never logged twice.
    d.ledger.append({ task: id, stage, role: STAGE_ROLE[stage], start: isoUtc(start), end: isoUtc(end), turns: out.turns, cost: out.costUsd, outcome: out.passed ? "pass" : "fail", escalated: false, harness_fix: "" });
    d.events.write({
      ts: isoUtc(end),
      type: "stage",
      task: id,
      stage,
      attempt,
      passed: out.passed,
      reason: out.reason,
      blocked: out.blockedActions,
      ...(out.risk ? { risk: out.risk } : {}),
      ...(out.proposedHarnessFix ? { harness_fix_proposal: out.proposedHarnessFix } : {}),
    });
    c.previousFailure = out.passed ? undefined : `${stage}: ${out.reason}`;
    state = await advance(d, c, stage, out.passed, res);
  }
  res.final = state;
  res.risk = c.risk;
  // W2-05: finished worktrees go; needs-human ones stay (the human may ask for changes) and are
  // listed in the digest so they do not pile up.
  if (state === "auto-merge" || state === "escalated") await d.workspace.cleanup(worktree);
  return res;
}

/** Apply the transition after a finished stage: terminal rows, escalation, then the label. */
async function advance(d: Deps, c: TaskCtx, stage: Stage, passed: boolean, res: TaskResult): Promise<State> {
  const { issue, id, max } = c;
  const next = transition(stage, passed, { implAttempts: c.implAttempts, maxImplAttempts: max, risk: c.risk });
  const done = (type: string) => c.past.some((e) => e.type === type);
  if (next === "escalated") {
    const input = { issue, failedStage: stage, history: c.history, maxImplAttempts: max, reportPaths: c.reports, ...(c.lastHarnessFix ? { proposedHarnessFix: c.lastHarnessFix } : {}) };
    const line = harnessFixLine(input);
    writeEscalationDraft(d.paths.escalationsDir, input);
    const draft = harnessFixIssue(input);
    const [fOwner, fRepo] = d.cfg.factory_repo.split("/") as [string, string];
    // Idempotent: reuse an open harness-fix issue with the same title (a resumed run, W2-06).
    const open = (await d.gh.listOpenIssues(fOwner, fRepo, "harness-fix")).find((i) => i.title === draft.title);
    const created = open ? { url: `https://github.com/${fOwner}/${fRepo}/issues/${open.number}` } : await d.gh.createIssue(fOwner, fRepo, draft.title, draft.body, ["harness-fix"]);
    res.harnessFixIssue = created.url;
    if (!done("escalation-comment")) {
      await d.gh.comment(issue.owner, issue.repo, issue.number, `Escalated after ${max} builder attempts. Harness fix: ${created.url}\n\n${draft.body.split("## Options for the human")[1] ? "Options:" + draft.body.split("## Options for the human")[1] : ""}`);
      d.events.write({ ts: isoUtc(d.now()), type: "escalation-comment", task: id });
    }
    if (!done("terminal")) {
      const t = isoUtc(d.now());
      d.ledger.append({ task: id, stage, role: "coordinator", start: t, end: t, turns: 0, cost: 0, outcome: "escalated", escalated: true, harness_fix: line });
      d.events.write({ ts: t, type: "terminal", task: id, outcome: "escalated" });
    }
  } else if (next === "auto-merge" || next === "needs-human") {
    if (!done("terminal")) {
      const t = isoUtc(d.now());
      d.ledger.append({ task: id, stage: "pr", role: "coordinator", start: t, end: t, turns: 0, cost: 0, outcome: next, escalated: false, harness_fix: "" });
      d.events.write({ ts: t, type: "terminal", task: id, outcome: next });
    }
  }
  await setState(d, issue, next);
  return next;
}

interface StageCtx {
  worktree: string;
  branch: string;
  previousFailure: string | undefined;
  reports: string[];
  reportPath: string | undefined;
}

const ZERO = { turns: 0, costUsd: 0, blockedActions: 0 };

async function runRole(d: Deps, issue: Issue, role: Role, stage: Stage, attempt: number, c: StageCtx): Promise<StageOutcome> {
  const rp = c.reportPath ?? reportPath(d.paths.reportsDir, issue.repo, issue.number, stage, attempt, d.now());
  c.reports.push(rp);
  // A report left by an interrupted session of the same stage and attempt is not this session's.
  rmSync(rp, { force: true });
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
  if (existsSync(rp)) appendReportIndex(d.paths.reportsDir, { path: rp, repo: issue.repo, issue: issue.number, stage, attempt, utc: isoUtc(d.now()) });
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
      // W2-07 (P-06): only this stage marks the task's feature as passing, or back to failing.
      const feature = featureOf(issue);
      let mark: string;
      try {
        mark = markFeature(c.worktree, feature, failed.length === 0, isoUtc(d.now()));
      } catch (err) {
        mark = `invalid feature_list.json: ${(err as Error).message.split("\n")[0] ?? ""}`;
      }
      d.events.write({ ts: isoUtc(d.now()), type: "feature-list", task: id, feature: feature ?? "", result: mark });
      if (mark === "updated") await d.workspace.commit(c.worktree, `factory(verify): ${issue.repo}#${issue.number} feature ${feature ?? ""} ${failed.length ? "failing" : "passing"}`, "coordinator");
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
      if (pr.merged) return { passed: true, reason: "already merged", risk: "low", prUrl: pr.url, ...ZERO };
      try {
        const m = await mergeLowRisk(d.gh, issue.owner, issue.repo, pr.number, decision.risk);
        return { passed: true, reason: m.merged ? "merged" : "auto-merge enabled", risk: "low", prUrl: pr.url, ...ZERO };
      } catch (err) {
        return { passed: false, reason: (err as Error).message, risk: "low", prUrl: pr.url, ...ZERO };
      }
    }
  }
}

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
import { decideGrants, grantedChanges, type Grant } from "./grants.ts";
import type { GateRunner } from "./gates/types.ts";
import { FACTORY_LOGIN, type GitHubAdapter, type OpenPullRequest } from "./github/types.ts";
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
  /** Waits between merge polls (queue mode); tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
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
  /** QA sessions so far (the first one plus re-runs after a test defect, jd2cv-m1). */
  testRuns: number;
  /** The last finished stage was a builder failure that named a defective test. */
  testDefect: boolean;
  history: AttemptRecord[];
  reports: string[];
  previousFailure: string | undefined;
  lastHarnessFix: string | undefined;
  risk: Risk;
  /** Events of this task since its last task-start. */
  past: FactoryEvent[];
  /** Protected paths the issue grants to the builder (jd2cv-m1). */
  grants: Grant[];
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
    if (stage === "tests") c.testRuns++;
    c.testDefect = typeof e.test_defect === "string";
    c.history.push({ stage, attempt: Number(e.attempt), passed: e.passed === true, reason: String(e.reason ?? "") });
    c.previousFailure = e.passed === true ? undefined : c.testDefect ? `${stage}: Test-defect: ${String(e.test_defect)}` : `${stage}: ${String(e.reason ?? "")}`;
    if (typeof e.harness_fix_proposal === "string") c.lastHarnessFix = e.harness_fix_proposal;
    if (e.risk === "low" || e.risk === "high") c.risk = e.risk;
  }
}

/**
 * Restart a task from the tests stage after its issue was revised (jd2cv-m1, owner 15:25 SGT: resume-sg#8 was
 * revised to brief v5.2 after QA had written tests for v4). The coordinator, not a human, moves the label (R-02):
 * it records a task-restart event, removes the task worktree (the next run starts from the fetched base on a new
 * branch factory/<repo>-<n>-r<k>, F04; its PR closes the earlier one), and sets factory:ready. Refuses an open PR's task (re-run it instead) and a closed issue.
 */
export async function restartTask(d: Deps, issue: Issue, reason: string): Promise<Issue> {
  if (issue.state !== "open") throw new Error(`${taskId(issue)} is closed; nothing to restart`);
  const from = STATES.find((s) => issue.labels.includes(stateLabel(s)));
  if (from === "pr" || from === "needs-human" || from === "auto-merge") throw new Error(`${taskId(issue)} is at ${from}; a PR exists, re-run it instead of restarting`);
  d.events.write({ ts: isoUtc(d.now()), type: "task-restart", task: taskId(issue), from: from ?? "none", reason: reason.replace(/[^\x20-\x7E]/g, "?").slice(0, 200) });
  const wt = d.workspace.worktreeFor(issue);
  await d.workspace.cleanup(wt);
  await setState(d, issue, "ready");
  return { ...issue, labels: [...issue.labels.filter((l) => !l.startsWith("factory:") || l === "factory:blocked"), stateLabel("ready")] };
}

export async function runTask(d: Deps, issue: Issue): Promise<TaskResult> {
  const id = taskId(issue);
  const res: TaskResult = { task: id, final: "ready", stoppedForTime: false, turns: 0, costUsd: 0, blockedActions: 0 };
  const c: TaskCtx = { issue, id, max: d.cfg.max_impl_attempts, implAttempts: 0, testRuns: 0, testDefect: false, history: [], reports: [], previousFailure: undefined, lastHarnessFix: undefined, risk: "high", past: [], grants: [] };
  const gd = decideGrants(issue);
  c.grants = gd.grants;
  if (gd.grants.length || gd.refused) d.events.write({ ts: isoUtc(d.now()), type: "grants", task: id, granted: gd.grants.join(","), ...(gd.refused ? { refused: gd.refused } : {}) });
  const resumeAt = labelledStage(issue);
  // F04: restarts so far decide the branch (a restart never reuses a pushed branch).
  const restarts = readEvents(d.paths.events).filter((e) => e.type === "task-restart" && e.task === id).length;
  const { worktree, branch } = await d.workspace.prepare(issue, restarts);
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
    // QA counts its own sessions, so a re-run after a test defect gets its own report and trace.
    const attempt = stage === "impl" ? c.implAttempts + 1 : stage === "tests" ? c.testRuns + 1 : Math.max(c.implAttempts, 1);
    const start = d.now();
    const rp = STAGE_ROLE[stage] === "coordinator" ? undefined : reportPath(d.paths.reportsDir, issue.repo, issue.number, stage, attempt, start);
    d.events.write({ ts: isoUtc(start), type: "stage-start", task: id, stage, attempt, ...(rp ? { report: rp } : {}) });
    const out = await runStage(d, issue, stage, attempt, { worktree, branch, previousFailure: c.previousFailure, reports: c.reports, reportPath: rp, grants: c.grants });
    const end = d.now();
    if (stage === "impl") c.implAttempts++;
    if (stage === "tests") c.testRuns++;
    c.testDefect = stage === "impl" && !out.passed && out.testDefect !== undefined;
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
      ...(c.testDefect && out.testDefect ? { test_defect: out.testDefect } : {}),
    });
    c.previousFailure = out.passed ? undefined : c.testDefect ? `${stage}: Test-defect: ${out.testDefect ?? ""}` : `${stage}: ${out.reason}`;
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
  const next = transition(stage, passed, { implAttempts: c.implAttempts, maxImplAttempts: max, risk: c.risk, testDefect: c.testDefect, testRewrites: Math.max(0, c.testRuns - 1) });
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
  grants: Grant[];
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
    ...(c.grants.length && (role === "builder" || role === "reviewer") ? { grants: c.grants } : {}),
  });
  // A hook denial shows up twice: as a guard.log line and in the session's permission_denials.
  // Count it once (jd2cv-m1); the guard.log count still holds if the session dies before its result.
  const blocked = Math.max(r.blockedActions, guardLines(d.paths.guardLog) - before);
  const base = { turns: r.turns, costUsd: r.costUsd, blockedActions: blocked };
  if (existsSync(rp)) appendReportIndex(d.paths.reportsDir, { path: rp, repo: issue.repo, issue: issue.number, stage, attempt, utc: isoUtc(d.now()) });
  const report = checkReport(rp);
  const fix = { ...(report.proposedHarnessFix ? { proposedHarnessFix: report.proposedHarnessFix } : {}), ...(role === "builder" && r.testDefect ? { testDefect: r.testDefect } : {}) };
  const changed = await d.workspace.changedFiles(c.worktree);
  const denied = await outOfScope(d.exec, role, c.worktree, changed, c.grants);
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

/**
 * F04 (owner, 2026-11-28): a restart pushes to a new branch, so its new PR supersedes the open PR of the earlier
 * branch. The coordinator closes (never merges) only PRs it opened itself: author FACTORY_LOGIN and a head branch
 * factory/<repo>-<n> or factory/<repo>-<n>-r<k> of this task. Each gets a comment with the new PR's link.
 */
export function supersededPulls(open: OpenPullRequest[], issue: Pick<Issue, "repo" | "number">, current: string): OpenPullRequest[] {
  const prefix = `factory/${issue.repo}-${issue.number}`;
  const ownBranch = (h: string) => h === prefix || (h.startsWith(`${prefix}-r`) && /^[0-9]+$/.test(h.slice(prefix.length + 2)));
  return open.filter((p) => p.author === FACTORY_LOGIN && p.head.startsWith("factory/") && ownBranch(p.head) && p.head !== current);
}

async function closeSuperseded(d: Deps, issue: Issue, current: string, url: string): Promise<void> {
  for (const old of supersededPulls(await d.gh.listOpenPullRequests(issue.owner, issue.repo), issue, current)) {
    await d.gh.closePullRequest(issue.owner, issue.repo, old.number, `Superseded by ${url}: the task was restarted on the new branch ${current} (no force pushes, F04). Closed by the factory coordinator. Agent-Role: coordinator`);
    d.events.write({ ts: isoUtc(d.now()), type: "pr-superseded", task: taskId(issue), closed: old.number, by: url });
  }
}

async function runStage(d: Deps, issue: Issue, stage: Stage, attempt: number, c: StageCtx): Promise<StageOutcome> {
  const id = taskId(issue);
  switch (stage) {
    case "tests": {
      const out = await runRole(d, issue, "qa", stage, attempt, c);
      if (!out.passed) return out;
      const base = await d.workspace.baseSha(c.worktree);
      const red = await d.gates.red({ worktree: c.worktree, task: id, attempt, ...(base ? { base } : {}) });
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
      const granted = grantedChanges(changed, c.grants);
      // Owner condition c: every granted path that changed is listed at the top of the PR body.
      const top = c.grants.length ? [`Granted paths changed (Grants: ${c.grants.join(", ")}):`, ...(granted.length ? granted.map((p) => `- ${p}`) : ["- none"]), ""] : [];
      const body = [...top, `Closes #${issue.number}`, "", `Risk: ${decision.risk}`, ...decision.reasons.map((r) => `- ${r}`), "", "Opened by the factory coordinator. Agent-Role: coordinator"].join("\n");
      const pr = await d.gh.findOrOpenPullRequest(issue.owner, issue.repo, c.branch, d.cfg.base_branch, `${issue.title} (#${issue.number})`, body);
      await closeSuperseded(d, issue, c.branch, pr.url);
      await d.gh.setLabels(issue.owner, issue.repo, pr.number, [`risk:${decision.risk}`], [`risk:${decision.risk === "low" ? "high" : "low"}`]);
      if (decision.risk === "high") {
        await d.gh.comment(issue.owner, issue.repo, pr.number, `Needs human approval (high risk):\n${decision.reasons.map((r) => `- ${r}`).join("\n")}`);
        return { passed: true, reason: `high risk: ${decision.reasons.join("; ")}`, risk: "high", prUrl: pr.url, ...ZERO };
      }
      if (pr.merged) return { passed: true, reason: "already merged", risk: "low", prUrl: pr.url, ...ZERO };
      if (pr.autoMerge) return { passed: true, reason: "auto-merge already enabled", risk: "low", prUrl: pr.url, ...ZERO };
      try {
        const m = await mergeLowRisk(d.gh, issue.owner, issue.repo, pr.number, decision.risk);
        return { passed: true, reason: m.merged ? "merged" : "auto-merge enabled", risk: "low", prUrl: pr.url, ...ZERO };
      } catch (err) {
        return { passed: false, reason: (err as Error).message, risk: "low", prUrl: pr.url, ...ZERO };
      }
    }
  }
}

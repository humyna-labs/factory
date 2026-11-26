// R-12: queue mode for unattended windows. Never waits for input; skips blocked tasks.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTask, type Deps, type TaskResult } from "./coordinator.ts";
import { isoUtc } from "./runs-csv.ts";
import { STAGES, stateLabel } from "./state.ts";
import { taskId, type Issue } from "./types.ts";

export function priorityOf(i: Issue): number {
  const m = i.labels.map((l) => /^priority:p([0-9])$/.exec(l)?.[1]).find((x) => x !== undefined);
  return m === undefined ? 9 : Number(m);
}

export function orderTasks(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => priorityOf(a) - priorityOf(b) || a.number - b.number);
}

export function dependsOn(i: Issue): number[] {
  return [...i.body.matchAll(/^Depends-on:\s*#(\d+)\s*$/gim)].map((m) => Number(m[1]));
}

export interface Digest {
  started: string;
  ended: string;
  done: TaskResult[];
  needsHuman: TaskResult[];
  escalated: TaskResult[];
  stopped: TaskResult[];
  skippedBlocked: { task: string; reason: string }[];
  notStarted: string[];
  /** Tasks resumed from a factory:<stage> label after an interruption (W2-06). */
  resumed: string[];
  /** Auto-merge PRs that had not landed when the queue moved on (jd2cv-m1). */
  unmerged: { task: string; pr: string; result: string }[];
  /** Worktrees still on disk at the end, mostly needs-human tasks (W2-05). */
  keptWorktrees: string[];
  blockedActions: number;
  costUsd: number;
  turns: number;
}

export async function runQueue(d: Deps, maxHours: number): Promise<Digest> {
  const started = d.now();
  const deadline = new Date(started.getTime() + maxHours * 3_600_000);
  const deps: Deps = { ...d, deadline };
  const [owner, repo] = d.cfg.repo.split("/") as [string, string];
  // W2-06: tasks interrupted mid-stage come first, in stage order, then the ready queue.
  const inFlight: Issue[] = [];
  for (const s of STAGES) inFlight.push(...orderTasks(await d.gh.listOpenIssues(owner, repo, stateLabel(s))));
  const seen = new Set(inFlight.map((i) => i.number));
  const ready = [...inFlight, ...orderTasks(await d.gh.listOpenIssues(owner, repo, stateLabel("ready"))).filter((i) => !seen.has(i.number))];
  const dg: Digest = { started: isoUtc(started), ended: "", done: [], needsHuman: [], escalated: [], stopped: [], skippedBlocked: [], notStarted: [], resumed: [], unmerged: [], keptWorktrees: [], blockedActions: 0, costUsd: 0, turns: 0 };
  for (const issue of ready) {
    if (d.now() >= deadline) {
      dg.notStarted.push(taskId(issue));
      continue;
    }
    if (issue.labels.includes("factory:blocked")) {
      dg.skippedBlocked.push({ task: taskId(issue), reason: "label factory:blocked" });
      continue;
    }
    const open: number[] = [];
    for (const n of dependsOn(issue)) if ((await d.gh.getIssue(owner, repo, n)).state === "open") open.push(n);
    if (open.length) {
      dg.skippedBlocked.push({ task: taskId(issue), reason: `depends on open ${open.map((n) => `#${n}`).join(", ")}` });
      continue;
    }
    let r: TaskResult;
    try {
      r = await runTask(deps, issue);
    } catch (err) {
      // A crash in one task must not stop the window; record it and move on.
      d.events.write({ ts: isoUtc(d.now()), type: "task-crash", task: taskId(issue), error: (err as Error).message.slice(0, 300) });
      dg.skippedBlocked.push({ task: taskId(issue), reason: `coordinator error: ${(err as Error).message.slice(0, 120)}` });
      continue;
    }
    dg.blockedActions += r.blockedActions;
    dg.costUsd += r.costUsd;
    dg.turns += r.turns;
    if (r.resumed) dg.resumed.push(r.task);
    if (r.resumeLoop) dg.skippedBlocked.push({ task: r.task, reason: `interrupted twice at ${r.final}; resume loop, needs a look` });
    else if (r.stoppedForTime) dg.stopped.push(r);
    else if (r.final === "auto-merge") {
      dg.done.push(r);
      // jd2cv-m1 (resume-sg#18): the next task branches from origin/main, so wait until this
      // auto-merge has landed; otherwise two tasks that touch the same file conflict.
      const n = Number(/\/pull\/(\d+)$/.exec(r.prUrl ?? "")?.[1] ?? NaN);
      if (Number.isInteger(n)) {
        const result = await waitForMerge(deps, owner, repo, n);
        d.events.write({ ts: isoUtc(d.now()), type: "merge-wait", task: r.task, pr: n, result });
        if (result !== "merged") dg.unmerged.push({ task: r.task, pr: r.prUrl ?? "", result });
      }
    }
    else if (r.final === "needs-human") dg.needsHuman.push(r);
    else if (r.final === "escalated") dg.escalated.push(r);
  }
  dg.keptWorktrees = d.workspace.kept();
  dg.ended = isoUtc(d.now());
  return dg;
}

export const MERGE_WAIT_MS = 30 * 60_000;
export const MERGE_POLL_MS = 30_000;

/** Poll until the PR is merged or closed, conflicts (DIRTY never fixes itself), or MERGE_WAIT_MS pass. */
export async function waitForMerge(d: Deps, owner: string, repo: string, pr: number): Promise<"merged" | "closed" | "conflict" | "timeout"> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const until = d.now().getTime() + MERGE_WAIT_MS;
  for (let polls = 0; ; polls++) {
    const s = await d.gh.pullRequestState(owner, repo, pr);
    if (s.state === "merged") return "merged";
    if (s.state === "closed") return "closed";
    if (s.mergeState === "DIRTY") return "conflict";
    if (d.now().getTime() >= until || polls >= MERGE_WAIT_MS / MERGE_POLL_MS) return "timeout";
    await sleep(MERGE_POLL_MS);
  }
}

export function formatDigest(dg: Digest): string {
  const list = (rs: TaskResult[], f: (r: TaskResult) => string) => (rs.length ? rs.map((r) => `  - ${r.task} ${f(r)}`) : ["  - none"]);
  return [
    `Factory digest ${dg.started} to ${dg.ended}`,
    `Done (${dg.done.length}):`,
    ...list(dg.done, (r) => r.prUrl ?? ""),
    `Needs human (${dg.needsHuman.length}):`,
    ...list(dg.needsHuman, (r) => r.prUrl ?? ""),
    `Escalated (${dg.escalated.length}):`,
    ...list(dg.escalated, (r) => `harness-fix ${r.harnessFixIssue ?? "(not created)"}`),
    `Stopped by time budget (${dg.stopped.length}):`,
    ...list(dg.stopped, (r) => `at ${r.final}`),
    `Skipped, blocked (${dg.skippedBlocked.length}):`,
    ...(dg.skippedBlocked.length ? dg.skippedBlocked.map((s) => `  - ${s.task} ${s.reason}`) : ["  - none"]),
    `Not started, time budget (${dg.notStarted.length}): ${dg.notStarted.join(", ") || "none"}`,
    `Resumed after an interruption (${dg.resumed.length}): ${dg.resumed.join(", ") || "none"}`,
    `Auto-merge not landed (${dg.unmerged.length}): ${dg.unmerged.map((u) => `${u.task} ${u.pr} ${u.result}`).join(", ") || "none"}`,
    `Worktrees kept (${dg.keptWorktrees.length}): ${dg.keptWorktrees.join(", ") || "none"}`,
    `Blocked actions: ${dg.blockedActions}`,
    `Cost: ${dg.costUsd.toFixed(4)} USD over ${dg.turns} turns`,
  ].join("\n");
}

export function writeDigest(runsDir: string, dg: Digest): string {
  mkdirSync(runsDir, { recursive: true });
  const p = join(runsDir, `digest-${dg.ended.replace(/[:]/g, "")}.md`);
  writeFileSync(p, formatDigest(dg) + "\n");
  return p;
}

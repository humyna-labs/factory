// R-12: queue mode for unattended windows. Never waits for input; skips blocked tasks.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTask, type Deps, type TaskResult } from "./coordinator.ts";
import { isoUtc } from "./runs-csv.ts";
import { stateLabel } from "./state.ts";
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
  blockedActions: number;
  costUsd: number;
  turns: number;
}

export async function runQueue(d: Deps, maxHours: number): Promise<Digest> {
  const started = d.now();
  const deadline = new Date(started.getTime() + maxHours * 3_600_000);
  const deps: Deps = { ...d, deadline };
  const [owner, repo] = d.cfg.repo.split("/") as [string, string];
  const ready = orderTasks(await d.gh.listOpenIssues(owner, repo, stateLabel("ready")));
  const dg: Digest = { started: isoUtc(started), ended: "", done: [], needsHuman: [], escalated: [], stopped: [], skippedBlocked: [], notStarted: [], blockedActions: 0, costUsd: 0, turns: 0 };
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
    if (r.stoppedForTime) dg.stopped.push(r);
    else if (r.final === "auto-merge") dg.done.push(r);
    else if (r.final === "needs-human") dg.needsHuman.push(r);
    else if (r.final === "escalated") dg.escalated.push(r);
  }
  dg.ended = isoUtc(d.now());
  return dg;
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

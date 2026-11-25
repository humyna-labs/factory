import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Root of the factory repository (two levels above this file). */
export const FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_RUNS_DIR = "/workspace/runs";
export const DRY_RUN_RUNS_DIR = "/workspace/runs/dry-run";

export interface RunPaths {
  runsDir: string;
  runsCsv: string;
  events: string;
  reportsDir: string;
  tracesDir: string;
  worktreesDir: string;
  escalationsDir: string;
  guardLog: string;
}

export function runPaths(runsDir: string): RunPaths {
  return {
    runsDir,
    runsCsv: join(runsDir, "runs.csv"),
    events: join(runsDir, "events.jsonl"),
    reportsDir: join(runsDir, "reports"),
    tracesDir: join(runsDir, "traces"),
    worktreesDir: join(runsDir, "worktrees"),
    escalationsDir: join(runsDir, "escalations"),
    guardLog: join(runsDir, "guard.log"),
  };
}

export const factoryPath = (...parts: string[]): string => join(FACTORY_ROOT, ...parts);

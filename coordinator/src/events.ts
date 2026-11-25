// JSONL event log (spec 3.7 observability). Carries data runs.csv has no column for,
// such as blocked-action counts (read-back conflict C7). Never logs environment values.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface FactoryEvent {
  ts: string;
  type: string;
  task?: string;
  stage?: string;
  [key: string]: string | number | boolean | undefined;
}

export class EventLog {
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  write(event: FactoryEvent): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(event) + "\n");
  }
}

/** All events in the log, skipping lines that do not parse (a kill can cut the last line). */
export function readEvents(path: string): FactoryEvent[] {
  if (!existsSync(path)) return [];
  const out: FactoryEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as FactoryEvent);
    } catch {
      // a partial last line after SIGKILL
    }
  }
  return out;
}

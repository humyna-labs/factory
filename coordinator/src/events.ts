// JSONL event log (spec 3.7 observability). Carries data runs.csv has no column for,
// such as blocked-action counts (read-back conflict C7). Never logs environment values.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
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
    // F15: a kill can leave the last line without its newline. End it first, so the partial line stays one
    // unparsable line (skipped by readEvents) and does not swallow this event.
    appendFileSync(this.path, (endsMidLine(this.path) ? "\n" : "") + JSON.stringify(event) + "\n");
  }
}

/** True when the file exists, is not empty and its last byte is not a newline. */
function endsMidLine(path: string): boolean {
  if (!existsSync(path)) return false;
  const size = statSync(path).size;
  if (size === 0) return false;
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] !== 0x0a;
  } finally {
    closeSync(fd);
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

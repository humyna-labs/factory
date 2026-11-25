// Verifier P9: the hooks test suite must never write to the real guard log, which BL-09 will
// measure. Global setup records the file; teardown fails the run if it changed. Every path-guard
// run in a test passes FACTORY_GUARD_LOG (cases.ts runPathGuard, path-guard.test.ts).
import { existsSync, readFileSync } from "node:fs";

export const REAL_GUARD_LOG = "/workspace/runs/guard.log";

/** Returns a check that throws if <file> differs from when watchFile was called. */
export function watchFile(file: string): () => void {
  const read = () => (existsSync(file) ? readFileSync(file, "utf8") : null);
  const before = read();
  return () => {
    if (read() !== before) throw new Error(`a test wrote to ${file}; pass FACTORY_GUARD_LOG to every path-guard run (verifier P9)`);
  };
}

export default function setup(): () => void {
  return watchFile(REAL_GUARD_LOG);
}

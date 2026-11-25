import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture, runFixture, DRY_RUN_FIXTURE, type Fixture } from "../src/dryrun.ts";

export function tmp(prefix = "factory-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function fixture(mut?: (f: Fixture) => void): Fixture {
  const f = loadFixture(DRY_RUN_FIXTURE);
  mut?.(f);
  return f;
}

export async function dryRun(mut?: (f: Fixture) => void, extra: { maxHours?: number; now?: () => Date } = {}) {
  const runsDir = tmp();
  const r = await runFixture({ fixture: fixture(mut), runsDir, maxHours: extra.maxHours ?? 2, ...(extra.now ? { now: extra.now } : {}) });
  return { ...r, runsDir };
}

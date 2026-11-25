// Mutation check for scripts/lib/guards.sh (G-03, W2-02, D2-night N2): disable each GUARD block in a scratch
// copy and show that at least one case of that guard changes its decision.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUARD_CASES, LIB, runGuardCase } from "./guard-cases.ts";

const src = readFileSync(join(LIB, "guards.sh"), "utf8");
const ids = [...src.matchAll(/^\s*# GUARD (G[0-9]+) begin/gm)].map((m) => m[1] ?? "");

function disable(source: string, id: string): string {
  const re = new RegExp(`^(\\s*)# GUARD ${id} begin[\\s\\S]*?# GUARD ${id} end\\s*$`, "m");
  if (!re.test(source)) throw new Error(`guard ${id} not found`);
  return source.replace(re, `$1: # GUARD ${id} disabled by mutation test`);
}

describe("mutation check: scripts/lib/guards.sh", () => {
  it("has the expected guards, each with cases", () => {
    expect(ids).toEqual(["G1", "G2", "G3", "G4", "G5", "G16", "G6", "G7", "G17", "G18", "G19", "G8", "G9", "G10", "G13", "G14", "G15", "G11", "G12", "G20"]);
    for (const id of ids) expect(GUARD_CASES.some((c) => c.guard === id && c.expect === "refuse"), id).toBe(true);
  });
  it.each(ids)("disabling %s flips at least one decision", (id) => {
    const lib = mkdtempSync(join(tmpdir(), `guards-mut-${id}-`));
    copyFileSync(join(LIB, "common.sh"), join(lib, "common.sh"));
    writeFileSync(join(lib, "guards.sh"), disable(src, id));
    const flips = GUARD_CASES.filter((c) => c.guard === id).filter((c) => runGuardCase(lib, c).decision !== c.expect);
    expect(flips.length).toBeGreaterThan(0);
  });
});

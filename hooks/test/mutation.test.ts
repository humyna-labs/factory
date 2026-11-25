// Mutation check (R-16, G-03, A3): disable each rule of each guard in a scratch copy and show
// that at least one test case fails. Also reports whether the decision itself flips
// (load-bearing rule) or only the deciding rule id changes (rule shadowed by default deny).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PATH_GUARD_CASES, runPathGuard, runSecretGuard, SECRET_CASES } from "./cases.ts";

const HOOKS = join(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "factory-mutation-"));

function ruleIds(source: string): string[] {
  return [...source.matchAll(/^\s*# RULE ([A-Z][0-9]+) begin/gm)].map((m) => m[1] ?? "");
}

function disable(source: string, id: string): string {
  const re = new RegExp(`^(\\s*)# RULE ${id} begin[\\s\\S]*?# RULE ${id} end\\s*$`, "m");
  if (!re.test(source)) throw new Error(`rule ${id} not found`);
  return source.replace(re, `$1: # RULE ${id} disabled by mutation test`);
}

const log: string[] = [];

describe("mutation check: path-guard.sh", () => {
  const src = readFileSync(join(HOOKS, "path-guard.sh"), "utf8");
  const ids = ruleIds(src);
  it("has the expected rules", () => {
    expect(ids).toEqual(["R10", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "B1", "B2", "B7", "B3", "B4", "B5", "B6"]);
  });
  it.each(ids)("disabling %s makes at least one case fail", (id) => {
    const file = join(scratch, `path-guard-${id}.sh`);
    writeFileSync(file, disable(src, id));
    let decisionFlips = 0;
    let ruleOnly = 0;
    for (const c of PATH_GUARD_CASES) {
      const o = runPathGuard(file, c);
      if (o.decision !== c.expect) decisionFlips++;
      else if (o.rule !== c.rule) ruleOnly++;
    }
    log.push(`path-guard ${id}: ${decisionFlips} decision flips, ${ruleOnly} rule-id-only failures`);
    expect(decisionFlips + ruleOnly).toBeGreaterThan(0);
  });
});

describe("mutation check: secret-guard.sh", () => {
  const src = readFileSync(join(HOOKS, "secret-guard.sh"), "utf8");
  const ids = ruleIds(src);
  it("has the expected rules", () => {
    expect(ids).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);
  });
  it.each(ids)("disabling %s makes at least one case fail", (id) => {
    const file = join(scratch, `secret-guard-${id}.sh`);
    writeFileSync(file, disable(src, id));
    let failures = 0;
    for (const c of SECRET_CASES) {
      const r = runSecretGuard(file, c.text);
      const ok = r.finding === (c.expect === "finding") && (!c.rule || r.rules.includes(c.rule));
      if (!ok) failures++;
    }
    log.push(`secret-guard ${id}: ${failures} failing cases`);
    expect(failures).toBeGreaterThan(0);
  });
  it("prints the mutation log", () => {
    console.log(["Mutation log (R-16):", ...log].join("\n"));
    expect(log.length).toBe(17 + 8);
  });
});

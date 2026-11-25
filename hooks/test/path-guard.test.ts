import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PATH_GUARD_CASES, runPathGuard, WT } from "./cases.ts";

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("missing test case");
  return v;
}

const GUARD = join(import.meta.dirname, "..", "path-guard.sh");

describe("path-guard (R-03, A3)", () => {
  it.each(PATH_GUARD_CASES.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const o = runPathGuard(GUARD, c);
    expect(o.decision, o.stderr).toBe(c.expect);
    expect(o.rule, o.stderr).toBe(c.rule);
  });

  it("explains the fix when it blocks (P-05)", () => {
    const o = runPathGuard(GUARD, must(PATH_GUARD_CASES[0]));
    expect(o.stderr).toMatch(/Never edit tests/);
  });

  it("logs blocks in hook mode only, without file contents", () => {
    const log = `/tmp/factory-guard-log-${process.pid}.log`;
    rmSync(log, { force: true });
    runPathGuard(GUARD, { name: "x", role: "builder", kind: "path", target: "tests/a.ts", expect: "deny", rule: "R7" }, { FACTORY_GUARD_LOG: log });
    expect(existsSync(log)).toBe(false);
    runPathGuard(GUARD, { name: "x", role: "builder", kind: "tool", tool: "Write", target: "tests/a.ts", expect: "deny", rule: "R7" }, { FACTORY_GUARD_LOG: log });
    expect(readFileSync(log, "utf8")).toMatch(/role=builder tool=Write rule=R7 target=tests\/a.ts/);
  });

  it("fails closed on malformed input", () => {
    const r = spawnSync("bash", [GUARD, "builder"], { input: "not json", encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
    expect(r.status).toBe(2);
  });

  it("ignores read-only tools", () => {
    const r = spawnSync("bash", [GUARD, "builder"], { input: JSON.stringify({ tool_name: "Read", cwd: WT, tool_input: { file_path: "tests/a.ts" } }), encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});

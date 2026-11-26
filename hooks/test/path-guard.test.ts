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

  it("logs one line per block, also for a multi-line command (jd2cv-m1)", () => {
    const log = `/tmp/factory-guard-log-ml-${process.pid}.log`;
    rmSync(log, { force: true });
    const cmd = "cat > tests/a.ts <<'EOF'\nline one\nline two\n\tline three\nEOF";
    runPathGuard(GUARD, { name: "x", role: "builder", kind: "tool", tool: "Bash", target: cmd, expect: "deny", rule: "B3" }, { FACTORY_GUARD_LOG: log });
    runPathGuard(GUARD, { name: "x", role: "builder", kind: "tool", tool: "Bash", target: "ls tests/" + "x".repeat(1000), expect: "deny", rule: "B3" }, { FACTORY_GUARD_LOG: log });
    const lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/rule=B3 target=cat > tests\/a\.ts <<'EOF' line one line two {2}line three EOF$/);
    expect(Buffer.byteLength(lines[1] ?? "")).toBeLessThan(400);
  });

  it("fails closed on malformed input", () => {
    // P9: never the real /workspace/runs/guard.log, which BL-09 reads.
    const r = spawnSync("bash", [GUARD, "builder"], { input: "not json", encoding: "utf8", env: { PATH: process.env.PATH ?? "", FACTORY_GUARD_LOG: "/tmp/factory-guard-test.log" } });
    expect(r.status).toBe(2);
  });

  it("ignores read-only tools", () => {
    const r = spawnSync("bash", [GUARD, "builder"], { input: JSON.stringify({ tool_name: "Read", cwd: WT, tool_input: { file_path: "tests/a.ts" } }), encoding: "utf8", env: { PATH: process.env.PATH ?? "", FACTORY_GUARD_LOG: "/tmp/factory-guard-test.log" } });
    expect(r.status).toBe(0);
  });
});

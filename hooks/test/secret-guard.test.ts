import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSecretGuard, SECRET_CASES } from "./cases.ts";

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("missing test case");
  return v;
}

const GUARD = join(import.meta.dirname, "..", "secret-guard.sh");
const ROOT = join(import.meta.dirname, "..", "..");

describe("secret-guard (R-16)", () => {
  it.each(SECRET_CASES.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const r = runSecretGuard(GUARD, c.text);
    expect(r.finding, r.stderr).toBe(c.expect === "finding");
    if (c.rule) expect(r.rules).toContain(c.rule);
  });

  it("never prints the secret itself", () => {
    const c = must(SECRET_CASES.find((x) => x.rule === "S2"));
    expect(runSecretGuard(GUARD, c.text).stderr).not.toContain(c.text.slice(6));
  });

  it("blocks a Write in hook mode", () => {
    const c = must(SECRET_CASES.find((x) => x.rule === "S4"));
    const r = spawnSync("bash", [GUARD, "--hook"], { encoding: "utf8", input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "src/a.ts", content: c.text } }) });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Never write secrets/);
  });

  it("finds nothing in the factory repository itself (A5: no secrets)", () => {
    const r = spawnSync("bash", [GUARD, "--scan-git"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
});

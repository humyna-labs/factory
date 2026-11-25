// W2-02, D2-night N2: the real (non-dry-run) flows of the human-run scripts, offline. The
// scenarios live in flow-kit.ts so that flows-mutation.test.ts can rerun them on mutated copies.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTRY_SCENARIOS, INSTALL_SCENARIOS, ROOT, run, SETUP_SCENARIOS, state } from "./flow-kit.ts";

describe("install-workflows.sh real flow (A1, A2, A4, A5, N2c-g)", () => {
  it.each(INSTALL_SCENARIOS.map((s) => [s.name, s] as const))("%s", (_n, s) => s.run(ROOT), 60000);
});

describe("setup-repo.sh real flow (A3, A4, A5, ADR 0002, N2a, N2c, N2g)", () => {
  it.each(SETUP_SCENARIOS.map((s) => [s.name, s] as const))("%s", (_n, s) => s.run(ROOT), 60000);
  it.each([["humyna-labs/.."], ["humyna-labs/x;y"], ["humyna-labs/$(id)"], ["humyna-labs/a b"], ["humyna-labs/a/b"], ["humyna-labs-x/r"], ["Humyna-labs/r"]])("refuses the target %s", (t) => {
    const e = state();
    const r = run(ROOT, e, "setup-repo.sh", [t, "--dry-run"], "");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED/);
  });
  it("refuses a bad team slug", () => {
    const e = state();
    const r = run(ROOT, e, "setup-repo.sh", ["humyna-labs/r", "--dry-run", "--review-mode", "required-reviewers", "--team", "../x"], "");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED team slug/);
  });
  it("the real entry point still refuses to run in the container", () => {
    expect(existsSync("/workspace/factory/.git") || existsSync("/.dockerenv")).toBe(true);
    const r = spawnSync("bash", [join(ROOT, "scripts", "setup-repo.sh"), "humyna-labs/resume-sg"], { encoding: "utf8" });
    expect(r.stderr).toMatch(/must run on the host/);
  });
});

describe("entry check E1 (Codex 1, N2b)", () => {
  it.each(ENTRY_SCENARIOS.map((s) => [s.name, s] as const))("%s", (_n, s) => s.run(ROOT), 60000);
});

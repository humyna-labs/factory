// Code searches that back R-02, R-04, R-05, R-13 and R-18 (P-05: errors say how to fix).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FACTORY_ROOT } from "../src/paths.ts";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: FACTORY_ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const text = (f: string) => readFileSync(join(FACTORY_ROOT, f), "utf8");
const SELF = "coordinator/test/structure.test.ts";
// The human-owned design docs quote the forbidden flag in order to forbid it. Agents may not edit
// them (kickoff rules), so they are the only exemption; see the D2 report, section 7.
const PROTECTED_DOCS = ["docs/design/brief-D2.md", "docs/design/factory-spec.md", "docs/design/kickoff-D2.md"];
const src = files.filter((f) => f.startsWith("coordinator/src/") && f.endsWith(".ts"));

describe("structure", () => {
  it("R-02: only coordinator.ts imports the merge path, and only merge.ts calls .merge(", () => {
    const importers = src.filter((f) => /from "\.\/merge\.ts"|from "\.\.\/merge\.ts"/.test(text(f)));
    expect(importers, "only coordinator/src/coordinator.ts may import merge.ts").toEqual(["coordinator/src/coordinator.ts"]);
    const callers = src.filter((f) => /\.merge\(/.test(text(f)));
    expect(callers, "call gh.merge only from coordinator/src/merge.ts").toEqual(["coordinator/src/merge.ts"]);
  });

  it("R-02: role runners never see the GitHub adapter", () => {
    for (const f of src.filter((f) => f.startsWith("coordinator/src/runner/"))) expect(text(f), `${f} must not import github/`).not.toMatch(/github\//);
  });

  it("R-02: only the gh adapter runs 'gh pr merge'", () => {
    const hits = files.filter((f) => f !== SELF && !f.startsWith("docs/") && /"pr",\s*"merge"|gh pr merge/.test(text(f)));
    const allowed = ["coordinator/src/github/gh.ts", "coordinator/test/units.test.ts", "hooks/test/cases.ts"];
    expect(hits.filter((f) => !allowed.includes(f)), "only the gh adapter may assemble a merge command").toEqual([]);
    for (const s of files.filter((f) => /^settings\/.*\.json$/.test(f))) expect(text(s)).toContain('"Bash(gh:*)"');
  });

  it("R-04: the permission bypass flag appears nowhere in the repository", () => {
    const flag = ["--dangerously", "skip", "permissions"].join("-");
    const hits = files.filter((f) => !PROTECTED_DOCS.includes(f) && text(f).includes(flag));
    expect(hits, "remove the bypass flag; sessions use --permission-mode auto").toEqual([]);
  });

  it("R-04: every role settings file disables bypass mode", () => {
    for (const f of files.filter((f) => /^settings\/.*\.json$/.test(f))) expect(JSON.parse(text(f)).permissions.disableBypassPermissionsMode).toBe("disable");
  });

  it("R-05: process.env is read only in coordinator/src/env.ts, and never dumped", () => {
    const ts = files.filter((f) => /\.(ts|js)$/.test(f) && !f.startsWith("templates/"));
    const readers = ts.filter((f) => /process\.env\b/.test(text(f)) && f !== "coordinator/src/env.ts" && !f.includes("/test/"));
    expect(readers, "read env vars by name in coordinator/src/env.ts").toEqual([]);
    for (const f of ts) expect(text(f), `${f}`).not.toMatch(/stringify\(process\.env|\.\.\.process\.env|\/proc\/[^"\s]*environ/);
    const shells = files.filter((f) => f.endsWith(".sh") || f.startsWith(".githooks/"));
    for (const f of shells) expect(text(f), `${f}: never print the environment`).not.toMatch(/^\s*(env|printenv|set)\s*$|\/proc\/.*environ/m);
  });

  it("R-13: no Cloudflare credential or API usage anywhere", () => {
    const hits = files.filter((f) => f !== SELF && !f.startsWith("docs/") && /CLOUDFLARE_API_TOKEN|CF_API_TOKEN|api\.cloudflare\.com|wrangler/i.test(text(f)));
    expect(hits).toEqual([]);
  });

  it("R-18: .github/workflows/ holds only human-installed copies of ci/workflows/ sources", () => {
    // Since PR #3 the human's install-workflows.sh run put gates.yml on main. Agents still never
    // write there (path-guard R3, B2); a branch may not change what main has installed.
    const installed = files.filter((f) => /(^|\/)\.github\/workflows\//.test(f));
    for (const f of installed) {
      expect(f, "only the repo root may have .github/workflows/").toMatch(/^\.github\/workflows\/[^/]+$/);
      expect(files, `${f} has no source in ci/workflows/; agents edit ci/workflows/ and the human installs`).toContain(`ci/workflows/${f.split("/").pop() ?? ""}`);
    }
    const hasMain = spawnSync("git", ["rev-parse", "--verify", "-q", "origin/main"], { cwd: FACTORY_ROOT }).status === 0;
    if (hasMain) {
      const d = spawnSync("git", ["diff", "--name-only", "origin/main", "--", ".github/workflows"], { cwd: FACTORY_ROOT, encoding: "utf8" });
      expect(d.status).toBe(0);
      expect(d.stdout.trim(), "this branch changes an installed workflow; change ci/workflows/ instead (R-18)").toBe("");
    }
    expect(files).toContain("ci/workflows/gates.yml");
    expect(files).toContain("templates/product/ci/workflows/ci.yml");
  });
});

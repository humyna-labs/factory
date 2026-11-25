// W2-04: no role gets web tools. Server-side web tools bypass the container firewall (handoff
// D2-W2, F5), so every settings file must deny them and every assembled command must disallow them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { factoryPath } from "../src/paths.ts";
import { buildClaudeInvocation } from "../src/runner/claude.ts";
import { loadRoleConfig } from "../src/runner/roles.ts";
import type { Role } from "../src/types.ts";

const WEB_TOOLS = ["WebFetch", "WebSearch"];
const settingsFiles = readdirSync(factoryPath("settings")).filter((f) => f.endsWith(".json"));
const roles = readdirSync(factoryPath("roles")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "") as Role);

describe("web tools are disabled for every role (W2-04)", () => {
  it("finds the settings and role files", () => {
    expect(settingsFiles.length).toBeGreaterThanOrEqual(4);
    expect(roles.length).toBeGreaterThanOrEqual(4);
  });
  it.each(settingsFiles)("settings/%s denies WebFetch and WebSearch", (f) => {
    const s = JSON.parse(readFileSync(join(factoryPath("settings"), f), "utf8")) as { permissions?: { deny?: string[]; allow?: string[] } };
    for (const t of WEB_TOOLS) {
      expect(s.permissions?.deny ?? []).toContain(t);
      expect((s.permissions?.allow ?? []).some((a) => a.startsWith(t))).toBe(false);
    }
  });
  it.each(roles)("the assembled claude command for %s disallows both", (role) => {
    const rc = loadRoleConfig(role);
    const inv = buildClaudeInvocation(
      { role, issue: { owner: "humyna-labs", repo: "r", number: 1, title: "t", body: "", labels: [], state: "open" }, stage: "impl", attempt: 1, maxAttempts: 3, worktree: "/tmp/w", branch: "b", reportPath: "/tmp/r.md", tracePath: "/tmp/t", timeoutMs: 1000 },
      rc,
      { baseBranch: "main", reportsDir: "/tmp/reports", guardLog: "/tmp/g.log" },
    );
    const i = inv.args.indexOf("--disallowedTools");
    expect(i).toBeGreaterThan(-1);
    for (const t of WEB_TOOLS) expect((inv.args[i + 1] ?? "").split(",")).toContain(t);
    expect(rc.settings.endsWith(`settings/${role}.json`)).toBe(true);
  });
});

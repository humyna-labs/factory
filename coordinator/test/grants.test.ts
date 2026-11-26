// jd2cv-m1: issue-scoped grants for protected product paths (owner decision 2026-11-26, option 1).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readEvents } from "../src/events.ts";
import { exec, type Exec } from "../src/exec.ts";
import { GhGitHub } from "../src/github/gh.ts";
import { decideGrants, GRANTABLE, GRANT_REVIEW, grantedChanges } from "../src/grants.ts";
import { factoryPath } from "../src/paths.ts";
import { buildClaudeInvocation } from "../src/runner/claude.ts";
import { loadRoleConfig, sessionPrompt } from "../src/runner/roles.ts";
import type { RoleSession } from "../src/runner/types.ts";
import { outOfScope } from "../src/scope.ts";
import type { Issue } from "../src/types.ts";
import { dryRun } from "./helpers.ts";

const issue = (over: Partial<Issue> = {}): Issue => ({ owner: "humyna-labs", repo: "resume-sg", number: 7, title: "AI settings", body: "Feature: byok\nGrants: public/_headers, src/security/**\n", labels: ["risk:high"], state: "open", author: "humyna-bot", ...over });

describe("decideGrants: owner condition c", () => {
  it("accepts a risk:high issue by humyna-bot or humyna listing only grantable paths", () => {
    expect(decideGrants(issue())).toEqual({ grants: ["public/_headers", "src/security/**"] });
    expect(decideGrants(issue({ author: "humyna", body: "Grants: src/templates/**" }))).toEqual({ grants: ["src/templates/**"] });
    expect(decideGrants(issue({ body: "Grants: src/templates/**, src/templates/**" })).grants).toEqual(["src/templates/**"]);
    expect(GRANTABLE).toEqual(["public/_headers", "src/security/**", "src/templates/**"]);
  });
  it("no Grants line: nothing granted, nothing refused", () => {
    expect(decideGrants(issue({ body: "Feature: x" }))).toEqual({ grants: [] });
  });
  it.each([
    ["not risk:high", { labels: ["risk:low"] }, /risk:high/],
    ["no risk label", { labels: [] }, /risk:high/],
    ["opened by someone else", { author: "someone" }, /opened by someone/],
    ["author unknown", { author: undefined }, /unknown author/],
    ["a non-grantable entry", { body: "Grants: public/_headers, package.json" }, /not grantable: package.json/],
    ["a wider glob", { body: "Grants: src/**" }, /not grantable/],
    ["a harness path", { body: "Grants: .github/**" }, /not grantable/],
    ["a near miss", { body: "Grants: src/security/*" }, /not grantable/],
    ["an empty line", { body: "Grants:   " }, /empty/],
    ["two lines", { body: "Grants: public/_headers\nGrants: src/templates/**" }, /more than one/],
  ] as const)("refuses everything when %s", (_n, over, why) => {
    const d = decideGrants(issue(over as Partial<Issue>));
    expect(d.grants).toEqual([]);
    expect(d.refused).toMatch(why);
  });
  it("grantedChanges lists only paths under a grant", () => {
    expect(grantedChanges(["public/_headers", "src/security/keyStore.ts", "src/ai/x.ts", "tests/a.ts"], ["public/_headers", "src/security/**"])).toEqual(["public/_headers", "src/security/keyStore.ts"]);
    expect(grantedChanges(["public/_headers"], [])).toEqual([]);
  });
});

describe("sessions: only the builder gets write grants; the reviewer gets the checks", () => {
  const session = (role: RoleSession["role"], grants?: string[]): RoleSession => ({ role, issue: issue(), stage: role === "builder" ? "impl" : "review", attempt: 1, maxAttempts: 3, worktree: "/tmp/wt", branch: "b", reportPath: "/tmp/r.md", tracePath: "/tmp/t.jsonl", timeoutMs: 1000, ...(grants ? { grants } : {}) });
  const opts = { baseBranch: "main", reportsDir: "/tmp/reports", guardLog: "/tmp/g.log" };
  const flag = (args: string[], f: string) => args[args.indexOf(f) + 1];
  it("granted builder: builder-grants settings and FACTORY_GRANTS", () => {
    const inv = buildClaudeInvocation(session("builder", ["public/_headers", "src/security/**"]), loadRoleConfig("builder"), opts);
    expect(flag(inv.args, "--settings")).toBe(factoryPath("settings", "builder-grants.json"));
    expect(inv.env.FACTORY_GRANTS).toBe("public/_headers,src/security/**");
  });
  it("builder without grants and every other role: own settings, no FACTORY_GRANTS", () => {
    expect(flag(buildClaudeInvocation(session("builder"), loadRoleConfig("builder"), opts).args, "--settings")).toBe(factoryPath("settings", "builder.json"));
    for (const role of ["qa", "reviewer", "compliance"] as const) {
      const inv = buildClaudeInvocation(session(role, ["public/_headers"]), loadRoleConfig(role), opts);
      expect(flag(inv.args, "--settings")).toBe(factoryPath("settings", `${role}.json`));
      expect(inv.env.FACTORY_GRANTS).toBeUndefined();
    }
  });
  it("reviewer prompt carries the owner's check for each granted path", () => {
    const p = sessionPrompt(session("reviewer", ["public/_headers", "src/security/**", "src/templates/**"]), "main");
    for (const g of GRANTABLE) expect(p).toContain(GRANT_REVIEW[g]);
    expect(GRANT_REVIEW["public/_headers"]).toMatch(/only by adding https:\/\/api\.anthropic\.com/);
    expect(GRANT_REVIEW["src/security/**"]).toMatch(/log.*URL.*error text.*preview.*export/);
    expect(GRANT_REVIEW["src/templates/**"]).toMatch(/images, fonts or external resources/);
    expect(sessionPrompt(session("builder", ["public/_headers"]), "main")).toMatch(/You may write these paths too/);
    expect(sessionPrompt(session("qa", ["public/_headers"]), "main")).not.toMatch(/Granted/);
  });
  it("builder-grants.json is builder.json minus exactly the two granted Edit denies", () => {
    const a = JSON.parse(readFileSync(factoryPath("settings", "builder.json"), "utf8")) as { permissions: { deny: string[] } };
    const b = JSON.parse(readFileSync(factoryPath("settings", "builder-grants.json"), "utf8")) as { permissions: { deny: string[] } };
    expect(a.permissions.deny.filter((x) => !b.permissions.deny.includes(x))).toEqual(["Edit(src/templates/**)", "Edit(src/security/**)"]);
    expect(b.permissions.deny.filter((x) => !a.permissions.deny.includes(x))).toEqual([]);
    expect({ ...b, permissions: { ...b.permissions, deny: [] } }).toEqual({ ...a, permissions: { ...a.permissions, deny: [] } });
  });
});

describe("post-session check passes grants to path-guard for the builder only", () => {
  it("allows granted paths for the builder, still denies them for QA and without grants", async () => {
    const files = ["public/_headers", "src/security/keyStore.ts", "src/templates/a.css", "package.json"];
    expect(await outOfScope(exec, "builder", "/tmp/factory-guard-wt", files, ["public/_headers", "src/security/**"])).toEqual(["src/templates/a.css", "package.json"]);
    expect(await outOfScope(exec, "builder", "/tmp/factory-guard-wt", files)).toEqual(files);
    expect(await outOfScope(exec, "qa", "/tmp/factory-guard-wt", ["public/_headers"], ["public/_headers"])).toEqual(["public/_headers"]);
  });
});

describe("gh adapter reads the issue author", () => {
  it("maps author.login", async () => {
    const fake: Exec = async () => ({ code: 0, stdout: JSON.stringify({ number: 7, title: "t", body: "b", state: "OPEN", labels: [], author: { login: "humyna-bot" } }), stderr: "", timedOut: false });
    expect((await new GhGitHub(fake).getIssue("humyna-labs", "resume-sg", 7)).author).toBe("humyna-bot");
  });
});

describe("flow (stub roles): granted paths reach a needs-human PR and are listed at its top", () => {
  const changes = ["public/_headers", "src/security/keyStore.ts", "src/ai/anthropic.ts"];
  it("accepted grant", async () => {
    const r = await dryRun((f) => {
      f.issues = [{ number: 301, title: "AI settings", labels: ["factory:ready", "risk:high"], body: "Feature: byok\nGrants: public/_headers, src/security/**", author: "humyna-bot" }];
      f.scenarios = { "resume-sg#301": { changes } };
    });
    expect(r.digest.needsHuman.map((t) => t.task)).toEqual(["resume-sg#301"]);
    const body = r.gh.prBodies.get("factory/resume-sg-301") ?? "";
    expect(body.split("\n").slice(0, 4)).toEqual(["Granted paths changed (Grants: public/_headers, src/security/**):", "- public/_headers", "- src/security/keyStore.ts", ""]);
    expect(readEvents(r.paths.events).find((e) => e.type === "grants")).toMatchObject({ granted: "public/_headers,src/security/**" });
  });
  it("refused grant (not opened by humyna-bot or humyna): the builder's protected writes fail the stage", async () => {
    const r = await dryRun((f) => {
      f.issues = [{ number: 302, title: "AI settings", labels: ["factory:ready", "risk:high"], body: "Grants: public/_headers, src/security/**", author: "someone" }];
      f.scenarios = { "resume-sg#302": { changes } };
    });
    expect(r.digest.escalated.map((t) => t.task)).toEqual(["resume-sg#302"]);
    const ev = readEvents(r.paths.events);
    expect(ev.find((e) => e.type === "grants")).toMatchObject({ granted: "", refused: expect.stringMatching(/opened by someone/) });
    expect(String(ev.find((e) => e.type === "stage" && e.stage === "impl")?.reason)).toMatch(/out-of-scope writes by builder: public\/_headers, src\/security\/keyStore.ts/);
  });
});

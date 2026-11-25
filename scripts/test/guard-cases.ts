// Cases for scripts/lib/guards.sh (W2-02, D2-night N2). Shared by guards.test.ts and
// guards-mutation.test.ts. Each case runs one bash snippet after sourcing common.sh (which sources
// guards.sh) from <lib>. A case with `tty` runs with stdin as a terminal fed with that text.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERIFIER_FIXTURES } from "./flow-kit.ts";

export const LIB = join(import.meta.dirname, "..", "lib");
const ROOT = join(import.meta.dirname, "..", "..");

export interface GuardCase {
  guard: string;
  name: string;
  /** Bash snippet; $FIX is the fixture directory. */
  snippet: string;
  expect: "pass" | "refuse";
  fixture?: (dir: string) => void;
  home?: (dir: string) => string;
  /** Passed to the snippet as $ARG. */
  arg?: string;
  /** Run with stdin as a terminal that receives this text. */
  tty?: string;
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", env: { PATH: process.env.PATH ?? "", HOME: cwd, GIT_CONFIG_NOSYSTEM: "1" } });

function write(dir: string, rel: string, text: string | Buffer): void {
  const p = join(dir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
}

const GOOD_WF = "name: ci\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo hi\n";
const JOB = "name: ci\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-24.04\n";
const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const BASE_CALL = "name: ci\non: push\npermissions:\n  contents: read\njobs:\n  gates:\n    uses: humyna-labs/factory/.github/workflows/gates.yml@v1\n";

type Dirty = "clean" | "untracked" | "ahead" | "symlink" | "ignored-symlink" | "branch" | "upstream" | "detached" | "index" | "assume" | "skip";

/** A clone with an upstream, like the reviewed clone on the Mac, at <dir>/<at>. */
function reviewedClone(dir: string, dirty: Dirty, at = "clone"): void {
  mkdirSync(join(dir, "src"));
  write(join(dir, "src"), "scripts/a.sh", "echo a\n");
  write(join(dir, "src"), ".gitignore", "scripts/ignored\n");
  write(join(dir, "src"), "ci/workflows/x.yml", GOOD_WF);
  git(join(dir, "src"), "init", "-q", "-b", "main");
  git(join(dir, "src"), "add", "-A");
  git(join(dir, "src"), "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "-m", "init");
  git(join(dir, "src"), "branch", "other");
  git(dir, "clone", "-q", "--bare", "src", "remote.git");
  mkdirSync(join(dir, at, ".."), { recursive: true });
  git(dir, "clone", "-q", "remote.git", at);
  const c = join(dir, at);
  if (dirty === "untracked") write(c, "scripts/new.sh", "echo new\n");
  if (dirty === "ahead") {
    write(c, "scripts/a.sh", "echo changed\n");
    git(c, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qam", "local");
  }
  if (dirty === "symlink") symlinkSync("/etc/hosts", join(c, "scripts", "hosts"));
  // git status does not show an ignored symlink; only G10's own scan sees it.
  if (dirty === "ignored-symlink") symlinkSync("/etc/hosts", join(c, "scripts", "ignored"));
  if (dirty === "branch") git(c, "checkout", "-q", "-b", "feature", "--track", "origin/main");
  if (dirty === "upstream") git(c, "branch", "-q", "-u", "origin/other", "main");
  if (dirty === "detached") git(c, "checkout", "-q", "--detach");
  if (dirty === "index") writeFileSync(join(c, ".git", "index"), "not an index");
  if (dirty === "assume" || dirty === "skip") {
    write(c, "scripts/a.sh", "echo hidden change\n");
    git(c, "update-index", dirty === "assume" ? "--assume-unchanged" : "--skip-worktree", "scripts/a.sh");
  }
}

const wf = (guard: string, name: string, text: string, expect: "pass" | "refuse", fn = "guard_workflow_file"): GuardCase => ({ guard, name, snippet: `${fn} "$FIX/w.yml"`, expect, fixture: (d) => write(d, "w.yml", text) });
const labels = (guard: string, name: string, text: string | Buffer): GuardCase => ({ guard, name, snippet: 'guard_labels_file "$FIX/labels.txt"', expect: "refuse", fixture: (d) => write(d, "labels.txt", text) });
const clone = (guard: string, name: string, dirty: Dirty, expect: "pass" | "refuse", fn = "guard_reviewed_checkout"): GuardCase => ({ guard, name, snippet: `${fn} "$FIX/clone"`, expect, fixture: (d) => reviewedClone(d, dirty) });
const repoWith = (d: string, ...configs: string[][]) => {
  mkdirSync(join(d, "r"));
  git(join(d, "r"), "init", "-q");
  git(join(d, "r"), "remote", "add", "origin", "https://github.com/humyna-labs/x.git");
  for (const c of configs) git(join(d, "r"), "config", ...c);
};

export const GUARD_CASES: GuardCase[] = [
  // G1 repository name
  { guard: "G1", name: "plain name", snippet: "guard_repo_name resume-sg", expect: "pass" },
  { guard: "G1", name: "dots and underscores", snippet: "guard_repo_name my_repo.v2", expect: "pass" },
  ...["..", ".", "", "a/b", "x;y", "$(id)", "a b", "a\nb", "r\u001b[2J"].map((n) => ({ guard: "G1", name: `refuses ${JSON.stringify(n)}`, snippet: 'guard_repo_name "$ARG"', arg: n, expect: "refuse" as const })),
  // G2 owner
  { guard: "G2", name: "the organization", snippet: "guard_owner humyna-labs", expect: "pass" },
  { guard: "G2", name: "lookalike owner", snippet: "guard_owner humyna-labs-x", expect: "refuse" },
  { guard: "G2", name: "case variant", snippet: "guard_owner Humyna-labs", expect: "refuse" },
  // G3 team slug
  { guard: "G3", name: "slug", snippet: "guard_slug owners", expect: "pass" },
  { guard: "G3", name: "path in slug", snippet: "guard_slug '../members'", expect: "refuse" },
  { guard: "G3", name: "option-like slug", snippet: "guard_slug '-X'", expect: "refuse" },
  // G4 symlinks anywhere, and a scan that fails is a refusal (Codex 9)
  { guard: "G4", name: "tree without symlinks", snippet: 'guard_no_symlinks "$FIX"', expect: "pass", fixture: (d) => write(d, "ci/workflows/x.yml", GOOD_WF) },
  { guard: "G4", name: "symlink to a file outside the repo", snippet: 'guard_no_symlinks "$FIX"', expect: "refuse", fixture: (d) => { write(d, "ci/workflows/x.yml", GOOD_WF); symlinkSync("/etc/hosts", join(d, "ci", "workflows", "hosts.yml")); } },
  { guard: "G4", name: "symlinked directory", snippet: 'guard_no_symlinks "$FIX"', expect: "refuse", fixture: (d) => { mkdirSync(join(d, ".github")); symlinkSync("/tmp", join(d, ".github", "workflows")); } },
  { guard: "G4", name: "dangling symlink", snippet: 'guard_no_symlinks "$FIX"', expect: "refuse", fixture: (d) => symlinkSync("/nonexistent/x", join(d, "x")) },
  { guard: "G4", name: "the root itself is a symlink", snippet: 'guard_no_symlinks "$FIX/link"', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "real")); symlinkSync(join(d, "real"), join(d, "link")); } },
  { guard: "G4", name: "symlinks inside .git are ignored", snippet: 'guard_no_symlinks "$FIX"', expect: "pass", fixture: (d) => { mkdirSync(join(d, ".git")); symlinkSync("/tmp", join(d, ".git", "x")); } },
  { guard: "G4", name: "an unreadable directory (find fails) is refused", snippet: 'guard_no_symlinks "$FIX"', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "locked")); write(d, "locked/x", "x"); chmodSync(join(d, "locked"), 0o000); } },
  // G5 real path inside the root
  { guard: "G5", name: "subdirectory", snippet: 'guard_inside "$FIX" "$FIX/a/b"', expect: "pass", fixture: (d) => mkdirSync(join(d, "a", "b"), { recursive: true }) },
  { guard: "G5", name: "directory that resolves outside", snippet: 'guard_inside "$FIX/root" "$FIX/root/out"', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "root")); mkdirSync(join(d, "elsewhere")); symlinkSync(join(d, "elsewhere"), join(d, "root", "out")); } },
  // G16 bytes: printable ASCII, tab and newline only (verifier P2, Codex 3)
  { guard: "G16", name: "printable ASCII with tabs passes", snippet: 'guard_ascii_text "$FIX/w.yml" w.yml', expect: "pass", fixture: (d) => write(d, "w.yml", `${GOOD_WF}\t# tab\n`) },
  ...(
    [
      ["ESC sequences (verifier fixture)", VERIFIER_FIXTURES.esc],
      ["a carriage return", GOOD_WF.replace("\n", "\r\n")],
      ["a NUL byte", Buffer.concat([Buffer.from(GOOD_WF), Buffer.from([0])])],
      ["UTF-8", `${GOOD_WF}# d\u00e9j\u00e0\n`],
      ["DEL", `${GOOD_WF}#\u007f\n`],
    ] as const
  ).map(([n, text]) => ({ guard: "G16", name: `refuses ${n}`, snippet: 'guard_ascii_text "$FIX/w.yml" w.yml', expect: "refuse" as const, fixture: (d: string) => write(d, "w.yml", text) })),
  labels("G16", "labels file with a NUL byte", Buffer.concat([Buffer.from("factory:ok|0e8a16|fine"), Buffer.from([0]), Buffer.from("\n")])),
  // G6 workflow entries
  { guard: "G6", name: "regular yml and yaml", snippet: 'guard_workflow_entries "$FIX"', expect: "pass", fixture: (d) => { write(d, "a.yml", GOOD_WF); write(d, "b.yaml", GOOD_WF); } },
  { guard: "G6", name: "symlinked yml", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => symlinkSync("/etc/hosts", join(d, "a.yml")) },
  { guard: "G6", name: "other file type", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => { write(d, "a.yml", GOOD_WF); write(d, "notes.txt", "x"); } },
  { guard: "G6", name: "subdirectory", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => { write(d, "a.yml", GOOD_WF); mkdirSync(join(d, "sub.yml")); } },
  { guard: "G6", name: "hidden file", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => { write(d, "a.yml", GOOD_WF); write(d, ".x", "x"); } },
  { guard: "G6", name: "hidden yml file (validated but never copied, Codex 9)", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => { write(d, "a.yml", GOOD_WF); write(d, ".h.yml", GOOD_WF); } },
  { guard: "G6", name: "oversized file", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => write(d, "big.yml", GOOD_WF + "#".repeat(70000)) },
  { guard: "G6", name: "name with a space", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => write(d, "a b.yml", GOOD_WF) },
  // G7 write tokens anywhere (verifier P3, Codex 2)
  wf("G7", "read-only workflow", GOOD_WF, "pass", "guard_workflow_permissions"),
  wf("G7", "no top-level permissions", "name: ci\non: push\njobs:\n  a:\n    permissions:\n      contents: read\n", "refuse", "guard_workflow_permissions"),
  wf("G7", "write-all", "on: push\npermissions: write-all\n", "refuse", "guard_workflow_permissions"),
  wf("G7", "contents: write", "on: push\npermissions:\n  contents: write\n", "refuse", "guard_workflow_permissions"),
  wf("G7", "flow-style id-token: write", "on: push\npermissions: { contents: read, id-token: write }\n", "refuse", "guard_workflow_permissions"),
  wf("G7", "job-level quoted write", "on: push\npermissions:\n  contents: read\njobs:\n  a:\n    permissions:\n      pull-requests: 'write'\n", "refuse", "guard_workflow_permissions"),
  wf("G7", "write in a block scalar on the next line (verifier fixture)", VERIFIER_FIXTURES.folded, "refuse", "guard_workflow_permissions"),
  wf("G7", "write with no space after the colon", "on: push\npermissions:\n  contents:write\n", "refuse", "guard_workflow_permissions"),
  wf("G7", "upper-case WRITE", "on: push\npermissions:\n  contents: WRITE\n", "refuse", "guard_workflow_permissions"),
  wf("G7", "write-all at job level", `${JOB}    permissions: write-all\n`, "refuse", "guard_workflow_permissions"),
  wf("G7", "the word write in a comment is refused too", `${GOOD_WF}# write\n`, "refuse", "guard_workflow_permissions"),
  wf("G7", "permissions: read-all passes (verifier control fixture)", VERIFIER_FIXTURES.readall, "pass", "guard_workflow_permissions"),
  wf("G7", "words that only contain write pass (written, overwrite)", `${GOOD_WF}# written, overwrite\n`, "pass", "guard_workflow_permissions"),
  { guard: "G7", name: "allowlisted scope passes", snippet: 'ALLOWED_WRITE_SCOPES="checks"; guard_workflow_permissions "$FIX/w.yml"', expect: "pass", fixture: (d) => write(d, "w.yml", "on: push\npermissions:\n  checks: write\n") },
  { guard: "G7", name: "allowlisted scope does not cover another write on the file", snippet: 'ALLOWED_WRITE_SCOPES="checks"; guard_workflow_permissions "$FIX/w.yml"', expect: "refuse", fixture: (d) => write(d, "w.yml", "on: push\npermissions:\n  checks: write\n  contents: write\n") },
  // G17 constructs a line-based check cannot see through
  wf("G17", "a \\x escape", `${JOB}    permissions:\n      contents: "\\x77rite"\n`, "refuse", "guard_workflow_constructs"),
  wf("G17", "a \\u escape", `${JOB}    permissions:\n      contents: "\\u0077rite"\n`, "refuse", "guard_workflow_constructs"),
  wf("G17", "a double-quoted value joined across lines", `${JOB}    permissions:\n      contents: "wr\\\n        ite"\n`, "refuse", "guard_workflow_constructs"),
  wf("G17", "an explicit ? key", `${JOB}    permissions:\n      ? contents\n      : read\n`, "refuse", "guard_workflow_constructs"),
  wf("G17", "plain workflow passes", GOOD_WF, "pass", "guard_workflow_constructs"),
  // G18 privileged triggers and secret hand-offs
  wf("G18", "pull_request_target (verifier fixture)", VERIFIER_FIXTURES.prt, "refuse", "guard_workflow_triggers"),
  wf("G18", "workflow_run", "on:\n  workflow_run:\n    workflows: [ci]\npermissions:\n  contents: read\n", "refuse", "guard_workflow_triggers"),
  wf("G18", "secrets: inherit to an external workflow (verifier fixture)", VERIFIER_FIXTURES.inherit, "refuse", "guard_workflow_triggers"),
  wf("G18", "inherit in a block scalar", `${BASE_CALL}    secrets: >-\n      inherit\n`, "refuse", "guard_workflow_triggers"),
  wf("G18", "push and pull_request pass", GOOD_WF, "pass", "guard_workflow_triggers"),
  // G19 uses: inside humyna-labs/ or pinned to a 40-hex SHA
  wf("G19", "action pinned to a full SHA", `${JOB}    steps:\n      - uses: actions/checkout@${SHA} # v7.0.1\n`, "pass", "guard_workflow_uses"),
  wf("G19", "quoted pinned action", `${JOB}    steps:\n      - uses: "actions/checkout@${SHA}"\n`, "pass", "guard_workflow_uses"),
  wf("G19", "humyna-labs reusable workflow at a tag", `${BASE_CALL}    with:\n      factory-ref: v1\n`, "pass", "guard_workflow_uses"),
  wf("G19", "a comment line that mentions uses", `# uses: evil/x@main\n${GOOD_WF}`, "pass", "guard_workflow_uses"),
  wf("G19", "action at a tag (verifier prt fixture)", VERIFIER_FIXTURES.prt.replace("pull_request_target", "pull_request"), "refuse", "guard_workflow_uses"),
  wf("G19", "external reusable workflow at a branch (verifier inherit fixture)", VERIFIER_FIXTURES.inherit.replace("    secrets: inherit\n", ""), "refuse", "guard_workflow_uses"),
  wf("G19", "short SHA", `${JOB}    steps:\n      - uses: actions/checkout@3d3c42e\n`, "refuse", "guard_workflow_uses"),
  wf("G19", "docker image", `${JOB}    steps:\n      - uses: docker://alpine:3\n`, "refuse", "guard_workflow_uses"),
  wf("G19", "local action", `${JOB}    steps:\n      - uses: ./.github/actions/x\n`, "refuse", "guard_workflow_uses"),
  wf("G19", "flow-style uses", `${JOB}    steps:\n      - { uses: evil/x@main }\n`, "refuse", "guard_workflow_uses"),
  wf("G19", "uses in a block scalar", `${JOB}    steps:\n      - uses: >-\n          evil/x@main\n`, "refuse", "guard_workflow_uses"),
  wf("G19", "path traversal after humyna-labs/", `${JOB}    steps:\n      - uses: humyna-labs/../evil/x@main\n`, "refuse", "guard_workflow_uses"),
  wf("G19", "lookalike owner", `${JOB}    steps:\n      - uses: humyna-labs-x/a@main\n`, "refuse", "guard_workflow_uses"),
  // The real workflow sources pass every content check.
  { guard: "G7", name: "the real ci/workflows/gates.yml passes all content checks", snippet: `guard_workflow_file "${join(ROOT, "ci", "workflows", "gates.yml")}"`, expect: "pass" },
  { guard: "G19", name: "the template ci.yml passes all content checks", snippet: `guard_workflow_file "${join(ROOT, "templates", "product", "ci", "workflows", "ci.yml")}"`, expect: "pass" },
  // G8 one fetch URL and one push URL, after insteadOf rewriting (Codex 4)
  { guard: "G8", name: "plain origin", snippet: 'guard_push_url "$FIX/r" x', expect: "pass", fixture: (d) => repoWith(d) },
  { guard: "G8", name: "insteadOf redirect", snippet: 'guard_push_url "$FIX/r" x', expect: "refuse", fixture: (d) => repoWith(d, ["url.https://evil.example/.insteadOf", "https://github.com/"]) },
  { guard: "G8", name: "pushInsteadOf redirect", snippet: 'guard_push_url "$FIX/r" x', expect: "refuse", fixture: (d) => repoWith(d, ["url.https://evil.example/.pushInsteadOf", "https://github.com/"]) },
  { guard: "G8", name: "another repository", snippet: 'guard_push_url "$FIX/r" x', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "r")); git(join(d, "r"), "init", "-q"); git(join(d, "r"), "remote", "add", "origin", "https://github.com/humyna-labs/y.git"); } },
  { guard: "G8", name: "a second push URL after the right one", snippet: 'guard_push_url "$FIX/r" x', expect: "refuse", fixture: (d) => repoWith(d, ["remote.origin.pushurl", "https://github.com/humyna-labs/x.git"], ["--add", "remote.origin.pushurl", "https://evil.example/x.git"]) },
  { guard: "G8", name: "a second fetch URL", snippet: 'guard_push_url "$FIX/r" x', expect: "refuse", fixture: (d) => repoWith(d, ["--add", "remote.origin.url", "https://evil.example/x.git"]) },
  // G9 labels file
  { guard: "G9", name: "the real labels.txt", snippet: 'guard_labels_file "$LIBDIR/../labels.txt"', expect: "pass" },
  { guard: "G9", name: "labels file is a symlink to a private file", snippet: 'guard_labels_file "$FIX/labels.txt"', expect: "refuse", fixture: (d) => symlinkSync("/etc/hosts", join(d, "labels.txt")) },
  ...[
    ["option-like name", "--repo=other/x|0e8a16|desc"],
    ["uppercase name", "Factory:x|0e8a16|desc"],
    ["bad color", "factory:x|red|desc"],
    ["extra field", "factory:x|0e8a16|desc|more"],
    ["missing description", "factory:x|0e8a16"],
    ["option-like description", "factory:x|0e8a16|--force"],
    ["non-ASCII", "factory:x|0e8a16|d\u00e9j\u00e0"],
    ["long description", `factory:x|0e8a16|${"d".repeat(101)}`],
    ["name over 50 characters", `factory:${"x".repeat(43)}|0e8a16|desc`],
    ["duplicate name", "factory:ok|0e8a16|again"],
    ["description with a trailing space", "factory:x|0e8a16|desc "],
  ].map(([n, line]) => labels("G9", n ?? "", `# header\nfactory:ok|0e8a16|fine\n${line}\n`)),
  labels("G9", "more than 100 labels", Array.from({ length: 101 }, (_, i) => `l${i}|0e8a16|d`).join("\n")),
  labels("G9", "over 16 KiB", `${"#".repeat(17000)}\nfactory:ok|0e8a16|fine\n`),
  // G10 bind mount (case-insensitive), symlinks under scripts/ and ci/
  clone("G10", "clean clone on main tracking origin/main", "clean", "pass"),
  clone("G10", "symlink under scripts", "symlink", "refuse"),
  clone("G10", "a gitignored symlink under scripts", "ignored-symlink", "refuse"),
  // Clean clones that sit inside the bind mount: only the path check can refuse them.
  { guard: "G10", name: "a clean clone inside the bind-mounted working copy", snippet: 'guard_reviewed_checkout "$FIX/home/ai-projects/agent-factory/factory"', expect: "refuse", fixture: (d) => reviewedClone(d, "clean", "home/ai-projects/agent-factory/factory"), home: (d) => join(d, "home") },
  { guard: "G10", name: "a clean clone inside the bind mount with other letter case (APFS)", snippet: 'guard_reviewed_checkout "$FIX/home/AI-Projects/Agent-Factory/factory"', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "home", "ai-projects", "agent-factory"), { recursive: true }); reviewedClone(d, "clean", "home/AI-Projects/Agent-Factory/factory"); }, home: (d) => join(d, "home") },
  // G13 branch main tracking origin/main (Codex 5)
  clone("G13", "another branch that tracks origin/main", "branch", "refuse"),
  clone("G13", "main tracking another upstream", "upstream", "refuse"),
  clone("G13", "detached HEAD", "detached", "refuse"),
  // G14 status must work and be clean; no hidden index flags (Codex 5)
  clone("G14", "untracked file", "untracked", "refuse"),
  clone("G14", "git status fails (corrupt index)", "index", "refuse"),
  clone("G14", "a change hidden by assume-unchanged", "assume", "refuse"),
  clone("G14", "a change hidden by skip-worktree", "skip", "refuse"),
  // G15 HEAD is the fetched origin/main
  clone("G15", "at origin/main", "clean", "pass", "guard_at_upstream"),
  clone("G15", "local commit not on origin/main", "ahead", "refuse", "guard_at_upstream"),
  // G11 bot role for the OrganizationAdmin bypass
  { guard: "G11", name: "bot is a member", snippet: "guard_bot_not_admin member", expect: "pass" },
  { guard: "G11", name: "bot is an admin", snippet: "guard_bot_not_admin admin", expect: "refuse" },
  { guard: "G11", name: "lookup failed", snippet: "guard_bot_not_admin 'unknown (lookup failed)'", expect: "refuse" },
  // G12 the confirmation comes from a terminal (Codex 3)
  { guard: "G12", name: "yes typed at a terminal", snippet: "confirm_yes q", tty: "yes\n", expect: "pass" },
  { guard: "G12", name: "yes piped in", snippet: "printf 'yes\\n' | confirm_yes q", expect: "refuse" },
  { guard: "G12", name: "yes from a file", snippet: 'printf "yes\\n" >"$FIX/a"; confirm_yes q <"$FIX/a"', expect: "refuse" },
  // G20 exactly yes
  { guard: "G20", name: "y", snippet: "confirm_yes q", tty: "y\n", expect: "refuse" },
  { guard: "G20", name: "YES", snippet: "confirm_yes q", tty: "YES\n", expect: "refuse" },
  { guard: "G20", name: "yes with a leading space", snippet: "confirm_yes q", tty: " yes\n", expect: "refuse" },
  { guard: "G20", name: "no input", snippet: "confirm_yes q", tty: "", expect: "refuse" },
];

export function runGuardCase(lib: string, c: GuardCase): { decision: "pass" | "refuse"; stderr: string } {
  const fix = mkdtempSync(join(tmpdir(), "guard-case-"));
  c.fixture?.(fix);
  const home = c.home ? c.home(fix) : fix;
  const env = { PATH: process.env.PATH ?? "", HOME: home, LIBDIR: lib, FIX: fix, ARG: c.arg ?? "", GIT_CONFIG_NOSYSTEM: "1", SHELL: "/bin/bash" };
  const cmd = `. "$LIBDIR/common.sh"; ${c.snippet}`;
  if (c.tty === undefined) {
    const r = spawnSync("bash", ["-c", cmd], { cwd: fix, encoding: "utf8", env });
    return { decision: r.status === 0 ? "pass" : "refuse", stderr: r.stderr };
  }
  // stdin is a terminal; stdout and stderr go to files so the terminal echo stays out of them.
  writeFileSync(join(fix, ".cmd"), `${cmd}\n`);
  const r = spawnSync("script", ["-qec", `bash "${join(fix, ".cmd")}" >"${join(fix, ".out")}" 2>"${join(fix, ".err")}"`, "/dev/null"], { cwd: fix, encoding: "utf8", env, input: c.tty });
  return { decision: r.status === 0 ? "pass" : "refuse", stderr: readFileSync(join(fix, ".err"), "utf8") };
}

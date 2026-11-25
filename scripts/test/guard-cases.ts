// Cases for scripts/lib/guards.sh (W2-02). Shared by guards.test.ts and guards-mutation.test.ts.
// Each case runs one bash snippet after sourcing common.sh (which sources guards.sh) from <lib>.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LIB = join(import.meta.dirname, "..", "lib");

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
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", env: { PATH: process.env.PATH ?? "", HOME: cwd, GIT_CONFIG_NOSYSTEM: "1" } });

function write(dir: string, rel: string, text: string): void {
  const p = join(dir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
}

const GOOD_WF = "name: ci\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo hi\n";

/** A clone with an upstream, like the reviewed clone on the Mac. */
function reviewedClone(dir: string, dirty: "clean" | "untracked" | "ahead" | "symlink"): void {
  mkdirSync(join(dir, "src"));
  write(join(dir, "src"), "scripts/a.sh", "echo a\n");
  write(join(dir, "src"), "ci/workflows/x.yml", GOOD_WF);
  git(join(dir, "src"), "init", "-q", "-b", "main");
  git(join(dir, "src"), "add", "-A");
  git(join(dir, "src"), "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "-m", "init");
  git(dir, "clone", "-q", "--bare", "src", "remote.git");
  git(dir, "clone", "-q", "remote.git", "clone");
  const c = join(dir, "clone");
  if (dirty === "untracked") write(c, "scripts/new.sh", "echo new\n");
  if (dirty === "ahead") {
    write(c, "scripts/a.sh", "echo changed\n");
    git(c, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qam", "local");
  }
  if (dirty === "symlink") symlinkSync("/etc/hosts", join(c, "scripts", "hosts"));
}

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
  // G4 symlinks anywhere
  { guard: "G4", name: "tree without symlinks", snippet: 'guard_no_symlinks "$FIX"', expect: "pass", fixture: (d) => write(d, "ci/workflows/x.yml", GOOD_WF) },
  { guard: "G4", name: "symlink to a file outside the repo", snippet: 'guard_no_symlinks "$FIX"', expect: "refuse", fixture: (d) => { write(d, "ci/workflows/x.yml", GOOD_WF); symlinkSync("/etc/hosts", join(d, "ci", "workflows", "hosts.yml")); } },
  { guard: "G4", name: "symlinked directory", snippet: 'guard_no_symlinks "$FIX"', expect: "refuse", fixture: (d) => { mkdirSync(join(d, ".github")); symlinkSync("/tmp", join(d, ".github", "workflows")); } },
  { guard: "G4", name: "dangling symlink", snippet: 'guard_no_symlinks "$FIX"', expect: "refuse", fixture: (d) => symlinkSync("/nonexistent/x", join(d, "x")) },
  { guard: "G4", name: "the root itself is a symlink", snippet: 'guard_no_symlinks "$FIX/link"', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "real")); symlinkSync(join(d, "real"), join(d, "link")); } },
  { guard: "G4", name: "symlinks inside .git are ignored", snippet: 'guard_no_symlinks "$FIX"', expect: "pass", fixture: (d) => { mkdirSync(join(d, ".git")); symlinkSync("/tmp", join(d, ".git", "x")); } },
  // G5 real path inside the root
  { guard: "G5", name: "subdirectory", snippet: 'guard_inside "$FIX" "$FIX/a/b"', expect: "pass", fixture: (d) => mkdirSync(join(d, "a", "b"), { recursive: true }) },
  { guard: "G5", name: "directory that resolves outside", snippet: 'guard_inside "$FIX/root" "$FIX/root/out"', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "root")); mkdirSync(join(d, "elsewhere")); symlinkSync(join(d, "elsewhere"), join(d, "root", "out")); } },
  // G6 workflow entries
  { guard: "G6", name: "regular yml and yaml", snippet: 'guard_workflow_entries "$FIX"', expect: "pass", fixture: (d) => { write(d, "a.yml", GOOD_WF); write(d, "b.yaml", GOOD_WF); } },
  { guard: "G6", name: "symlinked yml", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => symlinkSync("/etc/hosts", join(d, "a.yml")) },
  { guard: "G6", name: "other file type", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => { write(d, "a.yml", GOOD_WF); write(d, "notes.txt", "x"); } },
  { guard: "G6", name: "subdirectory", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => { write(d, "a.yml", GOOD_WF); mkdirSync(join(d, "sub.yml")); } },
  { guard: "G6", name: "hidden file", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => { write(d, "a.yml", GOOD_WF); write(d, ".x", "x"); } },
  { guard: "G6", name: "oversized file", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => write(d, "big.yml", GOOD_WF + "#".repeat(70000)) },
  { guard: "G6", name: "name with a space", snippet: 'guard_workflow_entries "$FIX"', expect: "refuse", fixture: (d) => write(d, "a b.yml", GOOD_WF) },
  // G7 permissions
  { guard: "G7", name: "read-only workflow", snippet: 'guard_workflow_permissions "$FIX/w.yml"', expect: "pass", fixture: (d) => write(d, "w.yml", GOOD_WF) },
  { guard: "G7", name: "no top-level permissions", snippet: 'guard_workflow_permissions "$FIX/w.yml"', expect: "refuse", fixture: (d) => write(d, "w.yml", "name: ci\non: push\njobs:\n  a:\n    permissions:\n      contents: read\n") },
  { guard: "G7", name: "write-all", snippet: 'guard_workflow_permissions "$FIX/w.yml"', expect: "refuse", fixture: (d) => write(d, "w.yml", "on: push\npermissions: write-all\n") },
  { guard: "G7", name: "contents: write", snippet: 'guard_workflow_permissions "$FIX/w.yml"', expect: "refuse", fixture: (d) => write(d, "w.yml", "on: push\npermissions:\n  contents: write\n") },
  { guard: "G7", name: "flow-style id-token: write", snippet: 'guard_workflow_permissions "$FIX/w.yml"', expect: "refuse", fixture: (d) => write(d, "w.yml", "on: push\npermissions: { contents: read, id-token: write }\n") },
  { guard: "G7", name: "job-level quoted write", snippet: 'guard_workflow_permissions "$FIX/w.yml"', expect: "refuse", fixture: (d) => write(d, "w.yml", "on: push\npermissions:\n  contents: read\njobs:\n  a:\n    permissions:\n      pull-requests: 'write'\n") },
  { guard: "G7", name: "allowlisted scope passes", snippet: 'ALLOWED_WRITE_SCOPES="checks"; guard_workflow_permissions "$FIX/w.yml"', expect: "pass", fixture: (d) => write(d, "w.yml", "on: push\npermissions:\n  checks: write\n") },
  // G8 push URL after insteadOf
  { guard: "G8", name: "plain origin", snippet: 'guard_push_url "$FIX/r" x', expect: "pass", fixture: (d) => { mkdirSync(join(d, "r")); git(join(d, "r"), "init", "-q"); git(join(d, "r"), "remote", "add", "origin", "https://github.com/humyna-labs/x.git"); } },
  { guard: "G8", name: "insteadOf redirect", snippet: 'guard_push_url "$FIX/r" x', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "r")); git(join(d, "r"), "init", "-q"); git(join(d, "r"), "remote", "add", "origin", "https://github.com/humyna-labs/x.git"); git(join(d, "r"), "config", "url.https://evil.example/.insteadOf", "https://github.com/"); } },
  { guard: "G8", name: "pushInsteadOf redirect", snippet: 'guard_push_url "$FIX/r" x', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "r")); git(join(d, "r"), "init", "-q"); git(join(d, "r"), "remote", "add", "origin", "https://github.com/humyna-labs/x.git"); git(join(d, "r"), "config", "url.https://evil.example/.pushInsteadOf", "https://github.com/"); } },
  { guard: "G8", name: "another repository", snippet: 'guard_push_url "$FIX/r" x', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "r")); git(join(d, "r"), "init", "-q"); git(join(d, "r"), "remote", "add", "origin", "https://github.com/humyna-labs/y.git"); } },
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
  ].map(([n, line]) => ({ guard: "G9", name: n ?? "", snippet: 'guard_labels_file "$FIX/labels.txt"', expect: "refuse" as const, fixture: (d: string) => write(d, "labels.txt", `# header\nfactory:ok|0e8a16|fine\n${line}\n`) })),
  // G10 reviewed checkout
  { guard: "G10", name: "clean clone at its upstream", snippet: 'guard_reviewed_checkout "$FIX/clone"', expect: "pass", fixture: (d) => reviewedClone(d, "clean") },
  { guard: "G10", name: "untracked file", snippet: 'guard_reviewed_checkout "$FIX/clone"', expect: "refuse", fixture: (d) => reviewedClone(d, "untracked") },
  { guard: "G10", name: "local commit not on the upstream", snippet: 'guard_reviewed_checkout "$FIX/clone"', expect: "refuse", fixture: (d) => reviewedClone(d, "ahead") },
  { guard: "G10", name: "symlink under scripts", snippet: 'guard_reviewed_checkout "$FIX/clone"', expect: "refuse", fixture: (d) => reviewedClone(d, "symlink") },
  { guard: "G10", name: "inside the bind-mounted working copy", snippet: 'guard_reviewed_checkout "$FIX/home/ai-projects/agent-factory/factory"', expect: "refuse", fixture: (d) => { mkdirSync(join(d, "home", "ai-projects", "agent-factory", "factory"), { recursive: true }); }, home: (d) => join(d, "home") },
  // G11 bot role for the OrganizationAdmin bypass
  { guard: "G11", name: "bot is a member", snippet: "guard_bot_not_admin member", expect: "pass" },
  { guard: "G11", name: "bot is an admin", snippet: "guard_bot_not_admin admin", expect: "refuse" },
  { guard: "G11", name: "lookup failed", snippet: "guard_bot_not_admin 'unknown (lookup failed)'", expect: "refuse" },
  // G12 typed confirmation
  { guard: "G12", name: "yes", snippet: "printf 'yes\\n' | confirm_yes q", expect: "pass" },
  { guard: "G12", name: "y", snippet: "printf 'y\\n' | confirm_yes q", expect: "refuse" },
  { guard: "G12", name: "YES", snippet: "printf 'YES\\n' | confirm_yes q", expect: "refuse" },
  { guard: "G12", name: "no input", snippet: "confirm_yes q </dev/null", expect: "refuse" },
];

export function runGuardCase(lib: string, c: GuardCase): { decision: "pass" | "refuse"; stderr: string } {
  const fix = mkdtempSync(join(tmpdir(), "guard-case-"));
  c.fixture?.(fix);
  const home = c.home ? c.home(fix) : fix;
  const r = spawnSync("bash", ["-c", `. "$LIBDIR/common.sh"; ${c.snippet}`], {
    cwd: fix,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: home, LIBDIR: lib, FIX: fix, ARG: c.arg ?? "", GIT_CONFIG_NOSYSTEM: "1" },
  });
  return { decision: r.status === 0 ? "pass" : "refuse", stderr: r.stderr };
}

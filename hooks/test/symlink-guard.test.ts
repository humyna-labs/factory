// W2-03, D2-night N2f: no symlinks in any factory or product repo. Covers hooks/symlink-guard.sh,
// the pre-push rules that call it, the gates.yml step (run for real, extracted from the file),
// and a mutation check of every rule (G-03).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const ZERO = "0".repeat(40);
const GOOD_URL = "https://github.com/humyna-labs/resume-sg.git";

function repo(withLink: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "factory-symlink-"));
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "bot");
  git("config", "user.email", "bot@localhost");
  writeFileSync(join(dir, "a.txt"), "a");
  if (withLink) symlinkSync("/etc/hosts", join(dir, "hosts"));
  git("add", "-A");
  git("commit", "-q", "-m", "x\n\nAgent-Role: builder");
  return { dir, git, sha: git("rev-parse", "HEAD").stdout.trim() };
}

/** A commit whose tree object is missing: rev-list works, ls-tree fails. */
function brokenTree() {
  const x = repo(false);
  const tree = x.git("rev-parse", "HEAD^{tree}").stdout.trim();
  rmSync(join(x.dir, ".git", "objects", tree.slice(0, 2), tree.slice(2)));
  return x;
}

/** A symlink that was added and removed again: absent from HEAD's tree, present in history. */
function linkInHistory() {
  const x = repo(true);
  x.git("rm", "-q", "hosts");
  x.git("commit", "-q", "-m", "remove\n\nAgent-Role: builder");
  return x;
}

type Mutate = { file: "hooks/symlink-guard.sh" | ".githooks/pre-push"; id: string };

/** A scratch factory layout so a mutated copy of one file still finds the other. */
function layout(mutate?: Mutate) {
  const s = mkdtempSync(join(tmpdir(), "factory-symlink-layout-"));
  mkdirSync(join(s, "hooks"));
  mkdirSync(join(s, ".githooks"));
  for (const f of ["hooks/symlink-guard.sh", ".githooks/pre-push"]) {
    let text = readFileSync(join(ROOT, f), "utf8");
    if (mutate?.file === f) {
      const re = new RegExp(`^(\\s*)# RULE ${mutate.id} begin[\\s\\S]*?# RULE ${mutate.id} end\\s*$`, "m");
      if (!re.test(text)) throw new Error(`rule ${mutate.id} not found in ${f}`);
      text = text.replace(re, `$1: # RULE ${mutate.id} disabled`);
    }
    writeFileSync(join(s, f), text, { mode: 0o755 });
  }
  return s;
}

const scan = (root: string, dir: string, ...args: string[]) => spawnSync("bash", [join(root, "hooks", "symlink-guard.sh"), ...args], { cwd: dir, encoding: "utf8" });
const push = (root: string, dir: string, sha: string, o: { url?: string; remoteSha?: string } = {}) =>
  spawnSync("bash", [join(root, ".githooks", "pre-push"), "origin", o.url ?? GOOD_URL], { cwd: dir, encoding: "utf8", input: `refs/heads/x ${sha} refs/heads/factory/x ${o.remoteSha ?? ZERO}\n` });

type Case = [string, (root: string) => number, number];
const CASES: Case[] = [
  ["--scan-git: clean repo", (r) => scan(r, repo(false).dir, "--scan-git").status ?? -1, 0],
  ["--scan-git: tracked symlink", (r) => scan(r, repo(true).dir, "--scan-git").status ?? -1, 2],
  ["--commits: clean commit", (r) => { const x = repo(false); return scan(r, x.dir, "--commits", x.sha).status ?? -1; }, 0],
  ["--commits: commit with a symlink", (r) => { const x = repo(true); return scan(r, x.dir, "--commits", x.sha).status ?? -1; }, 2],
  ["--commits: a tree git cannot read fails closed", (r) => { const x = brokenTree(); return scan(r, x.dir, "--commits", "-n", "1", x.sha).status ?? -1; }, 70],
  ["pre-push: clean branch", (r) => { const x = repo(false); return push(r, x.dir, x.sha).status ?? -1; }, 0],
  ["pre-push: branch with a symlink", (r) => { const x = repo(true); return push(r, x.dir, x.sha).status ?? -1; }, 1],
  ["pre-push: a remote commit git does not know fails closed", (r) => { const x = repo(false); return push(r, x.dir, x.sha, { remoteSha: "1".repeat(40) }).status ?? -1; }, 1],
  [
    "pre-push: a new branch whose tip a remote-tracking ref already has is still inspected",
    (r) => {
      const x = repo(true);
      x.git("update-ref", "refs/remotes/origin/elsewhere", x.sha);
      return push(r, x.dir, x.sha).status ?? -1;
    },
    1,
  ],
  [
    "pre-push: a rejected URL is shown without its user info",
    (r) => {
      const x = repo(false);
      const out = push(r, x.dir, x.sha, { url: "https://user:SECRET123@gitlab.example/humyna-labs/x.git" });
      return out.status === 1 && !out.stderr.includes("SECRET123") && out.stderr.includes("https://gitlab.example/humyna-labs/x.git") ? 0 : 99;
    },
    0,
  ],
];

/** The run: block of the gates.yml symlink step, dedented. */
function gatesStep(text: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.includes("- name: no symlinks in any commit"));
  if (at < 0) throw new Error("symlink step not found in gates.yml");
  if (!/^\s+run: \|$/.test(lines[at + 1] ?? "")) throw new Error("expected 'run: |' after the step name");
  const body: string[] = [];
  for (const l of lines.slice(at + 2)) {
    if (l.trim() !== "" && !l.startsWith("          ")) break;
    body.push(l.slice(10));
  }
  return body.join("\n");
}

const GATES = readFileSync(join(ROOT, "ci", "workflows", "gates.yml"), "utf8");
/** 0 = the step passes, 1 = it fails (with any status). */
const runStep = (script: string, dir: string) => ({ status: spawnSync("bash", ["-c", script], { cwd: dir, encoding: "utf8" }).status === 0 ? 0 : 1 });
const STEP_CASES: [string, () => string, number][] = [
  ["clean history", () => repo(false).dir, 0],
  ["a symlink in HEAD", () => repo(true).dir, 1],
  ["a symlink only in an earlier commit", () => linkInHistory().dir, 1],
  ["not a git repository (git fails)", () => mkdtempSync(join(tmpdir(), "not-git-")), 1],
];

describe("symlink guard (W2-03)", () => {
  const root = layout();
  it.each(CASES)("%s", (_n, f, want) => {
    expect(f(root)).toBe(want);
  });
  it("names the rule and the path, and pre-push fails closed without the guard", () => {
    const x = repo(true);
    expect(scan(root, x.dir, "--scan-git").stderr).toMatch(/rule=L1 symlink not allowed: hosts/);
    const s = layout();
    spawnSync("rm", [join(s, "hooks", "symlink-guard.sh")]);
    const y = repo(false);
    const r = push(s, y.dir, y.sha);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/symlink guard missing/);
  });
  it("the factory repo itself has no tracked symlink", () => {
    expect(scan(ROOT, ROOT, "--scan-git").status).toBe(0);
  });
  it.each(["hooks/symlink-guard.sh:L1", "hooks/symlink-guard.sh:L2", "hooks/symlink-guard.sh:L3", ".githooks/pre-push:P1", ".githooks/pre-push:P2", ".githooks/pre-push:P3", ".githooks/pre-push:P4"])("mutation: disabling %s makes a case fail", (spec) => {
    const [file, id] = spec.split(":") as [Mutate["file"], string];
    const s = layout({ file, id });
    const failing = CASES.filter(([, f, want]) => f(s) !== want);
    expect(failing.length).toBeGreaterThan(0);
  });
  it("every rule block in both files is in the mutation list above", () => {
    const ids = (f: string) => [...readFileSync(join(ROOT, f), "utf8").matchAll(/^\s*# RULE ([A-Z][0-9]+) begin/gm)].map((m) => m[1]);
    expect(ids("hooks/symlink-guard.sh")).toEqual(["L1", "L3", "L2"]);
    expect(ids(".githooks/pre-push")).toEqual(["P4", "P2", "P3", "P1"]);
  });
});

describe("gates.yml symlink step (W2-03, Codex 8), run from the file", () => {
  const step = gatesStep(GATES);
  it("runs with pipefail, before the tools checkout, and every run step uses bash", () => {
    expect(step).toMatch(/^set -euo pipefail$/m);
    expect(GATES.indexOf("- name: no symlinks in any commit")).toBeLessThan(GATES.indexOf("repository: humyna-labs/factory"));
    expect(GATES).toMatch(/^defaults:\n {2}run:\n {4}shell: bash$/m);
  });
  it.each(STEP_CASES)("%s", (_n, fixture, want) => {
    expect(runStep(step, fixture()).status).toBe(want);
  });
  it.each([
    ["without pipefail and -e", (s: string) => s.replace("set -euo pipefail\n", "")],
    ["scanning only HEAD", (s: string) => s.replace("commits=$(git rev-list HEAD)", "commits=$(git rev-parse HEAD)")],
  ])("mutation: the step %s misses a case", (_n, mutate) => {
    const m = mutate(step);
    expect(m).not.toBe(step);
    const failing = STEP_CASES.filter(([, fixture, want]) => runStep(m, fixture()).status !== want);
    expect(failing.length).toBeGreaterThan(0);
  });
});

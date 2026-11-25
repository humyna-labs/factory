// W2-03: no symlinks in any factory or product repo. Covers hooks/symlink-guard.sh, the pre-push
// rule P1 that calls it, and a mutation check of L1, L2 and P1 (G-03).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const ZERO = "0".repeat(40);

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
  return { dir, sha: git("rev-parse", "HEAD").stdout.trim() };
}

/** A scratch factory layout so a mutated copy of one file still finds the other. */
function layout(mutate?: { file: "hooks/symlink-guard.sh" | ".githooks/pre-push"; id: string }) {
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
const push = (root: string, dir: string, sha: string) =>
  spawnSync("bash", [join(root, ".githooks", "pre-push"), "origin", "https://github.com/humyna-labs/resume-sg.git"], { cwd: dir, encoding: "utf8", input: `refs/heads/x ${sha} refs/heads/factory/x ${ZERO}\n` });

type Case = [string, (root: string) => number, number];
const CASES: Case[] = [
  ["--scan-git: clean repo", (r) => scan(r, repo(false).dir, "--scan-git").status ?? -1, 0],
  ["--scan-git: tracked symlink", (r) => scan(r, repo(true).dir, "--scan-git").status ?? -1, 2],
  ["--commits: clean commit", (r) => { const x = repo(false); return scan(r, x.dir, "--commits", x.sha).status ?? -1; }, 0],
  ["--commits: commit with a symlink", (r) => { const x = repo(true); return scan(r, x.dir, "--commits", x.sha).status ?? -1; }, 2],
  ["pre-push: clean branch", (r) => { const x = repo(false); return push(r, x.dir, x.sha).status ?? -1; }, 0],
  ["pre-push: branch with a symlink", (r) => { const x = repo(true); return push(r, x.dir, x.sha).status ?? -1; }, 1],
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
  it("gates.yml runs the symlink check in the secrets job", () => {
    const g = readFileSync(join(ROOT, "ci", "workflows", "gates.yml"), "utf8");
    expect(g).toMatch(/- name: no symlinks \(W2-03\)\n\s+run: \|\n\s+links=\$\(git ls-files -s \| awk '\$1 == "120000"'/);
  });
  it.each([
    ["hooks/symlink-guard.sh", "L1"],
    ["hooks/symlink-guard.sh", "L2"],
    [".githooks/pre-push", "P1"],
  ] as const)("mutation: disabling %s %s makes a case fail", (file, id) => {
    const s = layout({ file, id });
    const failing = CASES.filter(([, f, want]) => f(s) !== want);
    expect(failing.length).toBeGreaterThan(0);
  });
});

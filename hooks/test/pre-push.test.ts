// R-07: the pre-push hook. Uses a throwaway repository; no network.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = join(import.meta.dirname, "..", "..", ".githooks", "pre-push");
const ZERO = "0".repeat(40);
const GOOD_URL = "https://github.com/humyna-labs/resume-sg.git";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "factory-prepush-"));
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "factory-bot");
  git("config", "user.email", "bot@localhost");
  const commit = (msg: string, file = "a.txt", author?: string) => {
    writeFileSync(join(dir, file), msg);
    git("add", "-A");
    const args = ["commit", "-q", "-m", msg];
    if (author) args.push("--author", author);
    git(...args);
    return git("rev-parse", "HEAD").stdout.trim();
  };
  const push = (url: string, remoteRef: string, sha: string) =>
    spawnSync("bash", [HOOK, "origin", url], { cwd: dir, encoding: "utf8", input: `refs/heads/x ${sha} ${remoteRef} ${ZERO}\n` });
  return { commit, push };
}

describe("pre-push hook (R-07)", () => {
  it("accepts a feature branch of humyna-labs with ASCII commits and the trailer", () => {
    const r = repo();
    const sha = r.commit("feat: x\n\nAgent-Role: builder");
    expect(r.push(GOOD_URL, "refs/heads/factory/resume-sg-1", sha).status).toBe(0);
    expect(r.push("git@github.com:humyna-labs/resume-sg.git", "refs/heads/f", sha).status).toBe(0);
  });
  it.each([
    ["another owner", "https://github.com/someone-else/resume-sg.git"],
    ["an owner with a similar name", "https://github.com/humyna-labs-fork/resume-sg.git"],
    ["a non-GitHub host", "https://gitlab.com/humyna-labs/resume-sg.git"],
    ["a local path", "/tmp/some/bare.git"],
  ])("rejects %s", (_n, url) => {
    const r = repo();
    const sha = r.commit("feat: x\n\nAgent-Role: builder");
    const out = r.push(url, "refs/heads/f", sha);
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/REJECTED/);
  });
  it("rejects pushes to main and tag pushes", () => {
    const r = repo();
    const sha = r.commit("feat: x\n\nAgent-Role: builder");
    expect(r.push(GOOD_URL, "refs/heads/main", sha).stderr).toMatch(/never push main/);
    expect(r.push(GOOD_URL, "refs/tags/v1", sha).stderr).toMatch(/tags are made by the human/);
  });
  it("rejects a commit without the Agent-Role trailer", () => {
    const r = repo();
    expect(r.push(GOOD_URL, "refs/heads/f", r.commit("feat: no trailer")).stderr).toMatch(/Agent-Role/);
  });
  it("rejects a non-ASCII commit message", () => {
    const r = repo();
    expect(r.push(GOOD_URL, "refs/heads/f", r.commit("feat: café\n\nAgent-Role: builder")).stderr).toMatch(/not ASCII/);
  });
  it("fails closed when git config user.email is not set (Codex 8)", () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-prepush-noid-"));
    const env = { PATH: process.env.PATH ?? "", HOME: dir, GIT_CONFIG_NOSYSTEM: "1" };
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "a");
    git("add", "-A");
    git("-c", "user.name=b", "-c", "user.email=b@localhost", "commit", "-q", "-m", "x\n\nAgent-Role: builder");
    const sha = git("rev-parse", "HEAD").stdout.trim();
    const out = spawnSync("bash", [HOOK, "origin", GOOD_URL], { cwd: dir, encoding: "utf8", env, input: `refs/heads/x ${sha} refs/heads/f ${ZERO}\n` });
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/user\.email is not set/);
  });
  it("an update after a re-run on a fresh base skips base commits already on the remote (resume-sg#6)", () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-prepush-rerun-"));
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    const commit = (msg: string, file: string, author?: string) => {
      writeFileSync(join(dir, file), msg);
      git("add", "-A");
      git("commit", "-q", "-m", msg, ...(author ? ["--author", author] : []));
      return git("rev-parse", "HEAD").stdout.trim();
    };
    git("init", "-q", "-b", "main");
    git("config", "user.name", "factory-bot");
    git("config", "user.email", "bot@localhost");
    const base = commit("chore: base\n\nAgent-Role: coordinator", "base.txt");
    git("update-ref", "refs/remotes/origin/main", base);
    git("checkout", "-q", "-b", "factory/p-6");
    const oldTip = commit("feat: first run\n\nAgent-Role: builder", "a.txt");
    git("update-ref", "refs/remotes/origin/factory/p-6", oldTip);
    git("checkout", "-q", "main");
    const merged = commit("Info pages (#5)", "b.txt", "Someone <someone@localhost>");
    const push = (tip: string) => spawnSync("bash", [HOOK, "origin", GOOD_URL], { cwd: dir, encoding: "utf8", input: `refs/heads/factory/p-6 ${tip} refs/heads/factory/p-6 ${oldTip}\n` });
    git("checkout", "-q", "-B", "factory/p-6", "main");
    const newTip = commit("feat: re-run\n\nAgent-Role: builder", "c.txt");
    // the merged commit is not on a remote-tracking ref yet: it is checked and refused
    expect(push(newTip).stderr).toMatch(/REJECTED: commit [0-9a-f]+ (has no|is not authored)/);
    // once origin/main has it (fetched), it is not this push's to vouch for
    git("update-ref", "refs/remotes/origin/main", merged);
    expect(push(newTip).status).toBe(0);
    // the agent's own commits are still checked
    const bad = commit("feat: no trailer", "d.txt");
    expect(push(bad).stderr).toMatch(/Agent-Role/);
    const foreign = commit("feat: x\n\nAgent-Role: builder", "e.txt", "Someone <someone@localhost>");
    expect(push(foreign).stderr).toMatch(/machine account/);
  });
  it("rejects a commit by another author", () => {
    const r = repo();
    expect(r.push(GOOD_URL, "refs/heads/f", r.commit("feat: x\n\nAgent-Role: builder", "b.txt", "Someone <someone@localhost>")).stderr).toMatch(/machine account/);
  });
});

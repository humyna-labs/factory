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
  it("rejects a commit by another author", () => {
    const r = repo();
    expect(r.push(GOOD_URL, "refs/heads/f", r.commit("feat: x\n\nAgent-Role: builder", "b.txt", "Someone <someone@localhost>")).stderr).toMatch(/machine account/);
  });
});

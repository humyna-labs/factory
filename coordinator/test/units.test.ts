import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { factoryConfigJsonSchema, parseFactoryConfig } from "../src/config.ts";
import { childEnv, passthroughNames } from "../src/env.ts";
import type { Exec } from "../src/exec.ts";
import { FakeGitHub } from "../src/github/fake.ts";
import { GhGitHub } from "../src/github/gh.ts";
import { mergeLowRisk, MergeRefused } from "../src/merge.ts";
import { newProduct } from "../src/new-product.ts";
import { factoryPath } from "../src/paths.ts";
import { dependsOn, orderTasks } from "../src/queue.ts";
import { checkReport } from "../src/report.ts";
import { assessRisk, globToRegExp } from "../src/risk.ts";
import { tmp } from "./helpers.ts";
import { writeFileSync } from "node:fs";
import type { Issue } from "../src/types.ts";

const issue = (number: number, labels: string[], body = ""): Issue => ({ owner: "humyna-labs", repo: "resume-sg", number, title: "t", body, labels, state: "open" });

describe("merge path (R-02)", () => {
  it("refuses to merge high risk, even if called", async () => {
    const gh = new FakeGitHub();
    await expect(mergeLowRisk(gh, "humyna-labs", "resume-sg", 1, "high")).rejects.toBeInstanceOf(MergeRefused);
    expect(gh.calls.filter((c) => c.op === "merge")).toHaveLength(0);
  });
  it("refuses to merge when checks failed", async () => {
    const gh = new FakeGitHub();
    gh.checksState = "failure";
    await expect(mergeLowRisk(gh, "humyna-labs", "resume-sg", 1, "low")).rejects.toThrow(/checks failed/);
  });
  it("gh adapter merges with --auto --squash so GitHub still enforces required checks", async () => {
    const calls: string[][] = [];
    const fake: Exec = async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: "[]", stderr: "", timedOut: false };
    };
    await new GhGitHub(fake).merge("humyna-labs", "resume-sg", 7);
    expect(calls[0]).toEqual(["gh", "pr", "merge", "7", "-R", "humyna-labs/resume-sg", "--squash", "--auto", "--delete-branch"]);
  });
  it("gh adapter changes labels and passes bodies on stdin", async () => {
    const calls: { args: string[]; input?: string | undefined; kind?: string | undefined }[] = [];
    const fake: Exec = async (_cmd, args, o) => {
      calls.push({ args, input: o?.input, kind: o?.kind });
      return { code: 0, stdout: "https://github.com/humyna-labs/factory/issues/9\n", stderr: "", timedOut: false };
    };
    const gh = new GhGitHub(fake);
    await gh.setLabels("humyna-labs", "resume-sg", 3, ["factory:impl"], ["factory:tests"]);
    const created = await gh.createIssue("humyna-labs", "factory", "title", "body text", ["harness-fix"]);
    expect(calls[0]?.args).toEqual(["issue", "edit", "3", "-R", "humyna-labs/resume-sg", "--add-label", "factory:impl", "--remove-label", "factory:tests"]);
    expect(calls[1]?.input).toBe("body text");
    expect(calls.every((c) => c.kind === "gh")).toBe(true);
    expect(created.number).toBe(9);
  });
});

describe("environment (R-05)", () => {
  it("child env contains only allowlisted names plus non-interactive switches", () => {
    const allowed = new Set([...passthroughNames("claude"), ...passthroughNames("gh"), "GIT_TERMINAL_PROMPT", "GH_PROMPT_DISABLED", "CI"]);
    for (const kind of ["plain", "gh", "claude", "git"] as const) for (const k of Object.keys(childEnv(kind))) expect(allowed.has(k)).toBe(true);
    expect(childEnv("plain").GIT_TERMINAL_PROMPT).toBe("0");
    expect(Object.keys(childEnv("plain"))).not.toContain("GH_TOKEN");
    expect(passthroughNames("gh")).toContain("GH_TOKEN");
  });
  it("passes the Playwright browser path to gates and role sessions, never GH_TOKEN to them", () => {
    for (const kind of ["plain", "claude", "git"] as const) expect(passthroughNames(kind)).toContain("PLAYWRIGHT_BROWSERS_PATH");
    expect(passthroughNames("claude")).not.toContain("GH_TOKEN");
  });
});

describe("risk", () => {
  it("globs match like CODEOWNERS-style paths", () => {
    expect(globToRegExp("src/security/**").test("src/security/a/b.ts")).toBe(true);
    expect(globToRegExp("ci/**").test("ci/workflows/x.yml")).toBe(true);
    expect(globToRegExp("package.json").test("sub/package.json")).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
  });
  it("is high when labelled high, unlabelled, or touching a high-risk path", () => {
    const hr = ["public/_headers", "src/privacy/**"];
    expect(assessRisk(["risk:low"], ["src/a.ts"], hr).risk).toBe("low");
    expect(assessRisk([], ["src/a.ts"], hr).risk).toBe("high");
    expect(assessRisk(["risk:high"], ["src/a.ts"], hr).risk).toBe("high");
    expect(assessRisk(["risk:low"], ["public/_headers"], hr).reasons[0]).toMatch(/high-risk path/);
  });
});

describe("queue helpers", () => {
  it("orders by priority label, then issue number; no label sorts last", () => {
    expect(orderTasks([issue(5, []), issue(3, ["priority:p2"]), issue(9, ["priority:p0"]), issue(1, ["priority:p2"])]).map((i) => i.number)).toEqual([9, 1, 3, 5]);
  });
  it("parses Depends-on lines", () => {
    expect(dependsOn(issue(1, [], "x\nDepends-on: #12\ndepends-on: #3\nnot Depends-on: #4"))).toEqual([12, 3]);
  });
});

describe("report check (R-20)", () => {
  const write = (text: string) => {
    const p = join(tmp(), "r.md");
    writeFileSync(p, text);
    return p;
  };
  const full = (s8: string) => `# r\n## 5. Surprises\nx\n## 6. Reusable practices\ny\n## 7. Proposed principle changes\nnone\n## 8. Proposed harness fixes\n${s8}\n## 9. Cost\n1\n`;
  it("requires the file", () => {
    expect(checkReport("/nonexistent/report.md").ok).toBe(false);
  });
  it("requires sections 5 to 8 to be present and not empty", () => {
    expect(checkReport(write(full("none"))).ok).toBe(true);
    expect(checkReport(write(full("<!-- todo -->"))).problems[0]).toMatch(/empty section "## 8/);
    expect(checkReport(write("# r\n## 5. Surprises\nx\n")).problems.length).toBe(3);
  });
  it("extracts the first proposed harness fix from a table or a bullet", () => {
    expect(checkReport(write(full("| Problem | Fix | Size | Risk |\n|---|---|---|---|\n| flaky e2e | add retry doc | S | low |"))).proposedHarnessFix).toBe("flaky e2e: add retry doc");
    expect(checkReport(write(full("- give builder a lint hint"))).proposedHarnessFix).toBe("give builder a lint hint");
    expect(checkReport(write(full("none"))).proposedHarnessFix).toBeUndefined();
  });
});

describe("factory.yaml schema and the product template", () => {
  const out = tmp("factory-np-");
  newProduct({ name: "demo-product", out, owner: "humyna-labs" });
  const cfgText = readFileSync(join(out, ".factory", "factory.yaml"), "utf8");

  it("generated factory.yaml validates, with max_impl_attempts 3", () => {
    const cfg = parseFactoryConfig(cfgText);
    expect(cfg.max_impl_attempts).toBe(3);
    expect(cfg.repo).toBe("humyna-labs/demo-product");
    expect(cfg.deploy.provider).toBe("cloudflare-pages");
  });
  it("defaults max_impl_attempts to 3 when absent and rejects unknown keys", () => {
    expect(parseFactoryConfig(cfgText.replace(/^max_impl_attempts:.*$/m, "")).max_impl_attempts).toBe(3);
    expect(() => parseFactoryConfig(cfgText + "\nsurprise: 1\n")).toThrow();
  });
  it("committed JSON Schema equals the one generated from the Zod schema (fix: node coordinator/src/cli.ts schema > templates/product/.factory/factory.schema.json)", () => {
    const committed = JSON.parse(readFileSync(factoryPath("templates", "product", ".factory", "factory.schema.json"), "utf8"));
    expect(committed).toEqual(factoryConfigJsonSchema());
  });
  it("leaves no placeholder behind and uses the default code owner humyna", () => {
    const owners = readFileSync(join(out, ".github", "CODEOWNERS"), "utf8");
    expect(owners).toContain("@humyna");
    expect(owners).not.toContain("{{");
    expect(readFileSync(join(out, "package.json"), "utf8")).toContain('"name": "demo-product"');
  });
  it("CODEOWNERS covers every high-risk path in factory.yaml", () => {
    const cfg = parseFactoryConfig(cfgText);
    const owners = readFileSync(join(out, ".github", "CODEOWNERS"), "utf8");
    for (const p of cfg.high_risk_paths) {
      const prefix = "/" + p.replace(/\*\*$/, "");
      const covered = owners.includes(prefix) || (p === "CODEOWNERS" && owners.includes("/.github/"));
      expect(covered, `CODEOWNERS misses ${p}`).toBe(true);
    }
  });
});

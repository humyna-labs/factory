// Shared case tables for the guards. The mutation test re-runs these against scratch copies
// with one rule disabled; every rule must make at least one case fail (R-16, G-03).
import { spawnSync } from "node:child_process";
import { mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";

export const WT = "/tmp/factory-guard-wt";
export const REPORTS = "/tmp/factory-guard-reports";

// W2-03 fixtures: a symlink that stays inside the worktree (only R10 can stop it) and one to a host file.
mkdirSync(`${WT}/src`, { recursive: true });
writeFileSync(`${WT}/src/real.ts`, "export {};\n");
// Test files import this module in parallel workers: create the links once, tolerate a race.
for (const [link, target] of [["src/inner.ts", `${WT}/src/real.ts`], ["src/hosts.ts", "/etc/hosts"]] as const) {
  const p = `${WT}/${link}`;
  let current: string | undefined;
  try {
    current = readlinkSync(p);
  } catch {
    current = undefined;
  }
  if (current === target) continue;
  rmSync(p, { force: true });
  try {
    symlinkSync(target, p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

export interface GuardCase {
  name: string;
  role: string;
  /** "path" uses --check mode; "tool" feeds hook JSON on stdin. */
  kind: "path" | "tool";
  target: string;
  tool?: "Write" | "Edit" | "MultiEdit" | "NotebookEdit" | "Bash";
  expect: "allow" | "deny";
  rule: string;
}

const p = (role: string, target: string, expect: "allow" | "deny", rule: string, name = `${role} ${expect} ${target}`): GuardCase => ({ name, role, kind: "path", target, expect, rule });
const b = (role: string, command: string, expect: "allow" | "deny", rule: string): GuardCase => ({ name: `${role} bash ${expect}: ${command}`, role, kind: "tool", tool: "Bash", target: command, expect, rule });

export const PATH_GUARD_CASES: GuardCase[] = [
  // A3: builder blocked from tests/ and feature_list.json
  p("builder", "tests/unit/a.test.ts", "deny", "R7"),
  p("builder", "feature_list.json", "deny", "R4"),
  p("builder", "src/App.tsx", "allow", "R7"),
  p("builder", "src/features/x.ts", "allow", "R7"),
  p("builder", "src/security/csp.ts", "deny", "R6"),
  p("builder", "src/contracts/api.ts", "deny", "R6"),
  p("builder", "src/.claude/settings.json", "deny", "R3"),
  p("builder", ".github/workflows/ci.yml", "deny", "R3"),
  p("builder", "src/CODEOWNERS", "deny", "R3"),
  p("builder", "package.json", "deny", "R7"),
  p("builder", "../other-task/src/x.ts", "deny", "R2"),
  p("builder", "src/../../escape/src/x.ts", "deny", "R2"),
  p("builder", "/etc/passwd", "deny", "R2"),
  p("builder", `${REPORTS}/resume-sg-1/2026-11-25-resume-sg-1-impl-1.md`, "allow", "R1"),
  p("builder", `${REPORTS}/resume-sg-1/notes.txt`, "deny", "R1"),
  p("builder", `${REPORTS}/a/b/c.md`, "deny", "R1"),
  p("qa", "tests/unit/a.test.ts", "allow", "R5"),
  p("qa", "evals/x/case.json", "allow", "R5"),
  p("qa", "src/App.tsx", "deny", "R5"),
  p("qa", "tests/feature_list.json", "deny", "R4"),
  p("qa", "tests/.github/x", "deny", "R3"),
  p("reviewer", "src/App.tsx", "deny", "R8"),
  p("compliance", "tests/a.ts", "deny", "R8"),
  p("compliance", `${REPORTS}/t-1/2026-11-25-t-1-compliance-1.md`, "allow", "R1"),
  p("gardener", "src/App.tsx", "deny", "R9"),
  // W2-03: symlinks
  p("builder", "src/inner.ts", "deny", "R10", "builder deny a changed path that is a symlink inside the worktree"),
  p("builder", "src/hosts.ts", "deny", "R10", "builder deny a symlink to a host file"),
  { name: "builder Write through a symlink is blocked", role: "builder", kind: "tool", tool: "Write", target: "src/inner.ts", expect: "deny", rule: "R10" },
  // W2-07: every role is blocked from feature_list.json
  p("qa", "feature_list.json", "deny", "R4"),
  p("reviewer", "feature_list.json", "deny", "R4"),
  p("compliance", "feature_list.json", "deny", "R4"),
  // W2-10: roles never write the report index
  p("builder", `${REPORTS}/INDEX.md`, "deny", "R1"),
  p("qa", `${REPORTS}/INDEX.md`, "deny", "R1"),
  { name: "builder Write tool to tests/ is blocked", role: "builder", kind: "tool", tool: "Write", target: "tests/x.test.ts", expect: "deny", rule: "R7" },
  { name: "builder Edit tool to feature_list.json is blocked", role: "builder", kind: "tool", tool: "Edit", target: `${WT}/feature_list.json`, expect: "deny", rule: "R4" },
  { name: "builder MultiEdit in src is allowed", role: "builder", kind: "tool", tool: "MultiEdit", target: "src/a.ts", expect: "allow", rule: "R7" },
  { name: "qa NotebookEdit outside tests is blocked", role: "qa", kind: "tool", tool: "NotebookEdit", target: "docs/n.ipynb", expect: "deny", rule: "R5" },
  b("builder", "pnpm test", "allow", "B0"),
  b("builder", "git push origin HEAD", "deny", "B1"),
  b("builder", "git commit -am x", "deny", "B1"),
  b("qa", "gh pr merge 3 --squash", "deny", "B1"),
  b("builder", ["claude --dangerously", "skip", "permissions"].join("-"), "deny", "B1"),
  b("qa", "cat .factory/factory.yaml", "deny", "B2"),
  b("builder", "echo x > feature_list.json", "deny", "B2"),
  b("builder", "echo 'it.skip' >> tests/unit/a.test.ts", "deny", "B3"),
  b("builder", "rm -rf src/security", "deny", "B3"),
  b("qa", "pnpm test 2>&1 | tail -5", "allow", "B0"),
  b("qa", "sed -i s/a/b/ src/App.tsx", "deny", "B4"),
  b("reviewer", "git diff main...HEAD", "allow", "B0"),
  b("reviewer", "git diff main...HEAD 2>/dev/null | head", "allow", "B0"),
  b("reviewer", "echo x > src/a.ts", "deny", "B5"),
  b("compliance", "rm notes.txt", "deny", "B5"),
  b("compliance", "/workspace/factory/hooks/secret-guard.sh --scan-git", "allow", "B0"),
  b("gardener", "ls", "deny", "B6"),
  b("builder", "ln -s /etc/hosts src/h.ts", "deny", "B7"),
  b("qa", "cd tests && ln -sf ../x y", "deny", "B7"),
  b("builder", "ln --symbolic a src/b", "deny", "B7"),
  b("builder", "ln /etc/hosts src/hard.ts", "deny", "B7"),
  b("builder", "node -e \"require('fs').symlinkSync('/etc','src/e')\"", "deny", "B7"),
  b("builder", "echo login && pnpm lint", "allow", "B0"),
];

export interface Outcome {
  decision: "allow" | "deny";
  rule: string;
  stderr: string;
}

export function runPathGuard(script: string, c: GuardCase, env: Record<string, string> = {}): Outcome {
  const baseEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", FACTORY_REPORTS_DIR: REPORTS, FACTORY_GUARD_LOG: env.FACTORY_GUARD_LOG ?? "/tmp/factory-guard-test.log", ...env };
  const r =
    c.kind === "path"
      ? spawnSync("bash", [script, c.role, "--check", WT, c.target], { encoding: "utf8", env: baseEnv })
      : spawnSync("bash", [script, c.role], {
          encoding: "utf8",
          env: baseEnv,
          input: JSON.stringify({ tool_name: c.tool, cwd: WT, tool_input: c.tool === "Bash" ? { command: c.target } : c.tool === "NotebookEdit" ? { notebook_path: c.target } : { file_path: c.target, content: "x" } }),
        });
  const rule = /rule=([A-Z][0-9]+)/.exec(r.stderr)?.[1] ?? (r.status === 0 ? "B0" : "?");
  return { decision: r.status === 0 ? "allow" : "deny", rule, stderr: r.stderr };
}

// Secret samples are assembled at runtime so no secret-shaped literal is ever committed.
const rep = (c: string, n: number) => c.repeat(n);
export interface SecretCase {
  name: string;
  text: string;
  expect: "clean" | "finding";
  rule?: string;
}
export const SECRET_CASES: SecretCase[] = [
  { name: "private key block", text: ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ") + "\nabc\n", expect: "finding", rule: "S1" },
  { name: "GitHub classic token", text: `token=${"ghp"}_${rep("a1B2", 9)}`, expect: "finding", rule: "S2" },
  { name: "GitHub fine-grained token", text: `${"github"}_pat_${rep("A1b2_", 6)}`, expect: "finding", rule: "S3" },
  { name: "Anthropic key", text: `${"sk"}-ant-api03-${rep("x9", 15)}`, expect: "finding", rule: "S4" },
  { name: "AWS access key id", text: `${"AK"}IA${rep("Q7", 8)}`, expect: "finding", rule: "S5" },
  { name: "Telegram bot token", text: `${"12345"}6789:AA${rep("h", 33)}`, expect: "finding", rule: "S6" },
  { name: "Slack token", text: `${"xo"}xb-${rep("12", 8)}`, expect: "finding", rule: "S7" },
  { name: "hard-coded password", text: `const PASSWORD = "${rep("Zq8", 8)}";`, expect: "finding", rule: "S8" },
  { name: "plain code", text: "export const greeting = 'hello';\nconst token = process.argv[2];\n", expect: "clean" },
  { name: "regex text describing a token", text: "match (ghp|gho)_[A-Za-z0-9]{36}\n", expect: "clean" },
  { name: "short assignment", text: 'secret = "short"', expect: "clean" },
];

export function runSecretGuard(script: string, text: string): { finding: boolean; rules: string[]; stderr: string } {
  const r = spawnSync("bash", [script, "--stdin"], { encoding: "utf8", input: text, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
  return { finding: r.status === 2, rules: [...r.stderr.matchAll(/secret-guard: (S[0-9]+)/g)].map((m) => m[1] ?? ""), stderr: r.stderr };
}

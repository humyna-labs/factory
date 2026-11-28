// factory#20 (resume-sg#52): the compliance role must run the secret scanner first, as a shell
// command of its own. Path-guard B2 blocks a whole command whose text names a harness path, so a
// chained scanner call can be blocked and the scan never runs. The fix is in the role prompt; no
// hook rule is loosened. These tests tie the prompt to the guard's real decisions.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPathGuard } from "./cases.ts";

const GUARD = join(import.meta.dirname, "..", "path-guard.sh");
const PROMPT = readFileSync(join(import.meta.dirname, "..", "..", "roles", "compliance.md"), "utf8");
const SCANNER = "/workspace/factory/hooks/secret-guard.sh --scan-git";

function section(title: string): string {
  const start = PROMPT.indexOf(`\n## ${title}`);
  if (start < 0) return "";
  const next = PROMPT.indexOf("\n## ", start + 4);
  return PROMPT.slice(start, next < 0 ? undefined : next);
}

const bash = (command: string) =>
  runPathGuard(GUARD, { name: "compliance scan", role: "compliance", kind: "tool", tool: "Bash", target: command, expect: "allow", rule: "B0" });

describe("compliance prompt: secret scan first, as a command of its own (factory#20)", () => {
  const scan = section("Secret scan: first, and as a command of its own");

  it("has the section and names the scanner as the first shell command", () => {
    expect(scan).not.toBe("");
    expect(scan).toMatch(/first shell command is exactly this/);
    expect(scan).toMatch(/nothing before or after it/);
  });

  it("the command in the section's code block is exactly the scanner, and the guard allows it", () => {
    const block = /```\n([^\n]+)\n```/.exec(scan);
    expect(block?.[1]).toBe(SCANNER);
    const o = bash(block?.[1] ?? "");
    expect(o.decision, o.stderr).toBe("allow");
    expect(o.rule, o.stderr).toBe("B0");
  });

  it("forbids chaining and explains why with rule B2", () => {
    for (const op of ["`;`", "`&&`", "`||`", "`|`"]) expect(scan).toContain(op);
    expect(scan).toMatch(/B2/);
    expect(scan).toMatch(/blocked as a whole/);
  });

  it("the chained form from resume-sg#52 is denied by B2, so the prompt rule is needed", () => {
    const o = bash(`${SCANNER}; echo "---"; cat .factory/factory.yaml`);
    expect(o.decision, o.stderr).toBe("deny");
    expect(o.rule, o.stderr).toBe("B2");
  });

  it("harness files are read with the Read tool, never in a shell command", () => {
    expect(section("Inputs")).toMatch(/`\.factory\/factory\.yaml` and any other harness file with the Read tool, never in a shell command/);
  });
});

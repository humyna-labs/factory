// Mutation check for the checks that live in the entry scripts and common.sh (G-03, D2-night N2).
// Each "# CHECK <id> begin/end" block is disabled in a scratch copy of scripts/, and each named
// weakening is applied by exact text replacement (it must match exactly once, so a mutation can
// never silently not apply). Then the scenarios that cover the id must show at least one failure.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyScripts, ENTRY_SCENARIOS, INSTALL_SCENARIOS, ROOT, type Scenario, SETUP_SCENARIOS } from "./flow-kit.ts";

const FILES = ["scripts/setup-repo.sh", "scripts/install-workflows.sh", "scripts/lib/common.sh"] as const;
const ALL: Scenario[] = [...SETUP_SCENARIOS, ...INSTALL_SCENARIOS, ...ENTRY_SCENARIOS];

interface Mutation {
  id: string;
  file: (typeof FILES)[number];
  /** Scenario coverage key; defaults to id. */
  covers?: string;
  apply: (text: string) => string;
}

function disableBlock(id: string) {
  return (text: string) => {
    const re = new RegExp(`^(\\s*)# CHECK ${id} begin[\\s\\S]*?# CHECK ${id} end\\s*$`, "m");
    if (!re.test(text)) throw new Error(`CHECK ${id} not found`);
    return text.replace(re, `$1: # CHECK ${id} disabled by mutation test`);
  };
}

function replaceOnce(find: string, by: string) {
  return (text: string) => {
    const n = text.split(find).length - 1;
    if (n !== 1) throw new Error(`mutation text found ${n} times, expected once: ${find}`);
    return text.replace(find, () => by);
  };
}

const blocks: Mutation[] = FILES.flatMap((file) =>
  [...readFileSync(join(ROOT, file), "utf8").matchAll(/^\s*# CHECK ([A-Z][0-9]+) begin/gm)].map((m) => {
    const id = m[1] ?? "";
    return { id, file, covers: id === "E1" ? `E1:${file.split("/").pop() ?? ""}` : id, apply: disableBlock(id) };
  }),
);

const weakenings: Mutation[] = [
  {
    id: "S1-weak",
    file: "scripts/setup-repo.sh",
    // Accept any bypass actor as long as one exists.
    apply: (t) => t.replace(/^BYPASS_JQ='.*'$/m, (line) => (line.startsWith("BYPASS_JQ='if") ? `BYPASS_JQ='"OrganizationAdmin:pull_request"'` : line)),
  },
  { id: "label-record", file: "scripts/setup-repo.sh", apply: replaceOnce('mutate "label ${name} created or updated" 30 gh label create', "with_timeout 30 gh label create") },
  { id: "push-refspec", file: "scripts/install-workflows.sh", apply: replaceOnce('"refs/heads/${BRANCH}:refs/heads/${BRANCH}"', '"${BRANCH}"') },
  // Behavioural weakenings: a disabled block that leaves a variable unset is only caught by a crash.
  { id: "I2", file: "scripts/install-workflows.sh", covers: "I2", apply: replaceOnce(' and .author.login == \\"${me}\\"', "") },
  { id: "I3", file: "scripts/install-workflows.sh", covers: "I3", apply: replaceOnce('base=$(git -C "${work}/repo" rev-parse -q --verify "refs/remotes/origin/main^{commit}")', 'base=$(git -C "${work}/repo" rev-parse HEAD)') },
  { id: "I3-fetch", file: "scripts/install-workflows.sh", apply: replaceOnce('with_timeout 60 git -C "${work}/repo" fetch -q --prune origin', "true || git fetch-disabled") },
];

describe("mutation check: checks in the entry scripts and common.sh", () => {
  it("finds the expected CHECK blocks", () => {
    expect(blocks.map((b) => `${b.file.split("/").pop()}:${b.id}`)).toEqual([
      "setup-repo.sh:E1",
      "setup-repo.sh:S1",
      "install-workflows.sh:E1",
      "install-workflows.sh:I1",
      "install-workflows.sh:I2",
      "install-workflows.sh:I3",
      "install-workflows.sh:I4",
      "install-workflows.sh:I5",
      "install-workflows.sh:I6",
      "install-workflows.sh:I7",
      "common.sh:M1",
    ]);
  });
  it.each([...blocks, ...weakenings].map((m) => [`${m.file.split("/").pop()} ${m.id}`, m] as const))("disabling %s makes a covering scenario fail", (_n, m) => {
    const key = m.covers ?? m.id;
    const scenarios = ALL.filter((s) => s.covers.includes(key));
    expect(scenarios.length, `no scenario covers ${key}`).toBeGreaterThan(0);
    const root = mkdtempSync(join(tmpdir(), `flows-mut-${m.id}-`));
    copyScripts(ROOT, root);
    const target = join(root, m.file);
    const before = readFileSync(target, "utf8");
    const after = m.apply(before);
    expect(after, "the mutation must change the file").not.toBe(before);
    writeFileSync(target, after);
    let failures = 0;
    for (const s of scenarios) {
      try {
        s.run(root);
      } catch {
        failures++;
      }
    }
    expect(failures, `no scenario noticed ${m.id}`).toBeGreaterThan(0);
  }, 300000);
});

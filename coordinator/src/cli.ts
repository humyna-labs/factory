#!/usr/bin/env node
// coordinator CLI. Examples:
//   coordinator --dry-run                         (queue over the dry-run fixture, stub roles, fake GitHub)
//   coordinator run --queue --max-hours 2 --repo-dir /workspace/products/resume-sg
//   coordinator run --task resume-sg#12 --repo-dir /workspace/products/resume-sg
//   coordinator validate-runs /workspace/runs/dry-run/runs.csv
//   coordinator new-product <name> --out <dir> [--code-owner humyna]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { factoryConfigJsonSchema, loadFactoryConfig } from "./config.ts";
import { restartTask, runTask, type Deps } from "./coordinator.ts";
import { DRY_RUN_FIXTURE, loadFixture, runFixture } from "./dryrun.ts";
import { EventLog } from "./events.ts";
import { exec } from "./exec.ts";
import { ShellGates } from "./gates/shell.ts";
import { GhGitHub } from "./github/gh.ts";
import { DEFAULT_CODE_OWNER, newProduct } from "./new-product.ts";
import { DEFAULT_RUNS_DIR, DRY_RUN_RUNS_DIR, factoryPath, runPaths } from "./paths.ts";
import { formatDigest, runQueue, writeDigest } from "./queue.ts";
import { RunsCsvWriter, validateRunsCsv } from "./runs-csv.ts";
import { ClaudeRunner } from "./runner/claude.ts";
import { loadRoleConfig } from "./runner/roles.ts";
import { taskId } from "./types.ts";
import { GitWorkspace } from "./workspace/git.ts";

const USAGE = `usage:
  coordinator [run] --dry-run [--resume] [--max-hours N] [--runs-dir DIR] [--verbose]
  coordinator run --queue --max-hours N --repo-dir DIR [--runs-dir DIR]
  coordinator run --task <repo>#<n> --repo-dir DIR [--runs-dir DIR] [--restart "<reason>"]
  coordinator validate-runs <runs.csv>
  coordinator new-product <name> --out DIR [--code-owner HANDLE]
  coordinator schema`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      restart: { type: "string" },
      resume: { type: "boolean", default: false },
      queue: { type: "boolean", default: false },
      "max-hours": { type: "string" },
      task: { type: "string" },
      "repo-dir": { type: "string" },
      "runs-dir": { type: "string" },
      out: { type: "string" },
      "code-owner": { type: "string", default: DEFAULT_CODE_OWNER },
      fixture: { type: "string" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const cmd = positionals[0] ?? "run";
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (cmd === "validate-runs") {
    const file = positionals[1];
    if (!file) throw new Error("validate-runs needs a file");
    const errors = validateRunsCsv(readFileSync(file, "utf8"));
    for (const e of errors) console.error(e);
    console.log(errors.length ? `FAIL ${file}: ${errors.length} violations` : `OK ${file}: matches the runs.csv contract (R-10)`);
    return errors.length ? 1 : 0;
  }
  if (cmd === "new-product") {
    const name = positionals[1];
    if (!name || !values.out) throw new Error("new-product needs <name> and --out DIR");
    const files = newProduct({ name, out: values.out, codeOwner: values["code-owner"] });
    console.log(`generated ${files.length} files in ${values.out}`);
    return 0;
  }
  if (cmd === "schema") {
    console.log(JSON.stringify(factoryConfigJsonSchema(), null, 2));
    return 0;
  }
  if (cmd !== "run") throw new Error(`unknown command ${cmd}\n${USAGE}`);

  const maxHours = Number(values["max-hours"] ?? "2");
  if (!(maxHours > 0)) throw new Error("--max-hours must be a positive number");

  if (values["dry-run"]) {
    const runsDir = values["runs-dir"] ?? DRY_RUN_RUNS_DIR;
    console.log(`dry-run: stub roles, stub gates, fake GitHub; ledger ${join(runsDir, "runs.csv")}${values.resume ? "; resuming the last dry run" : ""}`);
    console.log("dry-run: the factory pre-push hook is not set on the throwaway clone (its local bare remote is not a GitHub URL)");
    const { digest, paths } = await runFixture({ fixture: loadFixture(values.fixture ?? DRY_RUN_FIXTURE), runsDir, maxHours, resume: values.resume, log: values.verbose ? console.log : () => undefined });
    const file = writeDigest(paths.runsDir, digest);
    console.log(formatDigest(digest));
    console.log(`digest written to ${file}`);
    return 0;
  }

  // Live mode: gh adapter, claude runner, shell gates. Written, not run in Phase 1.
  const repoDir = values["repo-dir"];
  if (!repoDir) throw new Error("--repo-dir is required outside --dry-run");
  const cfg = loadFactoryConfig(join(repoDir, ".factory", "factory.yaml"));
  const paths = runPaths(values["runs-dir"] ?? DEFAULT_RUNS_DIR);
  const gh = new GhGitHub(exec);
  const deps: Deps = {
    cfg,
    gh,
    runner: new ClaudeRunner({ exec, loadRole: loadRoleConfig, baseBranch: cfg.base_branch, reportsDir: paths.reportsDir, guardLog: paths.guardLog, escalationsDir: paths.escalationsDir }),
    gates: new ShellGates(cfg, exec, { tmpRoot: join(paths.runsDir, "red") }),
    workspace: new GitWorkspace(exec, { repoDir, worktreesDir: paths.worktreesDir, baseBranch: cfg.base_branch, remote: "origin", pushHookPath: factoryPath(".githooks") }),
    exec,
    ledger: new RunsCsvWriter(paths.runsCsv),
    events: new EventLog(paths.events),
    paths,
    now: () => new Date(),
  };
  if (values.queue) {
    const dg = await runQueue(deps, maxHours);
    console.log(formatDigest(dg));
    console.log(`digest written to ${writeDigest(paths.runsDir, dg)}`);
    return 0;
  }
  if (!values.task) throw new Error("give --queue or --task <repo>#<n>");
  const m = /^([a-z0-9._-]+)#(\d+)$/.exec(values.task);
  if (!m || m[1] !== cfg.repo.split("/")[1]) throw new Error(`--task must be ${cfg.repo.split("/")[1]}#<n>`);
  const [owner, repo] = cfg.repo.split("/") as [string, string];
  let issue = await gh.getIssue(owner, repo, Number(m[2]));
  if (values.restart !== undefined) {
    if (!values.restart.trim()) throw new Error("--restart needs a reason, for example --restart \"issue revised to brief v5.2\"");
    issue = await restartTask(deps, issue, values.restart);
    console.log(`${taskId(issue)}: restarted from the tests stage (${values.restart})`);
  }
  const r = await runTask(deps, issue);
  console.log(`${r.task}: ${r.final}${r.prUrl ? ` ${r.prUrl}` : ""}`);
  return 0;
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isMain) {
  const argv = process.argv.slice(2);
  // "coordinator --dry-run" is shorthand for "coordinator run --dry-run".
  main(argv)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(`coordinator: ${(err as Error).message}`);
      process.exit(2);
    });
}

export { main };

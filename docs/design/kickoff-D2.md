# Factory kickoff D2: walking skeleton

You are building the first version of an agent factory in this repository
(`/workspace/factory`). Work in two phases and stop at the end of each.

Read these three files first, completely:

1. `docs/design/factory-spec.md`: the target design (written in Chinese).
2. `docs/design/brief-D2.md`: requirements R-01 to R-21, human-only steps, pitfalls.
   It wins over the spec where they disagree.
3. `docs/principles.md`: the principles every decision must cite.

## Phase 0: read-back (change nothing except the file named here)

Write `docs/design/readback-D2.md` with:

- each requirement R-01 to R-21 restated in one or two lines of your own words;
- every ambiguity, and every conflict between the spec and the brief, with the reading you
  intend to take;
- your assumptions;
- the file tree you plan to create in Phase 1 and the order of work;
- what you will deliberately not build in Phase 1.

Then stop. Wait for the human to answer "Confirmed" or to correct you. Update the
read-back file with any correction before you continue.

## Phase 1: walking skeleton (local only, no live GitHub calls)

Work on branch `factory/v1`, created from `main`. Build the thinnest version of each part
that lets one task travel the whole path. Put everything you leave out into
`docs/backlog.md`.

1. Scaffold: pnpm workspace, strict TypeScript, ESLint, a unit-test runner; `AGENTS.md`
   of about 100 lines that maps into `docs/`; `docs/failures.md`;
   `docs/golden-principles.md` seeded from Section B of the principles file;
   `docs/playbook/README.md`; `docs/runbook.md` covering H-03 and H-04;
   `docs/adr/0001-skeleton-first.md` citing principle IDs; `.githooks/pre-push` (R-07).
2. `coordinator/`:
   - the full state machine
     `ready -> tests -> impl -> verify -> review -> compliance -> pr -> auto-merge | needs-human | escalated`,
     with at most 3 implementation retries before escalation;
   - a role runner interface with two implementations: `stub` (deterministic scripts) and
     `claude` (headless `claude -p` with `--permission-mode auto`,
     `--append-system-prompt-file`, `--settings`, `--model`, `--max-turns`,
     `--output-format stream-json`, in a worktree). Unit-test the command assembly; do not
     call the real CLI in Phase 1;
   - a GitHub adapter interface with two implementations: `fake` (in memory) and `gh`.
     Only the coordinator calls merge (R-02);
   - the `runs.csv` writer and its schema test (R-10); escalation handling (R-09);
     queue mode with a digest (R-12); a `--dry-run` flag.
3. `roles/`: complete role files for `qa`, `builder`, `reviewer` and `compliance` (mission,
   inputs, outputs with exact paths, allowed and forbidden paths, definition of done,
   escalation format). The other four roles are listed in the backlog.
4. `hooks/path-guard.sh` with tests and a mutation check (R-03, R-16), and
   `settings/qa.json` and `settings/builder.json`.
5. `templates/product/`: a minimal Vite, React and TypeScript app with one page, one unit
   test, one Playwright smoke test, `public/_headers` with a strict CSP,
   `.factory/factory.yaml` with a schema, `CODEOWNERS`, and its CI caller under
   `ci/workflows/` (R-18).
6. `ci/workflows/gates.yml`: a reusable workflow with typecheck, lint, unit tests, the
   end-to-end smoke test and a secret scan. Other gates go in the backlog.
7. `scripts/setup-repo.sh` and `scripts/install-workflows.sh` for the human (R-08, H-01,
   H-02), each with `--dry-run`.
8. `evals/golden/`: one canned task with its expected outcome, and a runner.
9. `docs/backlog.md`: everything in the spec that Phase 1 does not build, as a checklist
   ordered for unattended windows, each item with size (S, M, L), risk (low, high),
   dependencies and acceptance criteria. Include R-06.

## Phase 1 acceptance

- A1. `pnpm -r typecheck`, `pnpm -r lint` and `pnpm -r test` exit 0.
- A2. `coordinator --dry-run` with stub roles and the fake GitHub adapter drives one
  low-risk task to merged, one high-risk task to needs-human, and one failing task to
  escalated after 3 retries with a drafted `harness-fix` issue. The `runs.csv` rows pass
  the schema test. Queue mode prints its digest.
- A3. The path guard blocks a builder write to `tests/` and to `feature_list.json`. The
  mutation check shows that disabling each rule makes a test fail.
- A4. A product generated from `templates/product` into a temporary directory passes
  typecheck, lint and unit tests, and its Playwright smoke test if the browser in this
  image can run it. If it cannot, say exactly why.
- A5. No file exists under `.github/workflows/`. No `--dangerously-skip-permissions`
  anywhere. No secrets. `bash -n` passes for every script.
- A6. `docs/design/trace-D2.md` exists (R-01 to R-21): one row per requirement with the files that
  implement it and how it was verified, marked "verified by running" or "written, not
  run" (R-15).

## End of Phase 1

Commit in small ASCII commits with an `Agent-Role: bootstrap` trailer. Push branch
`factory/v1` and open a pull request to `main` for the human. If the push or the pull
request is refused, report the exact error and stop.

Final report (R-20): write `docs/reports/2026-11-25-D2-phase1.md` from
`docs/templates/run-report.md` and commit it on the branch before opening the pull request.
In your last turn, summarize it in this order: acceptance results A1 to A6; the trace
table; the ordered human steps to take the skeleton live on `humyna-labs/resume-sg`
(rulesets, workflow install, Cloudflare Pages); blockers and anything unverified; the
first five backlog items you recommend for the next unattended window.

## Rules for the whole run

- If something is blocked (firewall, permissions, a safety check), report it and stop that
  step (R-14). Do not work around it.
- Do not modify `docs/design/factory-spec.md`, `docs/design/brief-D2.md` or Section A of
  `docs/principles.md`. Put proposals in the report.
- If a requirement turns out to be wrong or impossible, say so in the report with your
  evidence. Do not silently drop it or reinterpret it.
- Stop after 80 turns in Phase 1 and report where you are.

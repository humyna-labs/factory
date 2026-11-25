# Handoff D2-night: harden v1.2 from tonight's real-world results, then plan resume-sg

From: coach, for the owner. Written 2026-11-25 19:30 SGT.
Window: from now until 08:30 SGT (00:30 UTC). No new item after 23:30 UTC. Report by 00:30 UTC.
The owner is offline until the morning. Do not wait for "Confirmed" (section 6).

## 1. What happened tonight (facts you cannot see; the owner ran these on the host)

- factory: PR #1 (factory/v1) and PR #2 (factory/v1.1) merged with merge commits. Owner ran
  `setup-repo.sh humyna-labs/factory --profile factory --owner-bypass` and `install-workflows.sh`
  from a fresh clone `~/ai-projects/factory-reviewed`. PR #3 (gates.yml) merged through the bypass.
  `main` = `a4f6355`, tagged `v1`.
- setup-repo read-back failed on one field for both repos: `bypass_actors` expected
  `OrganizationAdmin:1:pull_request`, GitHub returned `OrganizationAdmin:null:pull_request`. Every
  earlier field matched (including the five product status checks and strict mode). The API also
  returns `current_user_can_bypass: "pull_requests_only"` for the owner. The bypass checkbox appeared
  on the PR page. Conclusion: GitHub stores no actor id for OrganizationAdmin; the script is wrong.
- resume-sg: H-04 done with the bundle method (container commit `95a5a79`, cloned on the host from
  `/workspace/runs/resume-sg-main.bundle`, pushed by the owner). Product ruleset applied. Workflow
  install PR: all five `gates / ...` checks green on the first run (names match), merged through the
  bypass with squash. H-01 verified with bot-authored PRs: #2 (only `public/_headers`) was
  REVIEW_REQUIRED/BLOCKED and the bot's `gh pr merge` was refused; after the owner approved it became
  mergeable; #3 (only `src/App.tsx`) was CLEAN with no review. Both closed, branches deleted.
- Bot token: the fine-grained token had been "pending organization approval" since it was created,
  so it had access to nothing. That is the real cause of this morning's 403 on factory. Now approved
  with: repos `factory` and `resume-sg` only (condo-demo removed); Contents, Pull requests, Issues
  read/write; Checks, Commit statuses, Actions read; nothing else.
- Cloudflare: "Create application" now opens a Workers flow (deploy command `npx wrangler deploy`,
  autoconfig PRs). The owner used "Continue to Pages" (labelled legacy), framework preset None (not
  VitePress), build `corepack enable && pnpm install --frozen-lockfile && pnpm build`, output `dist`,
  `NODE_VERSION=22`. Live at https://resume-sg.pages.dev with CSP, `x-frame-options: DENY`,
  `nosniff`, `referrer-policy: no-referrer`.
- Owner-side rules adopted today: never run git on the host inside `~/ai-projects/agent-factory`
  (its `.git/config` and hooks are agent-writable); reviewed clones live at
  `~/ai-projects/<repo>-reviewed` (inside `~/ai-projects` so the owner's noreply git identity applies);
  commits leave the bind mount only as a bundle, checked by SHA.

## 2. Inputs to read completely

- `/workspace/runs/reports/verify-2026-11-25/report.md` (independent verifier, problems P1-P9).
- `/workspace/runs/review/codex-W2/review.md` (Codex review: 14 findings; verdict "No").
- `docs/reports/2026-11-25-D2-W2.md`, `docs/runbook.md`, `docs/adr/0002-permission-model.md`,
  `docs/backlog.md`, `docs/design/factory-spec.md`.

## 3. Work items, in this order

N1. Create `factory/v1.2` from `origin/main` after `git fetch`. Small commits, each with an
    `Agent-Role:` trailer.

N2. Fix the owner-run scripts and hooks. Each fix gets a test and, for every new or changed guard,
    a mutation check. Make the fake `gh` normalise like GitHub where we now know it does (actor_id null).
  a. Read-back: for OrganizationAdmin compare type and mode only; accept actor_id null or 1.
  b. Codex 1 and 5: check the entry point and checkout before sourcing any library or running git
     there; apply the same check to `--dry-run`; require branch `main` tracking `origin/main`; treat a
     failed `git status` as a failure.
  c. Verifier P2 and Codex 3: refuse any byte outside printable ASCII, tab and newline in workflow
     files and `labels.txt`; show the staged files through an escaped view, not raw `git diff`; read
     the confirmation only from a terminal (`[ -t 0 ]`), refuse otherwise; show each label's old and
     new value in the plan.
  d. Verifier P3 and Codex 2: rewrite G7. Refuse any `write` or `write-all` token not on the allowlist
     anywhere in the file, including block scalars; refuse `pull_request_target`, `workflow_run` and
     `secrets: inherit`; refuse `uses:` outside `humyna-labs/` unless pinned to a 40-hex SHA. Use the
     verifier's five fixtures plus Codex's cases.
  e. Codex 4 and 7: exactly one fetch URL and one push URL (`--all`); push with a fully qualified
     refspec; check out and compare against an explicit fetched `main`.
  f. Codex 8 and 14: pre-push and symlink-guard fail closed on any git error and always inspect the
     pushed tip; never print a URL with user info; in `gates.yml`, `set -o pipefail` and scan before
     the tools checkout.
  g. Verifier P5 and Codex 13: record each label as it is applied; a timed-out mutation is reported
     as "outcome unknown, check the remote"; detect an existing install PR by head prefix, base `main`
     and author.
  h. Verifier P6 (B7 evasions) and P9 (tests must not write to the real `/workspace/runs/guard.log`).
  i. Docs: runbook step 1 and H-04 use the bundle method; H-01 verification uses a bot-authored PR;
     reviewed clones at `~/ai-projects/<repo>-reviewed` with a noreply identity check; H-03 describes
     "Continue to Pages", preset None; add a token check (organization approval and repository scope)
     before first use. ADR 0002: status accepted, option (b), with tonight's evidence. Add
     `docs/failures.md` entries for the null read-back, the pending token, the Cloudflare flow change.

N3. Verify. Run all checks, mutation tests, dry run, validate-runs, golden tasks. Then ask an
    in-session subagent with no prior context to compare the diff with this handoff and your report
    claims, and record its findings. It is the same model family: say so. The Codex review of v1.2
    stays a human step (G-09).

N4. Push `factory/v1.2` with the factory pre-push hook and open a PR to `main`. Put a Chinese PR brief
    in the body (BL-W2 format: 结论; 按风险分的改动; 证据（跑了什么、没跑什么）; 主人必须亲自看的地方，最多三处).
    Do not merge. If the push or PR fails, stop that item, record the exact error, do not try other
    credentials.

N5. Plan resume-sg without any GitHub write. From the resume-sg part of `docs/design/factory-spec.md`
    write into `/workspace/runs/plans/resume-sg/`: `brief-v2.md`, a draft `feature_list.json`, and
    3 to 5 issue drafts `issue-01.md`... Each issue fits one coordinator run, has a `Feature: <id>` line,
    a risk label with the reason, and acceptance criteria that tests can check. Issue 01 is low risk
    and visible on the live site. Mark every assumption. Constraints: no payments, ads or anything that
    earns money; collect no personal data unless the brief makes it necessary, and then keep it
    client-side; no secrets.

N6. Backlog entries with acceptance criteria (write only): move deploys to Workers static assets
    through a reviewed template PR (never Cloudflare autoconfig PRs); the coordinator, not the issue
    author, sets `risk:low` from the changed paths; a `check-bot-access` script; agent teams only as
    an L4 candidate for read-only investigations. Keep BL-W1 to BL-W3.

N7. Tidy the container product clone: check out `main`, fetch, delete the local `h01-*` branches.

## 4. Boundaries

No merges. No change to GitHub settings, rulesets, tokens or Cloudflare. No `.github/workflows/`
edits. No web. No package installs. No live model calls. Never run `setup-repo.sh` or
`install-workflows.sh` (they refuse in the container anyway). Nothing under `data/private`.

## 5. Report

`docs/reports/2026-11-26-D2-night.md` on `factory/v1.2`: per item done / partly / not done, evidence
you re-ran, the subagent's findings, what is "written, not run", the owner's steps for the morning in
order, and anything you read differently from this handoff. Then print at most ten lines here.

## 6. Working unattended

Write `docs/design/readback-D2-night.md` first (requirements in your words, your reading of anything
ambiguous), commit it, then start. Do not wait for an answer. If an item is blocked, record why and
move to the next one. Commit only work whose tests pass; unfinished work stays on a local `wip/<item>`
branch and is described in the report.

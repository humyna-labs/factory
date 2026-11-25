# Failures that needed a human

Rule 3 of `docs/principles.md`: every failure that needed a human gets an entry here. When the
same failure class is solved, add a note to `docs/playbook/` (rule 4).

Template:

```
## YYYY-MM-DD <short title>
- Symptom:
- Root cause:
- Principle: P-xx / G-xx
- Fix:
- Issue: <link>  PR: <link>
```

## 2026-11-25 Requirement R-04 cannot hold literally while the design docs quote it
- Symptom: the structure test for "the bypass flag appears nowhere in this repository" found
  the flag in `docs/design/brief-D2.md`, `docs/design/factory-spec.md` and
  `docs/design/kickoff-D2.md`, which agents may not edit.
- Root cause: the documents that forbid the flag spell it out.
- Principle: G-01 (a check proves only what it ran), P-05.
- Fix: the test exempts exactly those three human-owned files and nothing else; the read-back
  names the flag in words. Proposal to the human in `docs/reports/2026-11-25-D2-phase1.md`.
- Issue: none yet. PR: the D2 Phase 1 pull request.

## 2026-11-25 setup-repo.sh read-back: OrganizationAdmin bypass actor id is null
- Symptom: the first real `setup-repo.sh --owner-bypass` run, on `humyna-labs/factory` and on
  `humyna-labs/resume-sg`, failed its read-back on `bypass_actors`: expected
  `OrganizationAdmin:1:pull_request`, GitHub has `OrganizationAdmin:null:pull_request`. Every earlier
  field matched. The ruleset was already applied, so the repositories were in the intended state.
- Root cause: GitHub stores no actor id for the OrganizationAdmin actor type. The script compared a field
  written from memory (ADR 0002 flagged it), and the fake `gh` echoed request bodies back unchanged, so
  no test could fail on it (verifier P4). The bypass works: `current_user_can_bypass: "pull_requests_only"`
  and the bypass checkbox on the PR page.
- Principle: G-01, G-02.
- Fix: v1.2 compares an OrganizationAdmin bypass by type and mode and accepts `actor_id` null or 1; any
  other id or mode still fails. The fake `gh` now stores null like GitHub. Flow scenarios and a
  mutation check (`scripts/test/flow-kit.ts`, CHECK S1). Playbook: `fakes-store-what-the-service-stores.md`.
- Issue: none. PR: the `factory/v1.2` pull request.

## 2026-11-25 Machine token was pending organization approval (the real cause of F1)
- Symptom: in the morning, pushing `factory/v1` as `humyna-bot` failed with 403 (F1). ADR 0002 read it as
  missing write access and planned a role change.
- Root cause: the fine-grained token had been "pending organization approval" since it was created, so it
  could reach nothing. A 403 does not say why; nobody checked the token's state before first use.
- Principle: G-01 (the error proved only "denied"), G-02, P-02.
- Fix: the owner approved the token with repositories `factory` and `resume-sg` only (condo-demo removed);
  Contents, Pull requests, Issues read and write; Checks, Commit statuses, Actions read; nothing else.
  The runbook now has a token check before first use; a `check-bot-access` script is backlog BL-27.
- Issue: none. PR: the `factory/v1.2` pull request (docs).

## 2026-11-25 Cloudflare "Create application" opens a Workers flow, not Pages
- Symptom: runbook H-03 (written from memory) said "Create, Pages, Connect to Git". The dashboard's
  "Create application" now opens a Workers flow with the deploy command `npx wrangler deploy` and
  Cloudflare autoconfig pull requests.
- Root cause: a dashboard change; the H-03 steps had never been run. Autoconfig PRs would change deploy
  configuration (a high-risk path) outside the factory's review.
- Principle: G-04, P-11.
- Fix: the owner chose "Continue to Pages" (labelled legacy), framework preset None (not VitePress), build
  `corepack enable && pnpm install --frozen-lockfile && pnpm build`, output `dist`, `NODE_VERSION=22`. Live at
  https://resume-sg.pages.dev with CSP, `x-frame-options: DENY`, `nosniff`, `referrer-policy: no-referrer`.
  Runbook H-03 rewritten from that run. Moving to Workers static assets through a reviewed template PR,
  never through autoconfig PRs, is backlog BL-25.
- Issue: none. PR: the `factory/v1.2` pull request (docs).

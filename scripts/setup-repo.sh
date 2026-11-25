#!/usr/bin/env bash
# H-01: configure a humyna-labs repository for the factory. Run on the HOST as the human.
#   scripts/setup-repo.sh <owner/repo> [--dry-run] [--profile product|factory]
#                         [--review-mode codeowners|required-reviewers] [--team <team-slug>]
# Idempotent: re-running updates the same ruleset and labels. Self-checking: reads everything
# back at the end. Every network call has a timeout. See docs/runbook.md, H-01.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "${here}/lib/common.sh"

RULESET_NAME="factory-main"
PROFILE=""
REVIEW_MODE="codeowners"
TEAM=""
TARGET=""
HIGH_RISK_PATTERNS='"package.json","pnpm-lock.yaml","public/_headers","src/security/**","src/privacy/**","src/crypto/**","src/templates/**","workers/**","ci/**",".github/**",".factory/**"'
CHECKS='{"context":"gates / typecheck"},{"context":"gates / lint"},{"context":"gates / unit"},{"context":"gates / e2e"},{"context":"gates / secrets"}'

usage() {
  log "usage: setup-repo.sh <owner/repo> [--dry-run] [--profile product|factory] [--review-mode codeowners|required-reviewers] [--team <slug>]"
  exit 64
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --profile) [ $# -ge 2 ] || usage; PROFILE=$2; shift ;;
    --review-mode) [ $# -ge 2 ] || usage; REVIEW_MODE=$2; shift ;;
    --team) [ $# -ge 2 ] || usage; TEAM=$2; shift ;;
    -h | --help) usage ;;
    -*) die "unknown option $1" ;;
    *) [ -z "${TARGET}" ] || usage; TARGET=$1 ;;
  esac
  shift
done
[ -n "${TARGET}" ] || usage
parse_repo "${TARGET}"
R="${REPO_OWNER}/${REPO_NAME}"
if [ -z "${PROFILE}" ]; then
  if [ "${REPO_NAME}" = "factory" ]; then PROFILE=factory; else PROFILE=product; fi
fi
case "${PROFILE}" in product | factory) ;; *) die "--profile must be product or factory" ;; esac
case "${REVIEW_MODE}" in
  codeowners) ;;
  required-reviewers) [ -n "${TEAM}" ] || die "--review-mode required-reviewers needs --team <slug> (a team that contains the human)" ;;
  *) die "--review-mode must be codeowners or required-reviewers" ;;
esac

log "setup-repo: ${R} profile=${PROFILE} review-mode=${REVIEW_MODE} dry-run=${DRY_RUN}"
if [ "${DRY_RUN}" = 0 ]; then
  require_host
  require_cmd gh
  with_timeout 30 gh auth status >/dev/null 2>&1 || die "gh is not logged in. Run: gh auth login"
  admin=$(with_timeout 30 gh api "repos/${R}" --jq .permissions.admin) || die "cannot read ${R}; does it exist? (H-04 creates it)"
  [ "${admin}" = "true" ] || die "your gh account is not an admin of ${R}"
  ok "preflight: host, gh logged in, admin on ${R}"
fi

# 1. Repository merge settings (auto-merge on, squash only, delete merged branches).
run_or_print "repo settings" with_timeout 30 gh api -X PATCH "repos/${R}" \
  -F allow_auto_merge=true -F delete_branch_on_merge=true \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false --silent

# 2. Labels (idempotent with --force).
while IFS='|' read -r name color desc; do
  case "${name}" in "" | \#*) continue ;; esac
  run_or_print "label ${name}" with_timeout 30 gh label create "${name}" -R "${R}" --color "${color}" --description "${desc}" --force
done <"${here}/labels.txt"

# 3. Ruleset on the default branch.
reviewers=""
if [ "${REVIEW_MODE}" = "required-reviewers" ]; then
  if [ "${DRY_RUN}" = 1 ]; then team_id=0; else
    team_id=$(with_timeout 30 gh api "orgs/${REPO_OWNER}/teams/${TEAM}" --jq .id) || die "team ${TEAM} not found in ${REPO_OWNER}"
  fi
  # Fallback from docs/runbook.md H-01: path-scoped required reviewers (written from memory, verify in the UI).
  reviewers=",\"required_reviewers\":[{\"minimum_approvals\":1,\"file_patterns\":[${HIGH_RISK_PATTERNS}],\"reviewer\":{\"id\":${team_id},\"type\":\"Team\"}}]"
fi
status_rule=""
if [ "${PROFILE}" = "product" ]; then
  status_rule=",{\"type\":\"required_status_checks\",\"parameters\":{\"strict_required_status_checks_policy\":false,\"required_status_checks\":[${CHECKS}]}}"
fi
body=$(mktemp)
trap 'rm -f "${body}"' EXIT
cat >"${body}" <<JSON
{
  "name": "${RULESET_NAME}",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "require_code_owner_review": true,
        "dismiss_stale_reviews_on_push": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false${reviewers} } }${status_rule}
  ]
}
JSON

if [ "${DRY_RUN}" = 1 ]; then
  log "DRY  ruleset ${RULESET_NAME} (POST or PUT repos/${R}/rulesets) with body:"
  cat "${body}"
else
  existing=$(with_timeout 30 gh api "repos/${R}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id") || die "cannot list rulesets"
  if [ -n "${existing}" ]; then
    with_timeout 30 gh api -X PUT "repos/${R}/rulesets/${existing}" --input "${body}" --silent || die "ruleset update failed"
    ok "ruleset ${RULESET_NAME} updated (id ${existing})"
  else
    with_timeout 30 gh api -X POST "repos/${R}/rulesets" --input "${body}" --silent || die "ruleset create failed"
    ok "ruleset ${RULESET_NAME} created"
  fi
fi

# 4. Self-check: read everything back.
if [ "${DRY_RUN}" = 1 ]; then
  log "DRY  self-check would read back: repo settings, labels, ruleset ${RULESET_NAME}"
  log "dry-run complete: nothing was changed"
  exit 0
fi
[ "$(with_timeout 30 gh api "repos/${R}" --jq .allow_auto_merge)" = "true" ] || die "auto-merge is not enabled on ${R}"
ok "auto-merge enabled"
want=$(grep -c '^[a-z]' "${here}/labels.txt")
have=$(with_timeout 30 gh label list -R "${R}" --limit 200 --json name --jq '.[].name' | grep -cE '^(factory:|risk:|priority:|harness-fix$)' || true)
[ "${have}" -ge "${want}" ] || die "expected ${want} factory labels, found ${have}"
ok "labels present (${have})"
id=$(with_timeout 30 gh api "repos/${R}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id")
rules=$(with_timeout 30 gh api "repos/${R}/rulesets/${id}" --jq '[.enforcement, ([.rules[].type] | join(","))] | join(" ")')
case "${rules}" in active*pull_request*) ok "ruleset active: ${rules}" ;; *) die "ruleset not as expected: ${rules}" ;; esac
log ""
log "Next: do the H-01 verification in docs/runbook.md (a test PR that touches only a high-risk"
log "path must NOT be mergeable without your approval). If it merges, re-run with"
log "  --review-mode required-reviewers --team <slug>"

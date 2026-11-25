#!/usr/bin/env bash
# H-01: configure a humyna-labs repository for the factory. Run on the HOST as the human, from
# the reviewed clone (docs/runbook.md).
#   scripts/setup-repo.sh <owner/repo> [--dry-run] [--profile product|factory]
#       [--review-mode codeowners|required-reviewers] [--team <team-slug>]
#       [--require-checks "<context>[,<context>]"]   (factory profile, once its CI exists)
#       [--owner-bypass]                             (ADR 0002 option b)
# Order (A5): check where it runs, read everything, print the plan (the existing ruleset next to
# the new one, each label's current and new value), ask you to type yes at the terminal, then
# change things. Every change is idempotent and recorded as it happens, so a re-run converges.
# At the end every field that was set is read back and compared (A3).
# First real run 2026-11-25: every field before bypass_actors read back as written; the
# OrganizationAdmin bypass actor id reads back as null (docs/failures.md), now accepted.
set -eu
# CHECK E1 begin  (Codex 1, N2b): before any library is sourced or git runs, refuse to start
# from the container's bind mount. Accident guard only: the reviewed clone is the control.
case "${BASH_SOURCE[0]}" in */*) here=${BASH_SOURCE[0]%/*} ;; *) here=. ;; esac
if [ -L "${BASH_SOURCE[0]}" ]; then printf 'FAIL run the script itself, not a symlink to it\n' >&2; exit 1; fi
here=$(cd "${here}" && pwd -P) || { printf 'FAIL cannot resolve the script directory\n' >&2; exit 1; }
mount_dir="${HOME:-/nonexistent}/ai-projects/agent-factory"
mount_phys=$(cd "${mount_dir}" 2>/dev/null && pwd -P || printf '%s' "${mount_dir}")
for m in "${mount_dir}" "${mount_phys}"; do
  case "$(printf '%s/' "${here}" | tr 'A-Z' 'a-z')" in
    "$(printf '%s' "${m}" | tr 'A-Z' 'a-z')"/*) printf 'FAIL this script is inside the bind mount %s, which the factory container can change. Run it from ~/ai-projects/factory-reviewed (docs/runbook.md)\n' "${mount_dir}" >&2; exit 1 ;;
  esac
done
# CHECK E1 end
. "${here}/lib/common.sh"

RULESET_NAME="factory-main"
LABELS_FILE="${here}/labels.txt"
HIGH_RISK_PATTERNS='"package.json","pnpm-lock.yaml","public/_headers","src/security/**","src/privacy/**","src/crypto/**","src/templates/**","workers/**","ci/**",".github/**",".factory/**"'
PRODUCT_CHECKS="gates / typecheck,gates / lint,gates / unit,gates / e2e,gates / secrets"

usage() {
  log "usage: setup-repo.sh <owner/repo> [--dry-run] [--profile product|factory] [--review-mode codeowners|required-reviewers] [--team <slug>] [--require-checks <ctx,ctx>] [--owner-bypass]"
  exit 64
}

# json_checks "<a,b>" -> {"context":"a"},{"context":"b"}
json_checks() {
  jc_out=""
  jc_rest="$1,"
  while [ -n "${jc_rest}" ]; do
    jc_one=${jc_rest%%,*}
    jc_rest=${jc_rest#*,}
    [ -n "${jc_one}" ] || continue
    jc_out="${jc_out}${jc_out:+,}{\"context\":\"${jc_one}\"}"
  done
  printf '%s' "${jc_out}"
}

build_body() {
  reviewers=""
  if [ "${REVIEW_MODE}" = "required-reviewers" ]; then
    # Fallback from docs/runbook.md H-01: path-scoped required reviewers (written, not run).
    reviewers=",\"required_reviewers\":[{\"minimum_approvals\":1,\"file_patterns\":[${HIGH_RISK_PATTERNS}],\"reviewer\":{\"id\":${TEAM_ID},\"type\":\"Team\"}}]"
  fi
  status_rule=""
  if [ -n "${CHECKS}" ]; then
    status_rule=",{\"type\":\"required_status_checks\",\"parameters\":{\"strict_required_status_checks_policy\":true,\"required_status_checks\":[$(json_checks "${CHECKS}")]}}"
  fi
  bypass="[]"
  if [ "${OWNER_BYPASS}" = 1 ]; then bypass='[{"actor_id":1,"actor_type":"OrganizationAdmin","bypass_mode":"pull_request"}]'; fi
  cat <<JSON
{
  "name": "${RULESET_NAME}",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": ${bypass},
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": ${APPROVALS},
        "require_code_owner_review": true,
        "dismiss_stale_reviews_on_push": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false${reviewers} } }${status_rule}
  ]
}
JSON
}

# CHECK S1 begin  (N2a): GitHub stores no actor id for OrganizationAdmin (it read back null on
# 2026-11-25), so that actor is compared by type and mode only; any other id is a mismatch.
BYPASS_JQ='if .actor_type == "OrganizationAdmin" and (.actor_id == null or .actor_id == 1) then "\(.actor_type):\(.bypass_mode)" else "\(.actor_type):\(.actor_id):\(.bypass_mode)" end'
# CHECK S1 end

# One line per checked ruleset field; RULESET_JQ must print the same lines from the API.
RULESET_FIELDS="name target enforcement ref_include rule_types pull_request required_reviewers status_checks bypass_actors"
RULESET_JQ='.name, .target, .enforcement, (.conditions.ref_name.include | join(",")), ([.rules[].type] | join(",")),
  (.rules[] | select(.type == "pull_request") | .parameters | "\(.required_approving_review_count),\(.require_code_owner_review),\(.dismiss_stale_reviews_on_push),\(.require_last_push_approval),\(.required_review_thread_resolution)"),
  ([.rules[] | select(.type == "pull_request") | .parameters.required_reviewers[]? | "\(.reviewer.type):\(.reviewer.id):\(.minimum_approvals)"] | join(",")),
  ((.rules[] | select(.type == "required_status_checks") | .parameters | "\(.strict_required_status_checks_policy) \([.required_status_checks[].context] | join(","))") // "none"),
  ([.bypass_actors[]? | '"${BYPASS_JQ}"'] | join(","))'

expected_ruleset_fields() {
  types="deletion,non_fast_forward,pull_request"
  [ -z "${CHECKS}" ] || types="${types},required_status_checks"
  rr=""
  [ "${REVIEW_MODE}" != "required-reviewers" ] || rr="Team:${TEAM_ID}:1"
  sc="none"
  [ -z "${CHECKS}" ] || sc="true ${CHECKS}"
  bp=""
  [ "${OWNER_BYPASS}" = 0 ] || bp="OrganizationAdmin:pull_request"
  printf '%s\n' "${RULESET_NAME}" branch active "~DEFAULT_BRANCH" "${types}" "${APPROVALS},true,true,false,false" "${rr}" "${sc}" "${bp}"
}

REPO_JQ='"\(.allow_auto_merge),\(.allow_squash_merge),\(.allow_merge_commit),\(.allow_rebase_merge),\(.delete_branch_on_merge)"'
WORKFLOW_JQ='"\(.default_workflow_permissions),\(.can_approve_pull_request_reviews)"'
LABEL_JQ='.[] | "\(.name)|\(.color | ascii_downcase)|\(.description // "")"'

# compare_fields <what> <field names> <expected lines> <actual lines>
compare_fields() {
  cf_i=0
  for cf_name in $2; do
    cf_i=$((cf_i + 1))
    cf_want=$(printf '%s\n' "$3" | sed -n "${cf_i}p")
    cf_have=$(printf '%s\n' "$4" | sed -n "${cf_i}p")
    [ "${cf_want}" = "${cf_have}" ] || die "$1 field ${cf_name}: expected '${cf_want}', GitHub has '$(safe "${cf_have}")'"
  done
  ok "$1: every field that was set reads back as expected"
}

# label_line <name> <name|color|description lines>: the line for <name>, or nothing.
label_line() {
  printf '%s\n' "$2" | awk -F'|' -v n="$1" '$1 == n { print; exit }'
}

# print_label_plan <labels file text> <existing labels>: each label's current and new value (Codex 3).
print_label_plan() {
  pl_new=0
  pl_same=0
  pl_change=0
  while IFS='|' read -r name color desc; do
    case "${name}" in "" | \#*) continue ;; esac
    have=$(label_line "${name}" "$2")
    if [ -z "${have}" ]; then
      log "  label ${name}: NEW color ${color}, description '${desc}'"
      pl_new=$((pl_new + 1))
    elif [ "${have}" = "${name}|${color}|${desc}" ]; then
      log "  label ${name}: SAME"
      pl_same=$((pl_same + 1))
    else
      have_rest=${have#*|}
      log "  label ${name}: CHANGE color $(safe "${have_rest%%|*}") -> ${color}, description '$(safe "${have_rest#*|}")' -> '${desc}'"
      pl_change=$((pl_change + 1))
    fi
  done <<EOF
$1
EOF
  log "  labels: ${pl_new} new, ${pl_change} changed, ${pl_same} unchanged; labels not in scripts/labels.txt are left alone"
}

main() {
  PROFILE=""
  REVIEW_MODE="codeowners"
  TEAM=""
  TARGET=""
  FACTORY_CHECKS=""
  OWNER_BYPASS=0
  TEAM_ID=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --profile) [ $# -ge 2 ] || usage; PROFILE=$2; shift ;;
      --review-mode) [ $# -ge 2 ] || usage; REVIEW_MODE=$2; shift ;;
      --team) [ $# -ge 2 ] || usage; TEAM=$2; shift ;;
      --require-checks) [ $# -ge 2 ] || usage; FACTORY_CHECKS=$2; shift ;;
      --owner-bypass) OWNER_BYPASS=1 ;;
      -h | --help) usage ;;
      -*) die "unknown option $(safe "$1")" ;;
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
    required-reviewers)
      [ -n "${TEAM}" ] || die "--review-mode required-reviewers needs --team <slug> (a team that contains the human)"
      guard_slug "${TEAM}" || die "bad --team"
      ;;
    *) die "--review-mode must be codeowners or required-reviewers" ;;
  esac
  case "${FACTORY_CHECKS}" in *[!A-Za-z0-9\ /._,-]*) die "--require-checks may contain only letters, digits, space and / . _ , -" ;; esac

  # Where this runs (Codex 1, 5): the same checks for dry runs and real runs.
  preflight_location "${here}/.."
  guard_labels_file "${LABELS_FILE}" || die "scripts/labels.txt failed validation"
  LABELS=$(cat "${LABELS_FILE}")

  # Profile (ADR 0002): the factory needs 1 human approval and keeps merge commits so the
  # per-commit Agent-Role trailers survive; products squash and may auto-merge low risk.
  if [ "${PROFILE}" = "factory" ]; then
    APPROVALS=1
    CHECKS="${FACTORY_CHECKS}"
    WANT_REPO="false,true,true,false,true"
    REPO_ARGS="-F allow_auto_merge=false -F allow_squash_merge=true -F allow_merge_commit=true -F allow_rebase_merge=false -F delete_branch_on_merge=true"
  else
    [ -z "${FACTORY_CHECKS}" ] || die "--require-checks is for the factory profile; products always require: ${PRODUCT_CHECKS}"
    APPROVALS=0
    CHECKS="${PRODUCT_CHECKS}"
    WANT_REPO="true,true,false,false,true"
    REPO_ARGS="-F allow_auto_merge=true -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -F delete_branch_on_merge=true"
  fi
  WANT_WORKFLOW="read,false"

  log "setup-repo: ${R} profile=${PROFILE} review-mode=${REVIEW_MODE} owner-bypass=${OWNER_BYPASS} dry-run=${DRY_RUN}"
  if [ "${DRY_RUN}" = 1 ]; then
    log "DRY  repo settings (PATCH repos/${R}): ${REPO_ARGS}"
    log "DRY  workflow token (PUT repos/${R}/actions/permissions/workflow): default_workflow_permissions=read can_approve_pull_request_reviews=false"
    while IFS='|' read -r name color desc; do
      case "${name}" in "" | \#*) continue ;; esac
      log "DRY  label ${name} (${color}): ${desc}"
    done <<EOF
${LABELS}
EOF
    if [ "${OWNER_BYPASS}" = 1 ]; then log "DRY  would refuse the bypass unless ${MACHINE_ACCOUNT} is an organization member, not an admin"; fi
    if [ "${PROFILE}" = "factory" ] && [ -z "${CHECKS}" ]; then log "DRY  no required status checks (add --require-checks once factory CI exists, BL-16)"; fi
    log "DRY  ruleset ${RULESET_NAME} (POST or PUT repos/${R}/rulesets) with body:"
    build_body
    log "DRY  self-check would read back: repo settings, workflow token, labels, every ruleset field"
    log "dry-run complete: nothing was changed"
    return 0
  fi

  require_cmd gh
  trap on_exit_report EXIT

  # 1. Read everything first (A5). Nothing below changes GitHub until you type yes.
  gh30 auth status --hostname github.com >/dev/null 2>&1 || die "gh is not logged in. Run: gh auth login"
  admin=$(ghapi "repos/${R}" --jq .permissions.admin) || die "cannot read ${R}; does it exist? (H-04 creates it)"
  [ "${admin}" = "true" ] || die "your gh account is not an admin of ${R}"
  have_repo=$(ghapi "repos/${R}" --jq "${REPO_JQ}") || die "cannot read repo settings"
  have_workflow=$(ghapi "repos/${R}/actions/permissions/workflow" --jq "${WORKFLOW_JQ}") || die "cannot read workflow token permissions"
  if [ "${REVIEW_MODE}" = "required-reviewers" ]; then
    TEAM_ID=$(ghapi "orgs/${REPO_OWNER}/teams/${TEAM}" --jq .id) || die "team ${TEAM} not found in ${REPO_OWNER}"
    case "${TEAM_ID}" in "" | *[!0-9]*) die "unexpected team id" ;; esac
  fi
  if [ "${OWNER_BYPASS}" = 1 ]; then
    bot_role=$(ghapi "orgs/${REPO_OWNER}/memberships/${MACHINE_ACCOUNT}" --jq .role 2>/dev/null) || bot_role="unknown (lookup failed)"
    guard_bot_not_admin "${bot_role}" || die "refusing the OrganizationAdmin bypass (ADR 0002 option b)"
    ok "${MACHINE_ACCOUNT} is an organization member, not an admin"
  fi
  existing=$(ghapi "repos/${R}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id") || die "cannot list rulesets"
  case "${existing}" in "" | *[!0-9]*) [ -z "${existing}" ] || die "more than one ruleset named ${RULESET_NAME}; remove the extra one in the UI" ;; esac
  have_labels=$(gh30 label list -R "github.com/${R}" --limit 200 --json name,color,description --jq "${LABEL_JQ}") || die "cannot list labels"
  body=$(build_body)
  ok "preflight: host, reviewed clone, gh logged in, admin on ${R}"

  # 2. Plan and confirmation (A2, A3).
  log ""
  log "PLAN for ${R} (profile ${PROFILE}):"
  log "  repo settings  now: ${have_repo}  new: ${WANT_REPO}  (auto_merge,squash,merge_commit,rebase,delete_branch)"
  log "  workflow token now: ${have_workflow}  new: ${WANT_WORKFLOW}  (default permissions,can approve PRs)"
  print_label_plan "${LABELS}" "${have_labels}"
  if [ -n "${existing}" ]; then
    log "  ruleset ${RULESET_NAME} (id ${existing}) will be REPLACED."
    log "EXISTING ruleset:"
    existing_json=$(ghapi "repos/${R}/rulesets/${existing}") || die "cannot read ruleset ${existing}"
    printf '%s\n' "${existing_json}" | cat -v
  else
    log "  ruleset ${RULESET_NAME} will be CREATED (none exists)."
  fi
  log "NEW ruleset:"
  log "${body}"
  confirm_yes "Apply this plan to ${R}?" || die "not confirmed; nothing was changed"

  # 3. Changes, each idempotent and recorded as it happens (A5, verifier P5).
  # shellcheck disable=SC2086 # REPO_ARGS is a fixed list of -F pairs
  mutate "repo merge settings" 30 gh api --hostname github.com -X PATCH "repos/${R}" ${REPO_ARGS} --silent || die "repo settings update failed"
  mutate "default workflow token set to read-only" 30 gh api --hostname github.com -X PUT "repos/${R}/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false --silent || die "workflow token update failed"
  while IFS='|' read -r name color desc; do
    case "${name}" in "" | \#*) continue ;; esac
    if [ "$(label_line "${name}" "${have_labels}")" = "${name}|${color}|${desc}" ]; then continue; fi
    mutate "label ${name} created or updated" 30 gh label create "${name}" -R "github.com/${R}" --color "${color}" --description "${desc}" --force </dev/null >/dev/null || die "label ${name} failed"
  done <<EOF
${LABELS}
EOF
  if [ -n "${existing}" ]; then
    mutate "ruleset ${RULESET_NAME} replaced (id ${existing})" 30 gh api --hostname github.com -X PUT "repos/${R}/rulesets/${existing}" --input - --silent <<EOF || die "ruleset update failed"
${body}
EOF
  else
    mutate "ruleset ${RULESET_NAME} created" 30 gh api --hostname github.com -X POST "repos/${R}/rulesets" --input - --silent <<EOF || die "ruleset create failed"
${body}
EOF
  fi

  # 4. Self-check: read back every field that was set (A3).
  compare_fields "repo settings" "merge_settings" "${WANT_REPO}" "$(ghapi "repos/${R}" --jq "${REPO_JQ}")"
  compare_fields "workflow token" "workflow_permissions" "${WANT_WORKFLOW}" "$(ghapi "repos/${R}/actions/permissions/workflow" --jq "${WORKFLOW_JQ}")"
  now_labels=$(gh30 label list -R "github.com/${R}" --limit 200 --json name,color,description --jq "${LABEL_JQ}") || die "cannot list labels for the read-back"
  while IFS='|' read -r name color desc; do
    case "${name}" in "" | \#*) continue ;; esac
    [ "$(label_line "${name}" "${now_labels}")" = "${name}|${color}|${desc}" ] || die "label ${name} does not read back as ${color} '${desc}'"
  done <<EOF
${LABELS}
EOF
  ok "labels: name, color and description read back as expected"
  id=$(ghapi "repos/${R}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id") || die "cannot list rulesets for the read-back"
  case "${id}" in "" | *[!0-9]*) die "ruleset ${RULESET_NAME} not found exactly once after the change" ;; esac
  compare_fields "ruleset ${RULESET_NAME}" "${RULESET_FIELDS}" "$(expected_ruleset_fields)" "$(ghapi "repos/${R}/rulesets/${id}" --jq "${RULESET_JQ}")"
  log ""
  log "Next: do the H-01 verification in docs/runbook.md (a bot-authored test PR that touches only a"
  log "high-risk path must NOT be mergeable without your approval). If it merges, re-run with"
  log "  --review-mode required-reviewers --team <slug>"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi

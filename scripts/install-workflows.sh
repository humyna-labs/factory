#!/usr/bin/env bash
# H-02: install reviewed workflow files from ci/workflows/ into .github/workflows/ (R-18).
# Run on the HOST as the human, after reviewing the files.
#   scripts/install-workflows.sh <owner/repo> [--dry-run] [--source <dir>]
# It clones the repo, copies <repo>/ci/workflows/*.yml to .github/workflows/, and opens a pull
# request for you to merge. Idempotent: does nothing if the installed files already match.
# --dry-run changes nothing; with --source <local checkout> it also shows what would change.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "${here}/lib/common.sh"

TARGET=""
SOURCE=""
usage() {
  log "usage: install-workflows.sh <owner/repo> [--dry-run] [--source <local checkout>]"
  exit 64
}
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --source) [ $# -ge 2 ] || usage; SOURCE=$2; shift ;;
    -h | --help) usage ;;
    -*) die "unknown option $1" ;;
    *) [ -z "${TARGET}" ] || usage; TARGET=$1 ;;
  esac
  shift
done
[ -n "${TARGET}" ] || usage
parse_repo "${TARGET}"
R="${REPO_OWNER}/${REPO_NAME}"
stamp=$(date -u +%Y%m%d-%H%M%S)
BRANCH="install-workflows-${stamp}"

show_plan() { # <checkout dir>
  ls "$1"/ci/workflows/*.yml >/dev/null 2>&1 || die "no ci/workflows/*.yml in $1"
  for f in "$1"/ci/workflows/*.yml; do
    dest="$1/.github/workflows/$(basename "${f}")"
    if [ -f "${dest}" ] && cmp -s "${f}" "${dest}"; then
      log "SAME $(basename "${f}") is already installed"
    else
      log "COPY ci/workflows/$(basename "${f}") -> .github/workflows/$(basename "${f}")"
    fi
  done
}

if [ "${DRY_RUN}" = 1 ]; then
  log "install-workflows (dry-run): ${R}"
  if [ -n "${SOURCE}" ]; then show_plan "${SOURCE}"; else log "DRY  would clone ${R} and copy ci/workflows/*.yml (pass --source <dir> to preview files)"; fi
  log "DRY  would commit on branch ${BRANCH}, push it and open a pull request to main"
  log "dry-run complete: nothing was changed"
  exit 0
fi

require_host
require_cmd gh
require_cmd git
with_timeout 30 gh auth status >/dev/null 2>&1 || die "gh is not logged in. Run: gh auth login"
work=$(mktemp -d)
trap 'rm -rf "${work}"' EXIT
with_timeout 180 gh repo clone "${R}" "${work}/repo" -- --quiet || die "clone of ${R} failed"
cd "${work}/repo"
show_plan .
mkdir -p .github/workflows
cp ci/workflows/*.yml .github/workflows/
git add .github/workflows
if git diff --cached --quiet; then
  ok "workflows already installed in ${R}; nothing to do"
  exit 0
fi
log "Changes to install (review them):"
git --no-pager diff --cached --stat
git --no-pager diff --cached
git checkout -q -b "${BRANCH}"
git commit -q -m "ci: install reviewed workflows from ci/workflows" -m "Installed by scripts/install-workflows.sh (H-02, R-18)."
with_timeout 120 git push -q origin "${BRANCH}" || die "push failed (does your token have the workflow scope?)"
with_timeout 60 gh pr create -R "${R}" --base main --head "${BRANCH}" \
  --title "ci: install reviewed workflows" \
  --body "Copies ci/workflows/*.yml to .github/workflows/ (H-02, R-18). Review the diff, then merge." >/dev/null || die "pull request creation failed"
url=$(with_timeout 30 gh pr view "${BRANCH}" -R "${R}" --json url --jq .url) || die "pull request not found after creation"
ok "pull request opened: ${url}"
if [ "${REPO_NAME}" = "factory" ]; then
  log "After merging: tag the merge commit as v1 so products can call gates.yml@v1 (docs/runbook.md)."
fi

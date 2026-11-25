# Shared helpers for human-run scripts (R-08, G-04, G-07).
# Must work under macOS bash 3.2: no associative arrays, no mapfile, no ${x,,}, no timeout(1).
# All messages are ASCII. Variables next to text are always written ${VAR}.

LC_ALL=C
export LC_ALL
# A4: every gh call talks to github.com, whatever the local gh configuration says.
GH_HOST=github.com
export GH_HOST
DRY_RUN=0
# A5: remote changes made so far, printed if the script fails part-way. UNKNOWN_STEPS holds
# mutations whose outcome is unknown (timed out after the request may have reached GitHub).
DONE_STEPS=""
UNKNOWN_STEPS=""

log() { printf '%s\n' "$*"; }
ok() { printf 'OK   %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*" >&2; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }

. "$(dirname "${BASH_SOURCE[0]}")/guards.sh"

# with_timeout <seconds> <command...>: run a command and kill it after <seconds>.
# Pure bash because macOS has no timeout(1). The watcher must not hold our stdout open.
with_timeout() {
  wt_secs=$1
  shift
  "$@" <&0 &
  wt_pid=$!
  ( sleep "${wt_secs}"; kill -TERM "${wt_pid}" 2>/dev/null ) >/dev/null 2>&1 &
  wt_watch=$!
  wt_rc=0
  wait "${wt_pid}" || wt_rc=$?
  kill "${wt_watch}" 2>/dev/null || true
  wait "${wt_watch}" 2>/dev/null || true
  if [ "${wt_rc}" -eq 143 ]; then warn "timed out after ${wt_secs}s: $1"; fi
  return "${wt_rc}"
}

# gh wrappers (A4): api calls name the host explicitly; other commands use GH_HOST and
# github.com/OWNER/REPO for -R.
ghapi() { with_timeout 30 gh api --hostname github.com "$@"; }
gh30() { with_timeout 30 gh "$@"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command '$1'. Install it first (macOS: brew install $1)."
}

# Location check (G-07): these scripts change GitHub settings with the human's own token and
# must run on the host, never in the factory container (whose token cannot do this anyway).
require_host() {
  if [ -f /.dockerenv ] || [ -d /workspace/factory/.git ]; then
    die "this script must run on the host, not inside the factory container. Open a host terminal and run it there."
  fi
}

# E2, Codex 1 and 5: the scripts must run from the reviewed clone: branch main tracking
# origin/main, clean, at the freshly fetched origin/main, never the bind-mounted working copy.
# The location and cleanliness checks come before the fetch, so git does not fetch in a checkout
# that is already known to be the wrong one. Usage: require_reviewed_checkout <factory root>
require_reviewed_checkout() {
  guard_reviewed_checkout "$1" || die "run the scripts from the reviewed clone (docs/runbook.md, Reviewed clone)"
  with_timeout 60 git -C "$1" fetch -q origin || die "git fetch origin in $1 failed"
  guard_at_upstream "$1" || die "run the scripts from the reviewed clone at the merged main (docs/runbook.md, Reviewed clone)"
}

# preflight_location <factory root>: dry runs check the checkout too (Codex 1); real runs also
# refuse the container first.
preflight_location() {
  [ "${DRY_RUN}" = 1 ] || require_host
  require_cmd git
  require_reviewed_checkout "$1"
}

# parse_repo <owner/repo>: sets REPO_OWNER and REPO_NAME, enforces the organization (A4).
parse_repo() {
  case "$1" in
    */*) ;;
    *) die "expected <owner/repo>, got '$(safe "$1")'" ;;
  esac
  REPO_OWNER=${1%%/*}
  REPO_NAME=${1#*/}
  guard_owner "${REPO_OWNER}" || die "owner check failed"
  guard_repo_name "${REPO_NAME}" || die "repository name check failed"
}

# done_step <text>: record a remote change that has been made (A5).
done_step() {
  DONE_STEPS="${DONE_STEPS}  - $*
"
  ok "$*"
}

# mutate <description> <seconds> <command...>: run one remote change with a timeout and record
# it (verifier P5, Codex 13). Exit 0: recorded as made. Timed out (143): recorded as "outcome
# unknown", because the request may already have reached GitHub. Other errors: not recorded
# (GitHub answered with an error). Returns the command's status.
mutate() {
  mu_desc=$1
  mu_secs=$2
  shift 2
  mu_rc=0
  with_timeout "${mu_secs}" "$@" || mu_rc=$?
  if [ "${mu_rc}" -eq 0 ]; then
    done_step "${mu_desc}"
  elif [ "${mu_rc}" -eq 143 ]; then
    # CHECK M1 begin  (verifier P5): a timed-out request may have reached GitHub.
    UNKNOWN_STEPS="${UNKNOWN_STEPS}  - ${mu_desc}: timed out after ${mu_secs}s; outcome unknown, check the remote
"
    # CHECK M1 end
    :
  fi
  return "${mu_rc}"
}

# Install with: trap on_exit_report EXIT. On a non-zero exit, say what already changed (A5).
on_exit_report() {
  oe_rc=$?
  if [ "${oe_rc}" -ne 0 ] && [ "${DRY_RUN}" = 0 ]; then
    if [ -n "${DONE_STEPS}" ]; then
      printf 'FAIL remote changes already made before the failure:\n%s' "${DONE_STEPS}" >&2
    fi
    if [ -n "${UNKNOWN_STEPS}" ]; then
      printf 'FAIL outcome unknown, check the remote before re-running:\n%s' "${UNKNOWN_STEPS}" >&2
    fi
    if [ -n "${DONE_STEPS}${UNKNOWN_STEPS}" ]; then
      printf 'FAIL every step is idempotent: fix the cause and re-run the same command.\n' >&2
    else
      printf 'FAIL no remote changes were made.\n' >&2
    fi
  fi
  return "${oe_rc}"
}

# run_or_print <description> <command...>: in dry-run mode print the command, else run it.
run_or_print() {
  rp_desc=$1
  shift
  if [ "${DRY_RUN}" = 1 ]; then
    log "DRY  ${rp_desc}: $*"
    return 0
  fi
  log "RUN  ${rp_desc}"
  "$@"
}

# Shared helpers for human-run scripts (R-08, G-04, G-07).
# Must work under macOS bash 3.2: no associative arrays, no mapfile, no ${x,,}, no timeout(1).
# All messages are ASCII. Variables next to text are always written ${VAR}.

ALLOWED_OWNER="humyna-labs"
DRY_RUN=0

log() { printf '%s\n' "$*"; }
ok() { printf 'OK   %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*" >&2; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }

# with_timeout <seconds> <command...>: run a command and kill it after <seconds>.
# Pure bash because macOS has no timeout(1). The watcher must not hold our stdout open.
with_timeout() {
  wt_secs=$1
  shift
  "$@" &
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

# parse_repo <owner/repo>: sets REPO_OWNER and REPO_NAME, enforces the organization.
parse_repo() {
  case "$1" in
    */*) ;;
    *) die "expected <owner/repo>, got '$1'" ;;
  esac
  REPO_OWNER=${1%%/*}
  REPO_NAME=${1#*/}
  case "${REPO_NAME}" in
    "" | */*) die "expected <owner/repo>, got '$1'" ;;
  esac
  [ "${REPO_OWNER}" = "${ALLOWED_OWNER}" ] || die "owner must be ${ALLOWED_OWNER}, got '${REPO_OWNER}'"
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

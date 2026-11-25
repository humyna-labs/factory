#!/usr/bin/env bash
# symlink-guard (W2-03, P-11): no symlinks in any factory or product repository. A symlink in a
# repo that is bind-mounted into the container resolves on the owner's Mac (handoff D2-W2, F4),
# so a copy or diff that follows it can leak a host file. Closed at every layer: this script
# (pre-push and CI), path-guard R10 and B7 (role sessions), scripts/lib/guards.sh G4 (human scripts).
#   symlink-guard.sh --scan-git            tracked files of the repo in the current directory
#   symlink-guard.sh --commits <rev>...    every commit of "git rev-list <rev>..."
# Exit 0 clean, 2 symlink found, 64 usage. Rules sit between "# RULE <id> begin/end".
set -u

fail() { printf 'symlink-guard: rule=%s symlink not allowed: %s\nReplace it with a regular file or a path in code; symlinks are refused at every layer (W2-03).\n' "$1" "$2" >&2; exit 2; }

case "${1:-}" in
  --scan-git)
    list=$(git ls-files -s 2>/dev/null) || { echo "symlink-guard: not a git repository" >&2; exit 64; }
    # RULE L1 begin
    hit=$(printf '%s\n' "$list" | awk '$1 == "120000"' | cut -f2 | head -n 1)
    [ -z "$hit" ] || fail L1 "$hit"
    # RULE L1 end
    ;;
  --commits)
    shift
    [ $# -gt 0 ] || { echo "usage: symlink-guard.sh --commits <rev>..." >&2; exit 64; }
    commits=$(git rev-list "$@" 2>/dev/null) || { echo "symlink-guard: bad revision range" >&2; exit 64; }
    for c in $commits; do
      # RULE L2 begin
      hit=$(git ls-tree -r "$c" | awk '$1 == "120000"' | cut -f2 | head -n 1)
      [ -z "$hit" ] || fail L2 "$hit (commit $c)"
      # RULE L2 end
    done
    ;;
  *) echo "usage: symlink-guard.sh --scan-git | --commits <rev>..." >&2; exit 64 ;;
esac
exit 0

#!/usr/bin/env bash
# stop-report (BL-02, W2-08, R-20, R-21): Claude Code Stop hook. Blocks the session from ending
# while its report (FACTORY_REPORT_PATH, set by the coordinator) is missing or has an empty
# section 5 to 8. Uses the same rules as the coordinator (coordinator/src/report.ts through
# report-cli.ts), so the hook and the post-session check cannot drift. Respects stop_hook_active
# so it blocks at most once in a row. The coordinator's own check after the session stays the authority.
set -u
input=$(cat)
here=$(cd "$(dirname "$0")" && pwd)

# RULE H3 begin  (no block loop: a session already continued by a Stop hook may end)
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = true ]; then exit 0; fi
# RULE H3 end

if [ -z "${FACTORY_REPORT_PATH:-}" ]; then
  echo "stop-report: FACTORY_REPORT_PATH is not set; the coordinator checks the report after the session" >&2
  exit 0
fi

problems=$(node "$here/../coordinator/src/report-cli.ts" "$FACTORY_REPORT_PATH" 2>&1)
rc=$?
# RULE H4 begin  (missing or incomplete report: block with the problems and the path)
if [ "$rc" -ne 0 ]; then
  reason="Your session report is not complete: ${problems}. Write it to ${FACTORY_REPORT_PATH} from docs/templates/run-report.md with sections 5 to 8 filled in (write none only if truly none), then end the session."
  jq -n --arg r "$reason" '{decision: "block", reason: $r}'
  exit 0
fi
# RULE H4 end
exit 0

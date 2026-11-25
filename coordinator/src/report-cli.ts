// report-cli <path>: exit 0 if the role report passes checkReport (R-20), else print the problems
// and exit 1. Used by hooks/stop-report.sh so the Stop hook and the coordinator share one rule set.
import { checkReport } from "./report.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: report-cli.ts <report path>");
  process.exit(64);
}
const r = checkReport(path);
if (!r.ok) {
  console.log(r.problems.join("; "));
  process.exit(1);
}

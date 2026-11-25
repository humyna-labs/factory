// W2-02: every guard in scripts/lib/guards.sh refuses what it must and allows what it must.
import { describe, expect, it } from "vitest";
import { GUARD_CASES, LIB, runGuardCase } from "./guard-cases.ts";

describe("scripts/lib/guards.sh", () => {
  it.each(GUARD_CASES.map((c) => [`${c.guard} ${c.name}`, c] as const))("%s", (_n, c) => {
    const r = runGuardCase(LIB, c);
    expect(r.decision, r.stderr).toBe(c.expect);
    if (c.expect === "refuse") expect(r.stderr).toMatch(/^REFUSED /m);
  });
  it("never prints a control character from an untrusted name", () => {
    const r = runGuardCase(LIB, { guard: "G1", name: "escape", snippet: 'guard_repo_name "$ARG"', arg: "r\u001b[2J", expect: "refuse" });
    expect(r.stderr).not.toContain("\u001b");
  });
});

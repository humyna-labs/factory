import { describe, expect, it } from "vitest";
import { runAll } from "../golden/run.ts";

describe("golden tasks (stub runner)", () => {
  it("every golden case reaches its expected end state", async () => {
    const results = await runAll();
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.problems, r.name).toEqual([]);
  });
});

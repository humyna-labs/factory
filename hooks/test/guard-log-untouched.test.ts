// The P9 check itself catches a write (G-03).
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { watchFile } from "./guard-log-untouched.ts";

describe("guard log check (verifier P9)", () => {
  it("passes when the file is unchanged and throws when a line was appended", () => {
    const f = join(mkdtempSync(join(tmpdir(), "p9-")), "guard.log");
    writeFileSync(f, "old\n");
    expect(() => watchFile(f)()).not.toThrow();
    const check = watchFile(f);
    appendFileSync(f, "2026-11-25T00:00:00Z role=builder tool=check rule=R0 target=-\n");
    expect(check).toThrow(/a test wrote to/);
  });
});

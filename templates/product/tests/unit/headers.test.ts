// Structural test (P-05): the Cloudflare Pages headers file keeps a strict CSP.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const headers = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? "";

describe("public/_headers", () => {
  it("sets a CSP for every path", () => {
    expect(headers.startsWith("/*")).toBe(true);
    expect(csp).not.toBe("");
  });
  it.each(["default-src 'none'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"])("contains %s", (d) => {
    expect(csp).toContain(d);
  });
  it("never allows unsafe-inline, unsafe-eval or wildcards (fix: hash or self-host the resource)", () => {
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });
  it.each(["X-Content-Type-Options: nosniff", "Referrer-Policy: no-referrer", "Strict-Transport-Security:"])("sets %s", (h) => {
    expect(headers).toContain(h);
  });
});

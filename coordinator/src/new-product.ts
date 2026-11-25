// Thin product generator (A4): copy templates/product and fill placeholders. No GitHub calls;
// creating the repository is human step H-04 (docs/runbook.md).
import { cpSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { factoryPath } from "./paths.ts";

export const DEFAULT_CODE_OWNER = "humyna";
export const DEFAULT_OWNER = "humyna-labs";
const SKIP = new Set(["node_modules", "dist", "test-results", "playwright-report", ".pnpm-store"]);
const TEXT = /\.(ts|tsx|js|json|md|yaml|yml|html|css|txt)$|(^|\/)(CODEOWNERS|_headers|\.gitignore)$/;

export interface NewProductOptions {
  name: string;
  out: string;
  owner?: string;
  codeOwner?: string;
  template?: string;
}

export function placeholders(o: NewProductOptions): Record<string, string> {
  return {
    "{{PRODUCT_NAME}}": o.name,
    "{{REPO}}": `${o.owner ?? DEFAULT_OWNER}/${o.name}`,
    "{{CODE_OWNER}}": o.codeOwner ?? DEFAULT_CODE_OWNER,
  };
}

function walk(dir: string, root: string, out: string[]): void {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, root, out);
    else out.push(relative(root, p));
  }
}

export function newProduct(o: NewProductOptions): string[] {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(o.name)) throw new Error(`product name must be kebab-case: ${o.name}`);
  if (!/^[A-Za-z0-9-]+$/.test(o.codeOwner ?? DEFAULT_CODE_OWNER)) throw new Error("code owner must be a GitHub handle without @");
  const template = o.template ?? factoryPath("templates", "product");
  cpSync(template, o.out, { recursive: true, filter: (src) => !SKIP.has(src.split("/").pop() ?? "") });
  const files: string[] = [];
  walk(o.out, o.out, files);
  const ph = placeholders(o);
  for (const f of files) {
    if (!TEXT.test(f)) continue;
    const p = join(o.out, f);
    const before = readFileSync(p, "utf8");
    let after = before;
    for (const [k, v] of Object.entries(ph)) after = after.split(k).join(v);
    if (after !== before) writeFileSync(p, after);
  }
  return files;
}

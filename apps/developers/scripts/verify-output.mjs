#!/usr/bin/env node
// Checks the static export in out/ before anything deploys it:
//   - no word of an API this site never publishes (the same list as lib/public-api/surfaces.ts: FORBIDDEN_IN_OUTPUT);
//   - every internal link points at a file the export has;
//   - the pages that must exist do.
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(app, "out");
const FORBIDDEN = /\bhydra\b|\bkratos\b|app-reviews|extension-hosts|-dev\.unitfield\.|api-dev\.|id-dev\.|auth-dev\.|127\.0\.0\.1:47\d\d|localhost:47\d\d/i;
const TEXT = new Set([".html", ".txt", ".js", ".json", ".css", ".xml", ""]);
const MUST_EXIST = ["index.html", "docs/index.html", "docs/quickstart/index.html", "docs/webhooks/index.html", "reference/index.html", "reference/webhook-events/index.html", "reference/storefront/listings/list-listings/index.html", "api/search", "404.html", "robots.txt", "sitemap.xml"];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const files = await walk(out).catch(() => {
  console.error("There is no out/ directory: run `next build` first.");
  process.exit(1);
});
const relative = (file) => file.slice(out.length + 1);
const known = new Set(files.map(relative));
let failures = 0;
const fail = (message) => {
  failures++;
  console.error(message);
};

for (const required of MUST_EXIST) if (!known.has(required)) fail(`Missing from the export: ${required}`);

let pages = 0;
let operations = 0;
for (const file of files) {
  const name = relative(file);
  if (!TEXT.has(extname(file))) continue;
  if ((await stat(file)).size > 8_000_000) continue;
  const text = await readFile(file, "utf8");
  const leak = FORBIDDEN.exec(text);
  if (leak) fail(`${name} mentions "${leak[0]}", which this site never publishes.`);
  if (!name.endsWith(".html")) continue;
  pages++;
  if (/^reference\/(storefront|customer|resident|apps|platform|customer-auth)\/[^/]+\/[^/]+\/index\.html$/.test(name)) operations++;

  for (const [, href] of text.matchAll(/<a [^>]*?href="([^"]+)"/g)) {
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const path = href.split("#")[0].split("?")[0];
    if (!path || path.startsWith("/_next/")) continue;
    const target = path.replace(/^\//, "").replace(/\/$/, "");
    const exists = known.has(target) || known.has(`${target}/index.html`) || (target === "" && known.has("index.html"));
    if (!exists) fail(`${name} links to ${href}, which the export does not have.`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} problem${failures === 1 ? "" : "s"} in the export.`);
  process.exit(1);
}
console.log(`Export is clean: ${pages} pages (${operations} API operations), links resolve, nothing unpublished is mentioned.`);

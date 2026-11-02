#!/usr/bin/env node
// Checks docs/**/*.mdx: every file compiles as MDX, has front matter (title, description, order), links to files and
// headings that exist, and mentions no internal host or retired product name. Also checks that the generated API
// reference is up to date.
import { compile } from "@mdx-js/mdx";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");

async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (entry.name.endsWith(".mdx")) found.push(full);
  }
  return found.sort();
}

const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

const files = await walk(docs);
const texts = new Map(await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")])));
const headings = new Map();
for (const [file, text] of texts) {
  const body = text.replace(/^```[\s\S]*?^```/gm, "");
  headings.set(file, new Set([...body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((match) => slug(match[1]))));
}

let failures = 0;
const fail = (file, message) => {
  failures++;
  console.error(`${relative(root, file)}: ${message}`);
};

function resolveTarget(from, href) {
  const base = resolve(dirname(from), href);
  for (const candidate of [base, `${base}.mdx`, join(base, "index.mdx")]) if (texts.has(candidate)) return candidate;
  return null;
}

for (const [file, text] of texts) {
  try {
    await compile(text, { remarkPlugins: [remarkFrontmatter, remarkGfm] });
  } catch (error) {
    fail(file, `does not compile as MDX: ${error.message}`);
    continue;
  }

  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  for (const key of ["title", "description", "order"]) if (!new RegExp(`^${key}:\\s*\\S`, "m").test(front)) fail(file, `front matter has no ${key}`);

  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
  // MDX reads a bare brace as a JavaScript expression, which compiles and then breaks the page that renders it.
  if (/(?<!\\)[{}]/.test(body.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""))) fail(file, "has a bare { or } outside code: put it in backticks or escape it");
  for (const [, href] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(href)) continue;
    const [path, anchor] = href.split("#");
    const target = path ? resolveTarget(file, path) : file;
    if (!target) {
      fail(file, `link to ${href} does not resolve to a file`);
      continue;
    }
    if (anchor && !headings.get(target)?.has(anchor)) fail(file, `link to ${href}: no heading "${anchor}" in ${relative(root, target)}`);
  }

  // Published text: no hosts that only exist in a development setup, and nothing under a retired name.
  if (/-dev\.unitfield\.|api-dev\.|id-dev\.|auth-dev\.|127\.0\.0\.1:47\d\d/.test(text)) fail(file, "mentions a development host");
  if (/(?<!OpenID )\bConnect\b|unitfield-connect|@unitfield\/connect|\/api\/connect/.test(text)) fail(file, 'uses the retired name "Connect"');
}

try {
  execFileSync(process.execPath, [join(root, "scripts", "generate-reference.mjs"), "--check"], { stdio: "inherit" });
} catch {
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} problem${failures === 1 ? "" : "s"} in the docs.`);
  process.exit(1);
}
console.log(`\n${files.length} MDX files compile; links, front matter and the API reference are fine.`);

#!/usr/bin/env node
// Builds a workspace package only when its dist/ is missing, so that `pnpm --filter @unitfield/react test` works on a fresh
// checkout. Never rebuilds an existing build: `pnpm build` (CI runs it first) is what keeps dist/ current, and rebuilding it
// again while sibling packages read it would race.
//
//   node scripts/ensure-built.mjs @unitfield/sdk packages/sdk
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [name, directory] = process.argv.slice(2);
if (!name || !directory) {
  console.error("usage: ensure-built.mjs <package name> <package directory>");
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(root, directory, "dist", "index.js"))) {
  console.log(`${name} has no dist/ yet: building it.`);
  execFileSync("pnpm", ["--filter", name, "run", "build"], { cwd: root, stdio: "inherit" });
}

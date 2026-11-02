#!/usr/bin/env node
// Decides, for every public package, whether the release workflow should publish it.
//
//   node scripts/release-plan.mjs           prints the plan and, in GitHub Actions, writes $GITHUB_OUTPUT
//
// A package is published when its version is not on npm yet. A package that is not on npm at all is never published by CI:
// the first publish is manual (RELEASING.md) because trusted publishing can only be configured for a package that exists.
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registryState } from "./registry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Release order: a package comes after the ones it depends on at install time. */
export const PACKAGES = [
  { output: "sdk", directory: "packages/sdk" },
  { output: "react", directory: "packages/react" },
  { output: "create", directory: "packages/create-unitfield-site" },
];

export async function plan(packages = PACKAGES, { read = (file) => readFile(file, "utf8"), state = registryState } = {}) {
  const results = [];
  for (const entry of packages) {
    const manifest = JSON.parse(await read(join(root, entry.directory, "package.json")));
    if (manifest.private) continue;
    const found = await state(manifest.name, manifest.version);
    let publish = false;
    let reason;
    if (!found.exists) reason = "the package is not on npm yet: its first publish is manual (see RELEASING.md)";
    else if (found.hasVersion) reason = "this version is already on npm";
    else {
      publish = true;
      reason = "this version is new";
    }
    results.push({ ...entry, name: manifest.name, version: manifest.version, publish, reason });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await plan();
  const lines = [];
  for (const result of results) {
    console.log(`${result.name}@${result.version}: ${result.publish ? "publish" : "skip"} (${result.reason})`);
    lines.push(`${result.output}=${result.publish}`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Release plan\n\n${results.map((r) => `- \`${r.name}@${r.version}\`: **${r.publish ? "publish" : "skip"}**, ${r.reason}`).join("\n")}\n`);
  }
}

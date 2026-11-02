#!/usr/bin/env node
// The starter pins exact versions of @unitfield/sdk and @unitfield/react. `npx create-unitfield-site` runs `npm install` against
// the registry, so those versions must exist on npm before this package is published. Run by the release workflow.
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registryState } from "../../../scripts/registry.mjs";

const template = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "template", "package.json");
const manifest = JSON.parse(await readFile(template, "utf8"));
const pins = Object.entries(manifest.dependencies ?? {}).filter(([name]) => name.startsWith("@unitfield/"));

let missing = 0;
for (const [name, version] of pins) {
  const { hasVersion } = await registryState(name, version);
  console.log(`${name}@${version}: ${hasVersion ? "on npm" : "NOT on npm"}`);
  if (!hasVersion) missing++;
}
if (missing > 0) {
  console.error("\nPublish the missing package versions first (RELEASING.md): the starter cannot install without them.");
  process.exit(1);
}

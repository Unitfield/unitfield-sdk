import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultTemplateDirectory } from "../src/scaffold.js";

const template = defaultTemplateDirectory();
const packages = path.join(import.meta.dirname, "..", "..");

async function files(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await files(full)));
    else found.push(full);
  }
  return found;
}

async function manifest(directory: string) {
  return JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as {
    version: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

describe("the template", () => {
  it("pins every dependency to an exact version", async () => {
    const { dependencies = {}, devDependencies = {} } = await manifest(template);
    const all = { ...dependencies, ...devDependencies };
    expect(Object.keys(all).length).toBeGreaterThan(5);
    for (const [name, version] of Object.entries(all)) expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("depends on published releases of the Unitfield packages, never newer than this repository has", async () => {
    const { dependencies = {} } = await manifest(template);
    const sdk = await manifest(path.join(packages, "sdk"));
    const react = await manifest(path.join(packages, "react"));
    const newer = (a: string, b: string) => {
      const [x, y] = [a, b].map((version) => version.split(".").map(Number)) as [number[], number[]];
      for (let index = 0; index < 3; index++) if (x[index] !== y[index]) return x[index]! > y[index]!;
      return false;
    };
    expect(newer(dependencies["@unitfield/sdk"]!, sdk.version)).toBe(false);
    expect(newer(dependencies["@unitfield/react"]!, react.version)).toBe(false);
    // The react package accepts the SDK version the starter pins.
    expect(dependencies["@unitfield/sdk"]).toBe(sdk.version);
  });

  it("carries no workspace protocol, internal host or credential", async () => {
    for (const file of await files(template)) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(/"(workspace|link|file):/);
      expect(text, file).not.toMatch(/-dev\.unitfield\.|api-dev\.|id-dev\.|localhost:47\d\d/);
      expect(text, file).not.toMatch(/pk_(live|test)_[A-Za-z0-9]{8,}/);
    }
  });

  it("ships the gitignore under the name npm keeps", async () => {
    const names = (await readdir(template)).sort();
    expect(names).toContain("_gitignore");
    expect(names).not.toContain(".gitignore");
    expect(names).toContain(".env.example");
  });

  it("reads every environment variable it documents", async () => {
    const example = await readFile(path.join(template, ".env.example"), "utf8");
    const documented = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]!);
    const source = (await Promise.all((await files(template)).filter((file) => /\.(ts|tsx)$/.test(file)).map((file) => readFile(file, "utf8")))).join("\n");
    for (const name of documented) expect(source, name).toContain(`process.env.${name}`);
  });
});

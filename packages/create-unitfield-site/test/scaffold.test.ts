import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScaffoldError, normalizeApiUrl, packageNameFor, scaffold, setEnvValue, validateKey } from "../src/scaffold.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "create-unitfield-site-"));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function list(directory: string, base = directory): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await list(full, base)));
    else found.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return found.sort();
}

describe("scaffold", () => {
  it("creates the starter with the package name, a private .env.local and a real .gitignore", async () => {
    const target = path.join(workspace, "Maple Rentals");
    const result = await scaffold({ directory: target, publishableKey: "pk_test_abc123", apiUrl: "http://localhost:4750" });

    expect(result).toMatchObject({ directory: target, packageName: "maple-rentals", hasKey: true });
    const files = await list(target);
    expect(files).toEqual(expect.arrayContaining(["package.json", "tsconfig.json", "next.config.ts", ".gitignore", ".env.example", ".env.local", "README.md", "app/layout.tsx", "app/page.tsx", "app/listings/page.tsx", "app/listings/[listingId]/page.tsx", "app/auth/sign-in/route.ts", "app/auth/callback/route.ts", "app/auth/sign-out/route.ts", "app/api/unitfield/webhook/route.ts", "lib/storefront.ts"]));
    expect(files).not.toContain("_gitignore");

    const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as { name: string };
    expect(manifest.name).toBe("maple-rentals");

    const env = await readFile(path.join(target, ".env.local"), "utf8");
    expect(env).toMatch(/^UNITFIELD_PUBLISHABLE_KEY=pk_test_abc123$/m);
    expect(env).toMatch(/^UNITFIELD_API_URL=http:\/\/localhost:4750$/m);
    // The rest of the example, comments included, is kept.
    expect(env).toContain("UNITFIELD_SESSION_SECRET=");
    expect((await stat(path.join(target, ".env.local"))).mode & 0o077).toBe(0);

    expect(await readFile(path.join(target, ".gitignore"), "utf8")).toContain(".env*");
  });

  it("leaves the key empty, and the production API, when none is given", async () => {
    const target = path.join(workspace, "site");
    const result = await scaffold({ directory: target });
    expect(result.hasKey).toBe(false);
    const env = await readFile(path.join(target, ".env.local"), "utf8");
    expect(env).toMatch(/^UNITFIELD_PUBLISHABLE_KEY=$/m);
    expect(env).toMatch(/^UNITFIELD_API_URL=https:\/\/api\.unitfield\.com$/m);
  });

  it("never copies a working copy's installs, build output, lockfiles or secrets", async () => {
    const template = path.join(workspace, "template");
    await mkdir(path.join(template, "node_modules", "x"), { recursive: true });
    await mkdir(path.join(template, ".next"), { recursive: true });
    await writeFile(path.join(template, "node_modules", "x", "index.js"), "");
    await writeFile(path.join(template, ".next", "BUILD_ID"), "");
    await writeFile(path.join(template, "package-lock.json"), "{}");
    await writeFile(path.join(template, ".env.local"), "UNITFIELD_PUBLISHABLE_KEY=pk_live_secret\n");
    await writeFile(path.join(template, "_gitignore"), "node_modules\n");
    await writeFile(path.join(template, ".env.example"), "UNITFIELD_PUBLISHABLE_KEY=\nUNITFIELD_API_URL=https://api.unitfield.com\n");
    await writeFile(path.join(template, "package.json"), JSON.stringify({ name: "template" }));

    const target = path.join(workspace, "out");
    await scaffold({ directory: target, templateDirectory: template });
    expect(await list(target)).toEqual([".env.example", ".env.local", ".gitignore", "package.json"]);
    expect(await readFile(path.join(target, ".env.local"), "utf8")).not.toContain("pk_live_secret");
  });

  it("accepts an empty directory, and one that only has a .git folder", async () => {
    const target = path.join(workspace, "existing");
    await mkdir(path.join(target, ".git"), { recursive: true });
    await expect(scaffold({ directory: target })).resolves.toMatchObject({ packageName: "existing" });
  });

  it("refuses a directory that already holds files, and a file", async () => {
    const target = path.join(workspace, "busy");
    await mkdir(target);
    await writeFile(path.join(target, "notes.txt"), "keep me");
    await expect(scaffold({ directory: target })).rejects.toThrow(/not empty/);
    expect(await readdir(target)).toEqual(["notes.txt"]);

    const file = path.join(workspace, "file");
    await writeFile(file, "");
    await expect(scaffold({ directory: file })).rejects.toThrow(/not a directory/);
  });

  it("rejects a bad key or API URL before it writes anything", async () => {
    const target = path.join(workspace, "never");
    await expect(scaffold({ directory: target, publishableKey: "sk_live_nope" })).rejects.toBeInstanceOf(ScaffoldError);
    await expect(scaffold({ directory: target, apiUrl: "http://api.example.com" })).rejects.toThrow(/https/);
    await expect(stat(target)).rejects.toThrow();
  });
});

describe("helpers", () => {
  it("derives a valid npm name from a directory", () => {
    expect(packageNameFor("/x/My Site")).toBe("my-site");
    expect(packageNameFor("/x/_hidden")).toBe("hidden");
    expect(packageNameFor("/x/@@@")).toBe("unitfield-site");
    expect(packageNameFor("/x/ok.name_1")).toBe("ok.name_1");
  });

  it("accepts publishable keys of both kinds only", () => {
    expect(validateKey(" pk_live_AbC123 ")).toBe("pk_live_AbC123");
    expect(() => validateKey("pk_prod_abc")).toThrow(ScaffoldError);
    expect(() => validateKey("pk_test_")).toThrow(ScaffoldError);
    expect(() => validateKey("pk_test_a b")).toThrow(ScaffoldError);
  });

  it("keeps only the origin of an API URL", () => {
    expect(normalizeApiUrl("https://api.unitfield.com/")).toBe("https://api.unitfield.com");
    expect(normalizeApiUrl("http://127.0.0.1:4750")).toBe("http://127.0.0.1:4750");
    expect(() => normalizeApiUrl("https://api.unitfield.com/api")).toThrow(/origin/);
    expect(() => normalizeApiUrl("https://user:pw@api.unitfield.com")).toThrow(/origin/);
    expect(() => normalizeApiUrl("not a url")).toThrow(/not a URL/);
  });

  it("replaces one dotenv line and nothing else", () => {
    expect(setEnvValue("# note\nA=1\nB=2\n", "B", "9")).toBe("# note\nA=1\nB=9\n");
    expect(setEnvValue("A=1\n", "A", "$&")).toBe("A=$&\n");
    expect(() => setEnvValue("A=1\n", "C", "1")).toThrow(ScaffoldError);
  });
});

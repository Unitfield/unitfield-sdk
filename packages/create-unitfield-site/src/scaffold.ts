import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_API_URL = "https://api.unitfield.com";
/** `pk_live_…` or `pk_test_…`, the shape the Unitfield SDK accepts. */
export const KEY_PATTERN = /^pk_(live|test)_[A-Za-z0-9]+$/;

export class ScaffoldError extends Error {
  override readonly name = "ScaffoldError";
}

export type ScaffoldOptions = {
  /** Where to create the site. Relative paths resolve against the current directory. */
  directory: string;
  /** Written to `.env.local` as `UNITFIELD_PUBLISHABLE_KEY`. */
  publishableKey?: string;
  /** Written as `UNITFIELD_API_URL`. Defaults to the production API. */
  apiUrl?: string;
  /** For tests. Defaults to the `template/` directory of this package. */
  templateDirectory?: string;
};

export type ScaffoldResult = {
  /** Absolute path of the new site. */
  directory: string;
  /** The `name` written to its package.json. */
  packageName: string;
  /** Whether `.env.local` has a publishable key in it. */
  hasKey: boolean;
};

// Files that belong to a working copy of the template, never to a fresh site.
const SKIP = new Set(["node_modules", ".next", "next-env.d.ts", "tsconfig.tsbuildinfo", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", ".env.local", ".DS_Store"]);
// A directory that only holds these counts as empty.
const IGNORED_WHEN_EMPTY = new Set([".git", ".DS_Store"]);

export function defaultTemplateDirectory(): string {
  // `src/` and `dist/` both sit directly under the package root, next to `template/`.
  return fileURLToPath(new URL("../template", import.meta.url));
}

/** A valid npm package name derived from a directory name. */
export function packageNameFor(directory: string): string {
  const base = path.basename(path.resolve(directory)).toLowerCase();
  const cleaned = base
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/-+$/, "")
    .slice(0, 214);
  return cleaned || "unitfield-site";
}

export function normalizeApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ScaffoldError(`The API URL "${value}" is not a URL.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new ScaffoldError("The API URL must use https (http is only accepted for localhost).");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new ScaffoldError("The API URL must be an origin such as https://api.unitfield.com, with no path, credentials, query or fragment.");
  }
  return url.origin;
}

export function validateKey(value: string): string {
  const key = value.trim();
  if (!KEY_PATTERN.test(key)) throw new ScaffoldError("A publishable key looks like pk_live_… or pk_test_… (copy it from Website > Developers in Unitfield).");
  return key;
}

async function isEmptyDirectory(directory: string): Promise<boolean> {
  const entries = await readdir(directory);
  return entries.every((entry) => IGNORED_WHEN_EMPTY.has(entry));
}

/** Replaces `NAME=…` in a dotenv text, keeping everything else (comments included) as it is. */
export function setEnvValue(text: string, name: string, value: string): string {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(text)) throw new ScaffoldError(`The template's .env.example has no ${name}.`);
  return text.replace(pattern, () => `${name}=${value}`);
}

/**
 * Copies the template into `directory` and fills in the package name and `.env.local`. It refuses a directory that
 * already holds files, and it installs nothing: the caller decides about that.
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const target = path.resolve(options.directory);
  const template = options.templateDirectory ?? defaultTemplateDirectory();
  const key = options.publishableKey ? validateKey(options.publishableKey) : undefined;
  const apiUrl = options.apiUrl ? normalizeApiUrl(options.apiUrl) : DEFAULT_API_URL;

  const existing = await stat(target).catch(() => null);
  if (existing && !existing.isDirectory()) throw new ScaffoldError(`${target} exists and is not a directory.`);
  if (existing && !(await isEmptyDirectory(target))) throw new ScaffoldError(`${target} is not empty. Choose a new directory, or empty this one first.`);
  await mkdir(target, { recursive: true });

  await cp(template, target, { recursive: true, filter: (source) => !SKIP.has(path.basename(source)) });
  // npm drops a file named .gitignore from published packages, so the template carries it as _gitignore.
  await rename(path.join(target, "_gitignore"), path.join(target, ".gitignore"));

  const packageName = packageNameFor(target);
  const manifestPath = path.join(target, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.name = packageName;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  let env = await readFile(path.join(target, ".env.example"), "utf8");
  if (key) env = setEnvValue(env, "UNITFIELD_PUBLISHABLE_KEY", key);
  env = setEnvValue(env, "UNITFIELD_API_URL", apiUrl);
  // Secrets live here once the owner fills them in, so the file is private to the user.
  await writeFile(path.join(target, ".env.local"), env, { mode: 0o600 });

  return { directory: target, packageName, hasKey: Boolean(key) };
}

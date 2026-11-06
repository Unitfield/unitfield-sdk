#!/usr/bin/env node
// Moves the sibling-repository pins in unitfield-siblings.json (see apps/developers/README.md).
//
// The Unitfield frontends depend on each other through `link:` dependencies that only resolve when the repositories sit side by
// side. CI and image builds therefore check the siblings out at the exact commits pinned in unitfield-siblings.json.
//
//   node scripts/siblings/bump.mjs                       every pin -> the head of the sibling's main branch
//   node scripts/siblings/bump.mjs unitfield-dashboard   only that sibling (a bare repository name or Owner/name)
//   node scripts/siblings/bump.mjs unitfield-dashboard=<40-character sha>   that sibling -> exactly this commit
//   node scripts/siblings/bump.mjs --sha <40-character sha>                 the only pinned sibling -> exactly this commit
//   node scripts/siblings/bump.mjs --ref <branch>        take the head of another branch instead of main
//   node scripts/siblings/bump.mjs --dry-run             show what would change; write nothing
//   node scripts/siblings/bump.mjs --check               offline: fail unless every pin is a full 40-character lowercase sha
//   node scripts/siblings/bump.mjs --check --remote      also fail unless every pinned commit exists on the remote
//
// Network use is limited to `git ls-remote` and `gh api`, with the credentials already on this machine. The same file is kept in every
// repository that takes sibling pins; it reads the pins from <repository root>/unitfield-siblings.json and carries no repository names.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PIN_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../unitfield-siblings.json");
const FULL_SHA = /^[0-9a-f]{40}$/;
const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEFAULT_REF = "main";
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function fail(message) {
  console.error(`siblings: ${message}`);
  process.exit(1);
}

function readPins() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(PIN_FILE, "utf8"));
  } catch (error) {
    fail(`cannot read ${PIN_FILE}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("unitfield-siblings.json must be an object of Owner/repository -> commit sha");
  for (const slug of Object.keys(parsed)) if (!SLUG.test(slug)) fail(`"${slug}" is not an Owner/repository name`);
  return parsed;
}

function writePins(pins) {
  writeFileSync(PIN_FILE, `${JSON.stringify(pins, null, 2)}\n`);
}

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
}

const remoteUrl = (slug) => `https://github.com/${slug}.git`;

/** The sha a branch points to on the remote. Throws when the repository or branch cannot be read. */
function remoteHead(slug, ref) {
  let out;
  try {
    out = run("git", ["ls-remote", "--exit-code", remoteUrl(slug), `refs/heads/${ref}`]);
  } catch (error) {
    const reason = String(error.stderr || error.message).trim().split("\n").pop();
    throw new Error(`cannot read refs/heads/${ref} of ${slug} (${reason}). Does the repository exist, and is this machine signed in to GitHub with access to it?`);
  }
  const sha = out.split(/\s+/)[0];
  if (!FULL_SHA.test(sha)) throw new Error(`unexpected ls-remote answer for ${slug}: ${out.trim()}`);
  return sha;
}

/** True when the commit exists on the remote: a branch, tag or pull-request head, or any commit the API can resolve. Throws when the remote cannot be read. */
function commitExists(slug, sha) {
  try {
    if (run("git", ["ls-remote", remoteUrl(slug)]).split("\n").some((line) => line.startsWith(`${sha}\t`))) return true;
  } catch (error) {
    throw new Error(`cannot list ${slug} (${String(error.stderr || error.message).trim().split("\n").pop()}). Does the repository exist, and is this machine signed in to GitHub with access to it?`);
  }
  try {
    return run("gh", ["api", `repos/${slug}/commits/${sha}`, "--jq", ".sha"]).trim() === sha;
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${sha} is not the head of any ${slug} ref, and the gh CLI is not installed to look further`);
    return false;
  }
}

/** Resolves a bare repository name or Owner/name against the pinned siblings. */
function resolveName(pins, name) {
  const slugs = Object.keys(pins);
  const match = slugs.filter((slug) => slug === name || slug.split("/")[1] === name);
  if (match.length !== 1) fail(`"${name}" is not one of the pinned siblings (${slugs.join(", ") || "none"}); add it to unitfield-siblings.json first`);
  return match[0];
}

function check(pins, remote) {
  let bad = 0;
  for (const [slug, sha] of Object.entries(pins)) {
    if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
      console.error(`siblings: ${slug} is pinned to ${JSON.stringify(sha)}; a pin must be a full 40-character lowercase commit sha`);
      bad += 1;
    } else if (remote) {
      try {
        if (!commitExists(slug, sha)) {
          console.error(`siblings: ${slug}@${sha} does not exist on the remote`);
          bad += 1;
        }
      } catch (error) {
        console.error(`siblings: ${error.message}`);
        bad += 1;
      }
    }
  }
  if (bad) process.exit(1);
  console.log(`siblings: ${Object.keys(pins).length} pin(s) ok${remote ? " (and present on the remote)" : ""}`);
}

const args = process.argv.slice(2);
const flags = { check: false, remote: false, dryRun: false, ref: DEFAULT_REF, sha: undefined };
const targets = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--") continue; // pnpm forwards the separator in `pnpm siblings:bump -- --dry-run`
  else if (arg === "--check") flags.check = true;
  else if (arg === "--remote") flags.remote = true;
  else if (arg === "--dry-run") flags.dryRun = true;
  else if (arg === "--ref") flags.ref = args[++i] ?? fail("--ref needs a branch name");
  else if (arg === "--sha") flags.sha = args[++i] ?? fail("--sha needs a commit sha");
  else if (arg === "--help" || arg === "-h") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((line) => line.startsWith("//")).map((line) => line.slice(3)).join("\n"));
    process.exit(0);
  } else if (arg.startsWith("-")) fail(`unknown option ${arg}`);
  else targets.push(arg);
}

const pins = readPins();

if (flags.check) {
  if (flags.sha || targets.length || flags.dryRun) fail("--check takes only --remote");
  check(pins, flags.remote);
  process.exit(0);
}
if (flags.remote) fail("--remote belongs to --check");

// What to move: slug -> the sha to pin, or null for "the head of --ref".
const wanted = new Map();
if (flags.sha !== undefined) {
  const slugs = Object.keys(pins);
  if (slugs.length !== 1 || targets.length) fail("--sha needs exactly one pinned sibling; name the sibling as <name>=<sha> instead");
  wanted.set(slugs[0], flags.sha);
} else if (targets.length === 0) {
  for (const slug of Object.keys(pins)) wanted.set(slug, null);
} else {
  for (const target of targets) {
    const [name, sha = null] = target.split("=");
    wanted.set(resolveName(pins, name), sha);
  }
}
if (wanted.size === 0) fail("unitfield-siblings.json pins no sibling");

// One unreachable sibling must not hide the others: move what can be moved, then report the rest and exit non-zero.
const next = { ...pins };
const failures = [];
for (const [slug, explicit] of wanted) {
  try {
    let sha;
    if (explicit === null) {
      sha = remoteHead(slug, flags.ref);
    } else {
      if (!FULL_SHA.test(explicit)) throw new Error(`${explicit} is not a full 40-character lowercase commit sha`);
      if (!commitExists(slug, explicit)) throw new Error(`${slug}@${explicit} does not exist on the remote`);
      sha = explicit;
    }
    next[slug] = sha;
    const old = pins[slug];
    console.log(`${slug}: ${old === sha ? `${sha.slice(0, 12)} (unchanged)` : `${String(old).slice(0, 12)} -> ${sha.slice(0, 12)}`}`);
  } catch (error) {
    failures.push(`${slug}: ${error.message}`);
  }
}

const changed = Object.keys(next).some((slug) => next[slug] !== pins[slug]);
if (flags.dryRun) console.log("dry run: nothing written");
else if (changed) {
  writePins(next);
  console.log("unitfield-siblings.json updated. Commit it in the same pull request as the change that needs the new sibling commit.");
}
if (failures.length) {
  for (const failure of failures) console.error(`siblings: ${failure}`);
  process.exit(1);
}

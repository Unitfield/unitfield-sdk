import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPackageManager, packageVersion, run, type RunEnvironment } from "../src/run.js";

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "create-unitfield-site-run-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function environment(overrides: Partial<RunEnvironment> & { answers?: string[] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const installs: { packageManager: string; directory: string }[] = [];
  const questions: string[] = [];
  const answers = [...(overrides.answers ?? [])];
  const io: RunEnvironment = {
    cwd,
    env: {},
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    interactive: false,
    ask: async (question) => {
      questions.push(question);
      return answers.shift() ?? "";
    },
    install: async (packageManager, directory) => {
      installs.push({ packageManager, directory });
      return 0;
    },
    ...overrides,
  };
  return { io, out: () => out.join(""), err: () => err.join(""), installs, questions };
}

describe("run", () => {
  it("scaffolds, installs with the package manager that ran it, and says what to do next", async () => {
    const env = environment({ env: { npm_config_user_agent: "pnpm/11.11.0 npm/? node/v24.14.0 darwin arm64" } });
    const code = await run(["my-site", "--key", "pk_test_abc123", "--yes"], env.io);
    expect(code).toBe(0);
    expect(env.installs).toEqual([{ packageManager: "pnpm", directory: path.join(cwd, "my-site") }]);
    expect(env.out()).toContain("cd my-site");
    expect(env.out()).toContain("pnpm dev");
    expect(env.out()).not.toContain("add your publishable key");
    expect(await readFile(path.join(cwd, "my-site", ".env.local"), "utf8")).toContain("UNITFIELD_PUBLISHABLE_KEY=pk_test_abc123");
  });

  it("with --no-install, creates the files and tells the user to install", async () => {
    const env = environment();
    expect(await run(["site", "--no-install", "--yes"], env.io)).toBe(0);
    expect(env.installs).toEqual([]);
    expect(env.out()).toContain("npm install");
    expect(env.out()).toContain("add your publishable key to .env.local");
    expect(env.out()).toContain("npm run dev");
  });

  it("asks for the directory and the key on a terminal, and takes Enter as 'later'", async () => {
    const env = environment({ interactive: true, answers: ["asked-site", ""] });
    expect(await run(["--no-install"], env.io)).toBe(0);
    expect(env.questions).toHaveLength(2);
    await expect(stat(path.join(cwd, "asked-site", "package.json"))).resolves.toBeTruthy();
    expect(await readFile(path.join(cwd, "asked-site", ".env.local"), "utf8")).toMatch(/^UNITFIELD_PUBLISHABLE_KEY=$/m);
  });

  it("asks nothing with --yes, and needs a directory when nobody can answer", async () => {
    const quiet = environment({ interactive: true });
    expect(await run(["site", "--yes", "--no-install"], quiet.io)).toBe(0);
    expect(quiet.questions).toEqual([]);

    const headless = environment();
    expect(await run([], headless.io)).toBe(2);
    expect(headless.err()).toContain("Say where to create the site");
  });

  it("reports a bad key, a bad option and a busy directory without a stack trace", async () => {
    const badKey = environment();
    expect(await run(["a", "--key", "nope", "--yes", "--no-install"], badKey.io)).toBe(1);
    expect(badKey.err()).toContain("pk_live_");
    await expect(stat(path.join(cwd, "a"))).rejects.toThrow();

    const badOption = environment();
    expect(await run(["--wat"], badOption.io)).toBe(2);

    const first = environment();
    await run(["b", "--yes", "--no-install"], first.io);
    const second = environment();
    expect(await run(["b", "--yes", "--no-install"], second.io)).toBe(1);
    expect(second.err()).toContain("not empty");

    const badManager = environment();
    expect(await run(["c", "--package-manager", "make", "--yes"], badManager.io)).toBe(2);
  });

  it("returns 1, with the manual command, when the install fails", async () => {
    const env = environment({ install: async () => 7 });
    expect(await run(["site", "--yes"], env.io)).toBe(1);
    expect(env.err()).toContain('run "npm install"');
    await expect(stat(path.join(cwd, "site", "package.json"))).resolves.toBeTruthy();
  });

  it("prints help and the version", async () => {
    const help = environment();
    expect(await run(["--help"], help.io)).toBe(0);
    expect(help.out()).toContain("npx create-unitfield-site [directory]");
    const version = environment();
    expect(await run(["-v"], version.io)).toBe(0);
    expect(version.out().trim()).toBe(packageVersion());
  });

  it("detects the package manager from the user agent", () => {
    expect(detectPackageManager({ npm_config_user_agent: "yarn/4.0.0 npm/? node/v24" })).toBe("yarn");
    expect(detectPackageManager({ npm_config_user_agent: "bun/1.2 npm/? node/v24" })).toBe("bun");
    expect(detectPackageManager({})).toBe("npm");
  });
});

describe("the built command", () => {
  it("runs as a script and prints its version", () => {
    const binary = path.join(import.meta.dirname, "..", "dist", "cli.js");
    expect(execFileSync(process.execPath, [binary, "--version"], { encoding: "utf8" }).trim()).toBe(packageVersion());
  });
});

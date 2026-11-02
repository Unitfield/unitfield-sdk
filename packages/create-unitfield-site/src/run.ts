import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { DEFAULT_API_URL, ScaffoldError, scaffold, validateKey } from "./scaffold.js";

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const HELP = `create-unitfield-site: a Next.js site on the Unitfield storefront API

Usage
  npx create-unitfield-site [directory] [options]

Options
  --key <pk_…>               Publishable key to put in .env.local (Website > Developers in Unitfield)
  --api-url <url>            Unitfield API origin (default ${DEFAULT_API_URL})
  --package-manager <name>   npm, pnpm, yarn or bun (default: the one that ran this command)
  --no-install               Create the files only
  -y, --yes                  Never ask questions
  -v, --version              Print the version
  -h, --help                 Print this help
`;

export type RunEnvironment = {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Whether questions can be asked. */
  interactive: boolean;
  /** Asks one question; only called when `interactive`. */
  ask: (question: string) => Promise<string>;
  /** Runs the install. Resolves with the exit code. */
  install: (packageManager: PackageManager, directory: string) => Promise<number>;
};

export function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return manifest.version;
}

export function detectPackageManager(env: Record<string, string | undefined>): PackageManager {
  const agent = env.npm_config_user_agent ?? "";
  return PACKAGE_MANAGERS.find((name) => agent.startsWith(`${name}/`)) ?? "npm";
}

function runScript(packageManager: PackageManager, script: string): string {
  return packageManager === "npm" ? `npm run ${script}` : `${packageManager} ${script}`;
}

/** The command line. Returns the process exit code and never throws for user mistakes. */
export async function run(argv: string[], io: RunEnvironment): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        key: { type: "string" },
        "api-url": { type: "string" },
        "package-manager": { type: "string" },
        "no-install": { type: "boolean", default: false },
        yes: { type: "boolean", short: "y", default: false },
        version: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${packageVersion()}\n`);
    return 0;
  }
  if (positionals.length > 1) {
    io.stderr(`Expected one directory, got ${positionals.length}.\n\n${HELP}`);
    return 2;
  }

  const packageManager = values["package-manager"] ?? detectPackageManager(io.env);
  if (!PACKAGE_MANAGERS.includes(packageManager as PackageManager)) {
    io.stderr(`Unknown package manager "${packageManager}". Use one of: ${PACKAGE_MANAGERS.join(", ")}.\n`);
    return 2;
  }

  const askQuestions = io.interactive && !values.yes;
  try {
    let directory = positionals[0];
    if (!directory) {
      if (!askQuestions) {
        io.stderr(`Say where to create the site, for example: npx create-unitfield-site my-site\n`);
        return 2;
      }
      directory = (await io.ask("Where should the site go? (my-unitfield-site) ")).trim() || "my-unitfield-site";
    }

    let publishableKey = values.key;
    if (publishableKey === undefined && askQuestions) {
      const answer = (await io.ask("Publishable key, pk_live_… or pk_test_… (Enter to add it later) ")).trim();
      if (answer) publishableKey = answer;
    }
    if (publishableKey !== undefined) validateKey(publishableKey);

    const result = await scaffold({
      directory: path.resolve(io.cwd, directory),
      ...(publishableKey !== undefined ? { publishableKey } : {}),
      ...(values["api-url"] !== undefined ? { apiUrl: values["api-url"] } : {}),
    });
    const relative = path.relative(io.cwd, result.directory) || ".";
    io.stdout(`\nCreated ${result.packageName} in ${result.directory}\n`);

    let installed = false;
    if (!values["no-install"]) {
      io.stdout(`\nInstalling dependencies with ${packageManager}…\n`);
      const code = await io.install(packageManager as PackageManager, result.directory);
      if (code !== 0) {
        io.stderr(`\nThe install failed (exit code ${code}). The site was created; run "${packageManager} install" in ${relative} when you are ready.\n`);
        return 1;
      }
      installed = true;
    }

    const steps = [
      ...(relative === "." ? [] : [`cd ${relative}`]),
      ...(installed ? [] : [`${packageManager} install`]),
      ...(result.hasKey ? [] : ["add your publishable key to .env.local (UNITFIELD_PUBLISHABLE_KEY)"]),
      runScript(packageManager as PackageManager, "dev"),
    ];
    io.stdout(`\nNext:\n${steps.map((step) => `  ${step}`).join("\n")}\n\nRead README.md in the new site for sign-in, inquiries and webhooks.\n`);
    return 0;
  } catch (error) {
    if (error instanceof ScaffoldError) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

/** The real environment: the terminal, and a child process for the install. */
export function processEnvironment(): RunEnvironment {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    async ask(question) {
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await readline.question(question);
      } finally {
        readline.close();
      }
    },
    install: (packageManager, directory) =>
      new Promise((resolve) => {
        const child = spawn(packageManager, ["install"], { cwd: directory, stdio: "inherit", shell: process.platform === "win32" });
        child.on("error", () => resolve(1));
        child.on("close", (code) => resolve(code ?? 1));
      }),
  };
}

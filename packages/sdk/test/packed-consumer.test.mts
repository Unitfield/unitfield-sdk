import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDirectory = join(packageDirectory, "test", "packed-consumer");

test("imports both ESM entry points from the packed package", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "unitfield-sdk-"));
  try {
    execFileSync(
      "pnpm",
      ["pack", "--pack-destination", temporaryDirectory],
      { cwd: packageDirectory, stdio: "pipe" },
    );
    const archiveName = readdirSync(temporaryDirectory).find((name) => name.endsWith(".tgz"));
    if (!archiveName) throw new Error("pnpm pack did not create an archive.");

    const consumerDirectory = join(temporaryDirectory, "consumer");
    execFileSync(
      "tar",
      ["-xzf", join(temporaryDirectory, archiveName), "-C", temporaryDirectory],
      { stdio: "pipe" },
    );
    cpSync(join(temporaryDirectory, "package"), join(consumerDirectory, "node_modules", "@unitfield", "sdk"), {
      recursive: true,
    });
    cpSync(fixtureDirectory, join(consumerDirectory, "packed-consumer"), { recursive: true });

    execFileSync(process.execPath, [join(consumerDirectory, "packed-consumer", "consumer.mjs")], {
      cwd: consumerDirectory,
      stdio: "pipe",
    });
    execFileSync(
      join(packageDirectory, "node_modules", ".bin", "tsc"),
      ["--noEmit", "-p", join(consumerDirectory, "packed-consumer", "tsconfig.json")],
      { cwd: consumerDirectory, stdio: "pipe" },
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

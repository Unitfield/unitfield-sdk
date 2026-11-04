import { createMDX } from "fumadocs-mdx/next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// The guides are read in place from docs/*.mdx at the repository root, outside this app, so the bundler root is the repository root.
const repositoryRoot = resolve(here, "../..");

/** @type {import("next").NextConfig} */
const config = {
  output: "export",
  // /docs/quickstart/index.html: works on any static host without rewrite rules.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: { root: repositoryRoot },
  outputFileTracingRoot: repositoryRoot,
};

export default createMDX()(config);

import { createMDX } from "fumadocs-mdx/next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// The guides are read in place from docs/*.mdx at the repository root, outside this app. The icons come from @unitfield/ui, which is
// linked from the private dashboard repository checked out next to this one (../../../unitfield-dashboard). The bundler root must
// hold both, so it is the folder that contains the two repositories.
const workspaceRoot = resolve(here, "../../..");

/** @type {import("next").NextConfig} */
const config = {
  output: "export",
  // /docs/quickstart/index.html: works on any static host without rewrite rules.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // @unitfield/ui is TypeScript source.
  transpilePackages: ["@unitfield/ui"],
  turbopack: {
    root: workspaceRoot,
    resolveAlias: {
      // The linked package would otherwise resolve its own React from the dashboard's tree: one React in the page.
      react: "./node_modules/react",
      "react-dom": "./node_modules/react-dom",
      // Fumadocs draws its own icons with this package, deep inside its components. They resolve to lib/fumadocs-icons.tsx instead, so
      // the site draws Unitfield icons only and the package is not in the bundle. This is the one line of the app that names it.
      "lucide-react": "./lib/fumadocs-icons.tsx",
    },
  },
  outputFileTracingRoot: workspaceRoot,
};

export default createMDX()(config);

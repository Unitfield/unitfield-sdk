import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins/rehype-code";
import { defineConfig } from "fumadocs-mdx/config";
import { unitfieldCodeThemes } from "./lib/code-theme";

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: { ...rehypeCodeDefaultOptions, themes: unitfieldCodeThemes },
  },
});

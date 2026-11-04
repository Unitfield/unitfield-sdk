import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { guideSource } from "@/lib/source";
import { Scopes } from "./scopes";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultMdxComponents, Scopes, ...components };
}

/**
 * The guides are plain files in docs/ and link to each other the way files do: `./quickstart`, `./index#known-gaps`, `./reference`.
 * On the site those are /docs/quickstart, /docs#known-gaps and /reference. A relative link that matches no guide fails the build.
 */
export function resolveGuideHref(href: string | undefined): string | undefined {
  if (!href || /^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return href;
  const [path = "", hash] = href.split("#");
  const name = path.replace(/^\.\//, "").replace(/\/$/, "").replace(/\.mdx$/, "");
  const anchor = hash ? `#${hash}` : "";
  if (name === "reference" || name.startsWith("reference/")) return `/reference${anchor}`;
  const target = guideSource.getPages().find((page) => page.path === `${name}.mdx`);
  if (!target) throw new Error(`A guide links to "${href}", which is no guide of this site.`);
  return `${target.url}${anchor}`;
}

/** MDX components for a guide: the defaults, with relative links resolved. */
export function getGuideComponents(): MDXComponents {
  const Link = defaultMdxComponents.a;
  return getMDXComponents({
    a: (props: ComponentProps<"a">) => <Link {...props} href={resolveGuideHref(props.href)} />,
  });
}

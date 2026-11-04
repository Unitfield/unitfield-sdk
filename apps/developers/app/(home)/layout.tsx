import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";
import { homeTree } from "@/lib/home-tree";
import { baseOptions } from "@/lib/layout.shared";

/** The home page is a page of the docs: the same layout as the guides and the reference, with the whole site in its sidebar. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={homeTree()} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}

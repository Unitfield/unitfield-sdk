import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";
import { baseOptions } from "@/lib/layout.shared";
import { referenceLoader } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={referenceLoader.getPageTree()} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}

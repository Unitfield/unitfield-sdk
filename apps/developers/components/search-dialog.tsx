"use client";
import { lazy, Suspense } from "react";
import type { SharedProps } from "fumadocs-ui/components/dialog/search";

const Dialog = lazy(() => import("./search-dialog-impl"));

/** The search dialog, loaded the first time it opens: the index and the engine are not part of a page's first load. */
export default function SearchDialog(props: SharedProps) {
  return (
    <Suspense fallback={null}>
      <Dialog {...props} />
    </Suspense>
  );
}

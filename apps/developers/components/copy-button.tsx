"use client";
import { CheckIcon, CopyIcon } from "@unitfield/ui/icons";
import { useState } from "react";

/** Copies `text`, and says so for a moment. Falls back quietly when the clipboard is not available. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="uf-copy"
      aria-label={copied ? "Copied" : label}
      data-copied={copied}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* no clipboard: the text stays selectable */
        }
      }}
    >
      {copied ? <CheckIcon aria-hidden size={15} /> : <CopyIcon aria-hidden size={15} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

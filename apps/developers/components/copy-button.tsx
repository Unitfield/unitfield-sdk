"use client";
import { Check, Copy } from "lucide-react";
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
      {copied ? <Check aria-hidden size={15} /> : <Copy aria-hidden size={15} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

"use client";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface TryItEntry {
  id: string;
  method: string;
  label: string;
  name: string;
  description: string;
  href: string;
  status: string;
  /** Highlighted on the server: the page has no network and no highlighter in the browser. */
  curl: ReactNode;
  sdk: ReactNode;
  response: ReactNode;
}

type Format = "curl" | "sdk";
const FORMATS: { id: Format; label: string }[] = [
  { id: "curl", label: "curl" },
  { id: "sdk", label: "SDK" },
];

/** The first sentence of an operation's description, with its `code` spans set as code. */
function firstSentence(text: string): ReactNode {
  const end = text.search(/\.(\s|$)/);
  const sentence = end === -1 ? text : text.slice(0, end + 1);
  return sentence.split("`").map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

/** Moves a roving tab selection with the arrow keys, Home and End. Returns the index to select, or null for any other key. */
function nextIndex(event: KeyboardEvent, current: number, count: number, vertical: boolean): number | null {
  const previous = vertical ? "ArrowUp" : "ArrowLeft";
  const next = vertical ? "ArrowDown" : "ArrowRight";
  if (event.key === next) return (current + 1) % count;
  if (event.key === previous) return (current - 1 + count) % count;
  if (event.key === "Home") return 0;
  if (event.key === "End") return count - 1;
  return null;
}

/**
 * Pick an operation on the left, read its request and an example response on the right. Everything is rendered by the server and
 * shown or hidden here: nothing is fetched, and the page works as a read-through without scripts.
 */
export function TryItOut({ entries, initial }: { entries: TryItEntry[]; initial: string }) {
  const [active, setActive] = useState(Math.max(0, entries.findIndex((entry) => entry.id === initial)));
  const [format, setFormat] = useState<Format>("curl");
  const opButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const formatButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const entry = entries[active]!;

  return (
    <div className="uf-try">
      <div className="uf-try-side">
        <div
          className="uf-try-ops"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Storefront API operations"
          onKeyDown={(event) => {
            const index = nextIndex(event, active, entries.length, true);
            if (index === null) return;
            event.preventDefault();
            setActive(index);
            opButtons.current[index]?.focus();
          }}
        >
          {entries.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                opButtons.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`try-op-${item.id}`}
              aria-selected={index === active}
              aria-controls="try-panel"
              tabIndex={index === active ? 0 : -1}
              className="uf-try-op"
              onClick={() => setActive(index)}
            >
              <span className="uf-try-method">{item.method}</span>
              <span className="uf-try-path">{item.label}</span>
            </button>
          ))}
        </div>
        <p className="uf-try-note" aria-live="polite">
          {firstSentence(entry.description)}
        </p>
      </div>

      <div className="uf-try-panel" id="try-panel" role="tabpanel" aria-labelledby={`try-op-${entry.id}`}>
        <div className="uf-try-top">
          <div
            className="uf-seg"
            role="tablist"
            aria-label="Request format"
            onKeyDown={(event) => {
              const index = nextIndex(event, FORMATS.findIndex((item) => item.id === format), FORMATS.length, false);
              if (index === null) return;
              event.preventDefault();
              setFormat(FORMATS[index]!.id);
              formatButtons.current[index]?.focus();
            }}
          >
            {FORMATS.map((item, index) => (
              <button
                key={item.id}
                ref={(node) => {
                  formatButtons.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`try-format-${item.id}`}
                aria-selected={item.id === format}
                aria-controls="try-request"
                tabIndex={item.id === format ? 0 : -1}
                className="uf-seg-tab"
                onClick={() => setFormat(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Link href={entry.href} className="uf-link">
            Open in the reference
          </Link>
        </div>

        <div className="uf-try-request" id="try-request" role="tabpanel" aria-labelledby={`try-format-${format}`} tabIndex={0}>
          {entries.map((item) => (
            <div key={`curl-${item.id}`} hidden={item.id !== entry.id || format !== "curl"}>
              {item.curl}
            </div>
          ))}
          {entries.map((item) => (
            <div key={`sdk-${item.id}`} hidden={item.id !== entry.id || format !== "sdk"}>
              {item.sdk}
            </div>
          ))}
        </div>

        <div className="uf-try-response">
          <p className="uf-try-status">
            <span>Example response</span>
            <span className="uf-try-code">{entry.status}</span>
          </p>
          <div className="uf-try-body" tabIndex={0} role="region" aria-label={`Example response of ${entry.name}`}>
            {entries.map((item) => (
              <div key={item.id} hidden={item.id !== entry.id}>
                {item.response}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

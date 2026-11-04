import { CopyButton } from "./copy-button";

/** A command to run, with a copy button. A plain block: the text is real text, so it can also be selected. */
export function Command({ command, hint }: { command: string; hint?: string }) {
  return (
    <div className="uf-command">
      <span className="uf-command-prompt" aria-hidden>
        $
      </span>
      <code>{command}</code>
      {hint ? <span className="uf-command-hint">{hint}</span> : null}
      <CopyButton text={command} />
    </div>
  );
}

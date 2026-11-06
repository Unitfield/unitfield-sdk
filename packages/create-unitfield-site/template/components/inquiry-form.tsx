"use client";

import { useUnitfield } from "@unitfield/react";
import { isUnitfieldError, RateLimitError, ValidationError } from "@unitfield/sdk";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Turnstile } from "./turnstile";

// How the form gets the anti-bot token the API requires (the mode is chosen in lib/inquiry.ts):
// - "widget": the Cloudflare Turnstile widget Unitfield made for your site runs (its site key comes from `site.turnstileSiteKey`).
// - "development": the API sent no site key, and this is a development build. A placeholder token is sent, which only works
//   against an API that has Turnstile switched off. Production builds never send it.
// - "off": no way to get a token, so the form is replaced by the contact details.
export type InquiryMode = { kind: "widget"; siteKey: string } | { kind: "development" } | { kind: "off" };

type Status = { state: "idle" } | { state: "sending" } | { state: "sent" } | { state: "error"; message: string };

const PLACEHOLDER_TOKEN = "turnstile-not-configured";

// Text-message opt-in. The consent text comes from the API (through app/api/sms-consent), never from this file; if it is not there, the
// checkbox stays hidden and the form works as before. Only US and Canadian numbers can be texted.
type Disclosure = { version: string; text: string; links: { label: string; url: string }[] };
const SMS_ROUTE = "/api/sms-consent";

function isUsPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national);
}

export function InquiryForm({ mode, listingPublicId, listingTitle }: { mode: InquiryMode; listingPublicId?: string; listingTitle?: string }) {
  const { client } = useUnitfield();
  const id = useId();
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [kind, setKind] = useState<"contact" | "tour">(listingPublicId ? "tour" : "contact");
  const [token, setToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(0);
  const [phone, setPhone] = useState("");
  const [disclosure, setDisclosure] = useState<Disclosure | null | undefined>(undefined);
  const [textMe, setTextMe] = useState(false);
  const canText = isUsPhone(phone);

  useEffect(() => {
    if (!canText || disclosure !== undefined) return;
    let cancelled = false;
    fetch(SMS_ROUTE, { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? (response.json() as Promise<Disclosure>) : null))
      .then((body) => !cancelled && setDisclosure(body && body.version && body.text ? body : null))
      .catch(() => !cancelled && setDisclosure(null));
    return () => {
      cancelled = true;
    };
  }, [canText, disclosure]);
  const optIn = canText && disclosure ? disclosure : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const turnstileToken = mode.kind === "widget" ? token : PLACEHOLDER_TOKEN;
    if (!turnstileToken) {
      setStatus({ state: "error", message: "Please complete the check below, then send again." });
      return;
    }
    const preferred = text("preferred");
    setStatus({ state: "sending" });
    try {
      await client.inquiries.create({
        kind,
        name: text("name"),
        email: text("email"),
        ...(text("phone") ? { phone: text("phone") } : {}),
        ...(text("message") ? { message: text("message") } : {}),
        ...(listingPublicId ? { listingPublicId } : {}),
        ...(kind === "tour" && preferred ? { preferredTimes: [preferred] } : {}),
        turnstileToken,
      });
      if (optIn && textMe && text("phone")) {
        // The opt-in is its own record: if it fails the inquiry still stands.
        await fetch(SMS_ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone: text("phone"), disclosureVersion: optIn.version, email: text("email") }),
        }).catch((error: unknown) => console.error("sms consent failed", error));
      }
      setStatus({ state: "sent" });
    } catch (error) {
      // The API answers 202 for every accepted request, so an error here means the request itself was refused.
      setStatus({
        state: "error",
        message:
          error instanceof RateLimitError
            ? "Too many requests from this connection. Please try again later."
            : error instanceof ValidationError || error instanceof TypeError
              ? "Please check your name and email, then try again."
              : isUnitfieldError(error)
                ? "We could not send your message. Please try again, or contact us directly."
                : "Something went wrong. Please try again.",
      });
      setToken(null);
      setChallenge((value) => value + 1);
    }
  }

  if (status.state === "sent") {
    return (
      <p role="status" className="notice">
        Thanks. Your message is on its way to us, and we will get back to you at the email you gave.
      </p>
    );
  }

  const sending = status.state === "sending";
  return (
    <form onSubmit={submit} className="form" aria-describedby={status.state === "error" ? `${id}-error` : undefined}>
      {listingTitle ? <p className="muted">About {listingTitle}</p> : null}
      <fieldset className="choice">
        <legend>What do you need?</legend>
        <label>
          <input type="radio" name="kind" value="contact" checked={kind === "contact"} onChange={() => setKind("contact")} /> Ask a question
        </label>
        <label>
          <input type="radio" name="kind" value="tour" checked={kind === "tour"} onChange={() => setKind("tour")} /> Request a tour
        </label>
      </fieldset>
      <label htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} name="name" autoComplete="name" required maxLength={120} />
      <label htmlFor={`${id}-email`}>Email</label>
      <input id={`${id}-email`} name="email" type="email" autoComplete="email" required maxLength={254} />
      <label htmlFor={`${id}-phone`}>Phone (optional)</label>
      <input id={`${id}-phone`} name="phone" type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} />
      {optIn ? (
        <div className="sms-optin">
          <input id={`${id}-sms`} type="checkbox" checked={textMe} onChange={(event) => setTextMe(event.target.checked)} />
          <label htmlFor={`${id}-sms`}>{optIn.text}</label>
          {optIn.links.length ? (
            <p>
              {optIn.links.map((link, index) => (
                <span key={link.url}>
                  {index ? " · " : null}
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.label}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
      {kind === "tour" ? (
        <>
          <label htmlFor={`${id}-preferred`}>Preferred time (optional)</label>
          <input id={`${id}-preferred`} name="preferred" type="datetime-local" />
        </>
      ) : null}
      <label htmlFor={`${id}-message`}>Message (optional)</label>
      <textarea id={`${id}-message`} name="message" rows={4} maxLength={2000} />
      {mode.kind === "widget" ? <Turnstile siteKey={mode.siteKey} onToken={setToken} resetKey={challenge} /> : null}
      {status.state === "error" ? (
        <p id={`${id}-error`} role="alert" className="error">
          {status.message}
        </p>
      ) : null}
      <button type="submit" className="button primary" disabled={sending}>
        {sending ? "Sending…" : kind === "tour" ? "Request a tour" : "Send message"}
      </button>
    </form>
  );
}

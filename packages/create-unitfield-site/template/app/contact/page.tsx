import type { Metadata } from "next";
import { InquiryForm, type InquiryMode } from "@/components/inquiry-form";
import { turnstileSiteKey } from "@/lib/config";
import { storefront } from "@/lib/storefront";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage() {
  const { contact, brand } = await storefront().site.get();
  const siteKey = turnstileSiteKey();
  const mode: InquiryMode = siteKey ? { kind: "widget", siteKey } : process.env.NODE_ENV === "production" ? { kind: "off" } : { kind: "development" };

  return (
    <div className="narrow">
      <h1>Contact {brand.name}</h1>
      {contact.email || contact.phone ? (
        <p>
          {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
          {contact.email && contact.phone ? " · " : null}
          {contact.phone ? <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>{contact.phone}</a> : null}
        </p>
      ) : null}
      {mode.kind === "off" ? <p className="muted">Write or call us using the details above.</p> : <InquiryForm mode={mode} />}
    </div>
  );
}

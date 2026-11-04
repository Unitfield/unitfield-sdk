import type { Metadata } from "next";
import { InquiryForm } from "@/components/inquiry-form";
import { inquiryMode } from "@/lib/inquiry";
import { storefront } from "@/lib/storefront";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage() {
  const site = await storefront().site.get();
  const { contact, brand } = site;
  const mode = inquiryMode(site);

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

import type { StorefrontSite } from "@unitfield/sdk";

export function SiteFooter({ site }: { site: StorefrontSite }) {
  const { email, phone } = site.contact;
  return (
    <footer className="site-footer">
      <div className="container footer-bar">
        <p>
          <strong>{site.brand.name}</strong>
        </p>
        {email || phone ? (
          <p className="muted">
            {email ? <a href={`mailto:${email}`}>{email}</a> : null}
            {email && phone ? " · " : null}
            {phone ? <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>{phone}</a> : null}
          </p>
        ) : null}
      </div>
    </footer>
  );
}

import type { StorefrontSite } from "@unitfield/sdk";
import Link from "next/link";
import type { SignedInCustomer } from "@/lib/session";

export function SiteHeader({ site, customer, signInEnabled }: { site: StorefrontSite; customer: SignedInCustomer | null; signInEnabled: boolean }) {
  return (
    <header className="site-header">
      <div className="container bar">
        <Link href="/" className="brand">
          {site.brand.logoUrl ? (
            // The logo is served by Unitfield; a plain <img> needs no image-domain configuration.
            <img src={site.brand.logoUrl} alt="" className="brand-logo" width={32} height={32} />
          ) : null}
          <span>{site.brand.name}</span>
        </Link>
        <nav aria-label="Main" className="nav">
          <Link href="/listings">Homes</Link>
          <Link href="/contact">Contact</Link>
          {/* The hosted account lives on your Unitfield domain; it keeps its own sign-in. */}
          <a href={site.hostedUrls.accountUrl}>My account</a>
          {customer ? (
            <form action="/auth/sign-out" method="post" className="signed-in">
              <span className="muted" title={customer.email ?? undefined}>
                {customer.email ?? "Signed in"}
              </span>
              <button type="submit" className="button quiet">
                Sign out
              </button>
            </form>
          ) : signInEnabled ? (
            // A plain link: the sign-in starts on the server, which redirects to the issuer.
            <a href="/auth/sign-in" className="button quiet">
              Sign in
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

import { UnitfieldProvider } from "@unitfield/react";
import type { Metadata } from "next";
import { connection } from "next/server";
import type { CSSProperties, ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { brandColor, readableOn } from "@/lib/brand";
import { apiUrl, publishableKey } from "@/lib/config";
import { currentCustomer, signInEnabled } from "@/lib/session";
import { storefront } from "@/lib/storefront";
import "./globals.css";

// Every page renders per request (`connection()`), so `next build` needs no environment variables and no network, and the
// header can show the signed-in customer from a cookie. The API reads underneath are still cached by Next for 60 seconds
// and revalidated by the webhook route.
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const { brand } = await storefront().site.get();
  return { title: { default: `${brand.name}: homes for rent`, template: `%s | ${brand.name}` }, description: `Browse available homes from ${brand.name} and apply online.` };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const [site, customer] = await Promise.all([storefront().site.get(), currentCustomer()]);
  const brand = brandColor(site.brand.primaryColor);
  const style = { "--brand": brand, "--on-brand": readableOn(brand) } as CSSProperties;

  return (
    <html lang="en">
      <body style={style}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {/* The provider hands the storefront client to client components (the inquiry form). The key is public by design. */}
        <UnitfieldProvider publishableKey={publishableKey()} apiUrl={apiUrl()}>
          <SiteHeader site={site} customer={customer} signInEnabled={signInEnabled()} />
          <main id="main" className="container">
            {children}
          </main>
          <SiteFooter site={site} />
        </UnitfieldProvider>
      </body>
    </html>
  );
}

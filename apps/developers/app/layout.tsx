import "./global.css";
import type { Metadata, Viewport } from "next";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import SearchDialog from "@/components/search-dialog";
import { SITE_URL } from "@/lib/site";
import { satoshi } from "./fonts";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Unitfield for developers", template: "%s | Unitfield for developers" },
  description: "Build your own rental website on Unitfield: SDK guides, the API reference and the webhook event catalog.",
  openGraph: { siteName: "Unitfield for developers", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1a19" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={satoshi.variable} suppressHydrationWarning>
      <body>
        <RootProvider search={{ SearchDialog }}>{children}</RootProvider>
      </body>
    </html>
  );
}

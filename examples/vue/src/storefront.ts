import { createStorefrontClient } from "@unitfield/sdk";

/**
 * Reads your public listings. This runs in the browser, so the page's origin must be allowed on the key. The SDK refuses
 * an empty or malformed key with a clear message, so a missing VITE_UNITFIELD_PUBLISHABLE_KEY (see .env.example) shows up
 * as an error in the console on the first page load.
 */
export const storefront = createStorefrontClient({
  publishableKey: String(import.meta.env.VITE_UNITFIELD_PUBLISHABLE_KEY ?? ""),
  baseUrl: (import.meta.env.VITE_UNITFIELD_API_URL as string | undefined) || "https://api.unitfield.com",
});

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** `$1,900/mo`. The listing's own currency is used when it is not USD. */
export function rent(listing: { rent: number; currency: string; rentPeriod: string }): string {
  const formatter = listing.currency === "USD" ? money : new Intl.NumberFormat("en-US", { style: "currency", currency: listing.currency, maximumFractionDigits: 0 });
  return `${formatter.format(listing.rent)}${listing.rentPeriod.toLowerCase() === "monthly" ? "/mo" : ` / ${listing.rentPeriod.toLowerCase()}`}`;
}

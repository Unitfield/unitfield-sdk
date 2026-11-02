import type { ListingSummary } from "@unitfield/sdk";

type Rentable = Pick<ListingSummary, "rent" | "currency" | "rentPeriod">;
type Described = Pick<ListingSummary, "bedrooms" | "bathrooms" | "areaSqft">;

const PERIOD_SUFFIX: Record<string, string> = { monthly: "/mo", weekly: "/wk", daily: "/day", yearly: "/yr", annually: "/yr", annual: "/yr" };

/**
 * `$4,800/mo`. The currency and period come from the listing; an unfamiliar period is shown as `/ <period>` in lower
 * case rather than dropped. Whole amounts have no decimals.
 */
export function formatRent(listing: Rentable, locale?: string): string {
  const whole = Number.isInteger(listing.rent);
  let amount: string;
  try {
    amount = new Intl.NumberFormat(locale, { style: "currency", currency: listing.currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(listing.rent);
  } catch {
    // An unknown currency code makes Intl throw; show the number with the code instead.
    amount = `${listing.rent.toLocaleString(locale)} ${listing.currency}`;
  }
  const period = listing.rentPeriod.trim().toLowerCase();
  return `${amount}${PERIOD_SUFFIX[period] ?? (period ? ` / ${period}` : "")}`;
}

/** `Studio` for zero bedrooms, otherwise `2 bd`. */
export function formatBedrooms(bedrooms: number): string {
  return bedrooms === 0 ? "Studio" : `${bedrooms} bd`;
}

/** `1.5 ba`: halves are kept, whole numbers have no decimals. */
export function formatBathrooms(bathrooms: number): string {
  return `${Number.isInteger(bathrooms) ? bathrooms : bathrooms.toFixed(1).replace(/\.0$/, "")} ba`;
}

/** `1,200 sq ft`, or `null` when the listing has no area. */
export function formatArea(areaSqft: number, locale?: string): string | null {
  return areaSqft > 0 ? `${areaSqft.toLocaleString(locale)} sq ft` : null;
}

/** The facts line as separate parts: bedrooms, bathrooms and, when known, area. */
export function listingFacts(listing: Described, locale?: string): string[] {
  const area = formatArea(listing.areaSqft, locale);
  return [formatBedrooms(listing.bedrooms), formatBathrooms(listing.bathrooms), ...(area ? [area] : [])];
}

/** `Austin, TX`, `Austin`, or `null` when the listing has neither. */
export function formatLocation(listing: Pick<ListingSummary, "city" | "state">): string | null {
  const parts = [listing.city, listing.state].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length ? parts.join(", ") : null;
}

/**
 * `Nov 2, 2026` for a `YYYY-MM-DD` date. The date has no time zone, so it is formatted as the same calendar day
 * everywhere (and the server and the browser agree).
 */
export function formatAvailability(availableFrom: string, locale?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(availableFrom);
  if (!match) return availableFrom;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

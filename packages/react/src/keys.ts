import type { ListingQuery } from "@unitfield/sdk";

/** Query keys are plain JSON arrays: stable across renders and usable as TanStack Query keys. */
export type UnitfieldQueryKey = readonly ["unitfield", ...unknown[]];

/** Serializes the one non-JSON value a query can carry (`availableBy` as a `Date`) and drops `undefined`. */
function normalizeListingQuery(query: ListingQuery | undefined): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};
  if (!query) return normalized;
  for (const key of Object.keys(query).sort()) {
    const value = (query as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    normalized[key] = value instanceof Date ? value.toISOString().slice(0, 10) : (value as string | number | boolean);
  }
  return normalized;
}

export const queryKeys = {
  site: (previewToken?: string): UnitfieldQueryKey => (previewToken ? ["unitfield", "site", { preview: true }] : ["unitfield", "site"]),
  listings: (query?: ListingQuery): UnitfieldQueryKey => ["unitfield", "listings", normalizeListingQuery(query)],
  listing: (listingPublicId: string): UnitfieldQueryKey => ["unitfield", "listing", listingPublicId],
};

/** The string a hook compares between renders. Keys are JSON by construction, so this is a plain stringify. */
export function keyToString(key: UnitfieldQueryKey): string {
  return JSON.stringify(key);
}

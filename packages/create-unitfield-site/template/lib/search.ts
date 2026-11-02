import type { ListingQuery } from "@unitfield/sdk";

export const PAGE_SIZE = 12;

type Raw = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : undefined;
}

function count(value: string | undefined, max: number): number | undefined {
  if (value === undefined || !/^\d{1,3}$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed <= max ? parsed : undefined;
}

function amount(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,7}(\.\d{1,2})?$/.test(value)) return undefined;
  return Number(value);
}

const SORTS = ["newest", "rent", "rent_desc", "availability"] as const;

export type Search = { city?: string; bedrooms?: number; maxRent?: number; sort: (typeof SORTS)[number]; cursor?: string };

/** Reads the search form from the URL. Anything that is not a clean value is ignored, not passed on to the API. */
export function parseSearch(raw: Raw): Search {
  const sort = first(raw.sort);
  const city = first(raw.city);
  const cursor = first(raw.cursor);
  const bedrooms = count(first(raw.bedrooms), 20);
  const maxRent = amount(first(raw.maxRent));
  return {
    ...(city && city.length <= 80 ? { city } : {}),
    ...(bedrooms !== undefined ? { bedrooms } : {}),
    ...(maxRent !== undefined ? { maxRent } : {}),
    sort: SORTS.find((candidate) => candidate === sort) ?? "newest",
    ...(cursor && cursor.length <= 512 ? { cursor } : {}),
  };
}

export function toQuery(search: Search): ListingQuery {
  return {
    limit: PAGE_SIZE,
    sort: search.sort,
    ...(search.city ? { city: search.city } : {}),
    ...(search.bedrooms !== undefined ? { bedroomsMin: search.bedrooms } : {}),
    ...(search.maxRent !== undefined ? { rentMax: search.maxRent } : {}),
    ...(search.cursor ? { cursor: search.cursor } : {}),
  };
}

/** The URL of the same search with another cursor (or the first page when `cursor` is omitted). */
export function searchHref(search: Search, cursor?: string): string {
  const params = new URLSearchParams();
  if (search.city) params.set("city", search.city);
  if (search.bedrooms !== undefined) params.set("bedrooms", String(search.bedrooms));
  if (search.maxRent !== undefined) params.set("maxRent", String(search.maxRent));
  if (search.sort !== "newest") params.set("sort", search.sort);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/listings?${query}` : "/listings";
}

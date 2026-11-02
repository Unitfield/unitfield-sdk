"use client";

import type { ListingDetail } from "@unitfield/sdk";
import { useUnitfield } from "./context.js";
import { keyToString, queryKeys } from "./keys.js";
import { useQuery, type QueryOptions, type QueryResult } from "./use-query.js";

/** One listing with photos, description and amenities. Pass `null` or `undefined` to wait for the id. */
export function useListing(listingPublicId: string | null | undefined, options: QueryOptions<ListingDetail> = {}): QueryResult<ListingDetail> {
  const { client } = useUnitfield();
  const id = listingPublicId ?? "";
  return useQuery(keyToString(queryKeys.listing(id)), (signal) => client.listings.get(id, { signal }), { ...options, enabled: Boolean(id) && options.enabled !== false });
}

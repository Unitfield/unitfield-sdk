"use client";

import type { ListingPage, ListingQuery } from "@unitfield/sdk";
import { useUnitfield } from "./context.js";
import { keyToString, queryKeys } from "./keys.js";
import { useQuery, type QueryOptions, type QueryResult } from "./use-query.js";

/**
 * One page of listings. `data.items` are the cards and `data.nextCursor` is the `cursor` for the next page. The hook
 * reads again whenever the query's values change, so an inline object is fine.
 */
export function useListings(query?: ListingQuery, options: QueryOptions<ListingPage> = {}): QueryResult<ListingPage> {
  const { client } = useUnitfield();
  return useQuery(keyToString(queryKeys.listings(query)), (signal) => client.listings.list(query, { signal }), options);
}

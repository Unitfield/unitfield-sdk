import type { ListingDetail, ListingPage, ListingQuery, StorefrontClient, StorefrontSite } from "@unitfield/sdk";
import { queryKeys, type UnitfieldQueryKey } from "./keys.js";

type QueryContext = { signal?: AbortSignal };

/**
 * Query definitions for TanStack Query (or any cache that takes a key and a function). They hold no dependency on it:
 * each one is a plain `{ queryKey, queryFn }` object.
 *
 * ```ts
 * const queries = unitfieldQueries(client);
 * const { data } = useQuery(queries.listings({ city: "Austin" }));
 * ```
 */
export function unitfieldQueries(client: StorefrontClient) {
  return {
    site: (options: { previewToken?: string } = {}) => ({
      queryKey: queryKeys.site(options.previewToken),
      queryFn: ({ signal }: QueryContext = {}): Promise<StorefrontSite> =>
        client.site.get({ signal, ...(options.previewToken ? { previewToken: options.previewToken } : {}) }),
    }),
    listings: (query?: ListingQuery) => ({
      queryKey: queryKeys.listings(query),
      queryFn: ({ signal }: QueryContext = {}): Promise<ListingPage> => client.listings.list(query, { signal }),
    }),
    listing: (listingPublicId: string) => ({
      queryKey: queryKeys.listing(listingPublicId),
      queryFn: ({ signal }: QueryContext = {}): Promise<ListingDetail> => client.listings.get(listingPublicId, { signal }),
    }),
  } satisfies Record<string, (...args: never[]) => { queryKey: UnitfieldQueryKey; queryFn: (context: QueryContext) => Promise<unknown> }>;
}

export type UnitfieldQueries = ReturnType<typeof unitfieldQueries>;

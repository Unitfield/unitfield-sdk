"use client";

import type { StorefrontSite } from "@unitfield/sdk";
import { useUnitfield } from "./context.js";
import { keyToString, queryKeys } from "./keys.js";
import { useQuery, type QueryOptions, type QueryResult } from "./use-query.js";

export type UseSiteOptions = QueryOptions<StorefrontSite> & {
  /** A draft preview token. The read bypasses caches and returns the draft. */
  previewToken?: string;
};

/** The site: brand, navigation, contact and the hosted URLs (apply, sign-in, account). */
export function useSite(options: UseSiteOptions = {}): QueryResult<StorefrontSite> {
  const { client } = useUnitfield();
  const { previewToken, ...query } = options;
  return useQuery(keyToString(queryKeys.site(previewToken)), (signal) => client.site.get({ signal, ...(previewToken ? { previewToken } : {}) }), query);
}

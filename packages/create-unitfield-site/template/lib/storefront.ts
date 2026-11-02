import { createStorefrontClient, NotFoundError, type StorefrontClient } from "@unitfield/sdk";
import { apiUrl, publishableKey } from "./config";

/** The tag every API read carries. The webhook route revalidates it when your listings or site change. */
export const CACHE_TAG = "unitfield";

let client: StorefrontClient | undefined;

/**
 * The storefront client for Server Components and route handlers. Next's data cache keeps each read for 60 seconds
 * (the API itself says `max-age=60`) and drops them all when `revalidateTag(CACHE_TAG)` runs.
 */
export function storefront(): StorefrontClient {
  client ??= createStorefrontClient({
    publishableKey: publishableKey(),
    baseUrl: apiUrl(),
    fetchOptions: { next: { revalidate: 60, tags: [CACHE_TAG] } },
  });
  return client;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof NotFoundError;
}

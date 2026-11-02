import { createStorefrontClient, type ListingDetail, type ListingSummary, type StorefrontClient, type StorefrontSite } from "@unitfield/sdk";

export const KEY = "pk_test_abc123DEF456";
export const API = "https://api.example.test";

export function listing(overrides: Partial<ListingSummary> = {}): ListingSummary {
  return {
    listingPublicId: "clst_one",
    unitPublicId: "cunit_one",
    unitPublicKey: "UNITKEY1",
    propertyPublicId: "cprop_one",
    title: "Sunny two-bedroom",
    propertyName: "Maple Court",
    unitName: "2B",
    bedrooms: 2,
    bathrooms: 1.5,
    areaSqft: 1050,
    rent: 2100,
    currency: "USD",
    rentPeriod: "Monthly",
    availableFrom: "2026-11-02",
    acceptsApplications: true,
    applyUrl: "https://homes.example.test/apply/UNITKEY1",
    city: "Austin",
    state: "TX",
    coverImageUrl: "https://images.example.test/one.jpg",
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

export function detail(overrides: Partial<ListingSummary> = {}): ListingDetail {
  const card = listing(overrides);
  return {
    card: { ...card, publishedAt: "2026-10-25T11:43:51Z" },
    description: "Bright corner unit.",
    address1: "1 Maple Street",
    postalCode: "78701",
    country: "US",
    photos: [{ url: "https://images.example.test/one.jpg", alt: "Living room", isCover: true }],
    amenities: ["Laundry"],
    virtualTourUrl: null,
    property: {
      propertyPublicId: card.propertyPublicId,
      name: card.propertyName,
      headline: null,
      description: null,
      address1: "1 Maple Street",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "US",
      latitude: null,
      longitude: null,
      photos: [],
    },
  };
}

export function site(): StorefrontSite {
  return {
    siteId: "site_1",
    status: "published",
    revision: 3,
    themeId: "listing",
    themeVersion: "1.0.0",
    settings: {},
    navigation: { header: [], footer: [] },
    pages: [],
    brand: { name: "Maple Rentals", slug: "maple", logoUrl: null, primaryColor: "#2e6b4e", themeMode: "auto", brandHeaderBackground: false },
    contact: { email: "hello@maple.example.test", phone: null },
    hostedUrls: {
      applyBaseUrl: "https://homes.example.test/apply",
      signInUrl: "https://homes.example.test/sign-in",
      accountUrl: "https://homes.example.test/account",
    },
    primaryHost: "homes.example.test",
    isPreview: false,
  };
}

export type Call = { url: URL; headers: Headers; init: RequestInit };

type Handler = (call: Call) => Response | Promise<Response>;

/** A fetch double: records every call and answers by path through `handler`. */
export function fakeApi(handler: Handler) {
  const calls: Call[] = [];
  const fetch = (async (input: URL | string | Request, init: RequestInit = {}) => {
    const call: Call = { url: new URL(String(input)), headers: new Headers(init.headers), init };
    calls.push(call);
    const signal = init.signal;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return handler(call);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

/** A client over a fake API that serves `site`, a listings page and one listing detail. */
export function fixtureApi(options: { items?: ListingSummary[]; delayMs?: number } = {}) {
  const items = options.items ?? [listing(), listing({ listingPublicId: "clst_two", title: "Garden studio", bedrooms: 0 })];
  const api = fakeApi(async (call) => {
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    const path = call.url.pathname;
    if (path.endsWith("/site")) return Response.json(site());
    if (path.endsWith("/listings")) return Response.json({ items, nextCursor: null });
    const match = /\/listings\/([^/]+)$/.exec(path);
    if (match) {
      const found = items.find((item) => item.listingPublicId === decodeURIComponent(match[1] ?? ""));
      return found ? Response.json(detail(found)) : Response.json({ code: "storefront.not_found" }, { status: 404 });
    }
    return Response.json({ code: "storefront.not_found" }, { status: 404 });
  });
  const client: StorefrontClient = createStorefrontClient({ publishableKey: KEY, baseUrl: API, fetch: api.fetch, retry: false });
  return { ...api, client, items };
}

export function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** An unsigned JWT: the SDK reads ID token claims from the token endpoint and never verifies signatures. */
export function jwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(claims))}.sig`;
}

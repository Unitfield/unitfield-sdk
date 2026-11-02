/**
 * Storefront API contract (`/api/storefront/v1`). The shapes are the generated ones (`src/generated/storefront.ts`,
 * from the `v1` OpenAPI document), exported under stable names. Responses are narrowed with `Wire`: the documents
 * describe every number as `number | string`, but the API only ever sends JSON numbers.
 *
 * A few shapes refine what the document leaves open: `navigation`, `settings` and `page` are opaque JSON in the
 * contract, so they carry the documented structure here; `status` of a host keeps its known values for autocompletion;
 * the inquiry input takes `Date`s and the literal `kind`, which the client converts before it sends.
 *
 * Responses never carry private notes, owner data or tenant data.
 */
import type { components, operations } from "../generated/storefront.js";
import type { Wire } from "../internal/openapi-types.js";

type Schemas = components["schemas"];

/** `GET /hosts/{host}`: anonymous host resolution. Only public data; the publishable key is public. */
export type HostResolution = Omit<Wire<Schemas["StorefrontHostResolution"]>, "status"> & {
  /** `active`, `redirect`, `unpublished` or `platform`. For `redirect` hosts, `redirectTo` is the primary host to 301 to. */
  status: "active" | "redirect" | "unpublished" | "platform" | (string & {});
};

export type StorefrontBrand = Wire<Schemas["StorefrontBrand"]>;
export type StorefrontContact = Wire<Schemas["StorefrontContact"]>;
export type StorefrontPageIndexEntry = Wire<Schemas["StorefrontPageIndexEntry"]>;

/** A link of the site navigation: an internal page (`pageId`) or a `url` (https, mailto, tel or a site path); exactly one is set. */
export type StorefrontNavigationLink = {
  label: string;
  pageId: string | null;
  url: string | null;
};

/** The site's header and footer menus, at most 12 links each. */
export type StorefrontNavigation = {
  header: StorefrontNavigationLink[];
  footer: StorefrontNavigationLink[];
};

/** The hosted flows on the org host; SDK sites link or redirect to them. */
export type StorefrontHostedUrls = Wire<Schemas["StorefrontHostedUrls"]>;

/** `GET /site`. `status` is `published`, or `preview` for a draft read. `revision` changes on every publish; the response ETag derives from it. */
export type StorefrontSite = Omit<Wire<Schemas["StorefrontSite"]>, "navigation" | "settings"> & {
  /** The theme's settings: opaque JSON the theme's schema defines. */
  settings: Record<string, unknown>;
  navigation: StorefrontNavigation;
};

/** One page of the site document. The theme's section schemas define the rest of its shape. */
export type StorefrontPageDocument = {
  id: string;
  kind: string;
  slug: string;
  title: string;
  [key: string]: unknown;
};

/** `GET /pages/{slug}`. The home page is `index`. */
export type StorefrontPage = Omit<Wire<Schemas["StorefrontPage"]>, "page"> & {
  page: StorefrontPageDocument;
};

export type ListingSort = "newest" | "rent" | "rent_desc" | "availability";

/**
 * Query for `GET /listings`. `limit` is at most 50. There is no pet or lease-term filter: no real data backs one.
 * `availableBy` is "available on or before this date"; `Date` values serialize as `YYYY-MM-DD`.
 */
export type ListingQuery = Omit<Wire<NonNullable<operations["Storefront_ListListings"]["parameters"]["query"]>>, "availableBy" | "sort"> & {
  availableBy?: string | Date;
  sort?: ListingSort;
};

/** Query for `GET /properties`. `limit` is at most 50. */
export type PropertyQuery = Wire<NonNullable<operations["Storefront_ListProperties"]["parameters"]["query"]>>;

/** An item of `GET /listings`. `unitPublicKey` is the key in the hosted apply URL (`/apply/{unitPublicKey}`); `applyUrl` is null when applications are closed. */
export type ListingSummary = Wire<Schemas["PublicListingCardView"]>;

/** A listing with its publication time: `ListingDetail.card` and the listings of a `PropertyDetail`. */
export type ListingCard = Wire<Schemas["PublicListingCard"]>;

export type PublicPhoto = Wire<Schemas["PublicPhoto"]>;
export type PropertySummary = Wire<Schemas["PublicPropertySummary"]>;

/** `GET /listings/{listingPublicId}`. */
export type ListingDetail = Wire<Schemas["PublicListingDetail"]>;

/** An item of `GET /properties`. */
export type PropertyCard = Wire<Schemas["PublicPropertyCard"]>;

/** `GET /properties/{propertyPublicId}`. */
export type PropertyDetail = Wire<Schemas["PublicPropertyDetail"]>;

export type ListingPage = Wire<Schemas["StorefrontListingsResponse"]>;
export type PropertyPage = Wire<Schemas["PublicPropertyPage"]>;

/** Body of `POST /inquiries`. */
export type InquiryInput = {
  kind: "contact" | "tour";
  name: string;
  email: string;
  phone?: string;
  message?: string;
  listingPublicId?: string;
  /** Tour requests: up to five times, as ISO timestamps (or `Date`s). */
  preferredTimes?: (string | Date)[];
  /** Cloudflare Turnstile token from the widget; verified server-side. */
  turnstileToken: string;
};

/** The `202` answer. It is the same for every email, whether or not the Turnstile check passed. */
export type InquiryAccepted = Wire<Schemas["StorefrontInquiryAccepted"]>;

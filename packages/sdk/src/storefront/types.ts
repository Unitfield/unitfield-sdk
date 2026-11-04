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
export type StorefrontSite = Omit<Wire<Schemas["StorefrontSite"]>, "navigation" | "settings" | "turnstileSiteKey"> & {
  /** The theme's settings: opaque JSON the theme's schema defines. */
  settings: Record<string, unknown>;
  navigation: StorefrontNavigation;
  /**
   * The public site key of the Cloudflare Turnstile widget Unitfield made for your site. Its allowed hostnames are your site's
   * domains and the origins of your keys, and only the API holds its secret. Render the widget with this key and send the token
   * as `turnstileToken` when you create an inquiry: a token from any other widget is rejected. `null` while your site has no widget
   * (a key with no allowed origin yet, or an environment where widgets are not set up); absent on an older API.
   */
  turnstileSiteKey?: string | null;
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
  /**
   * Tour requests: up to five day-and-window picks from `tours.windows`. The days are the organization's
   * own calendar days, so there is no time zone to get wrong. Prefer this over `preferredTimes`.
   */
  picks?: TourPick[];
  /** Tour requests: the visitor's IANA time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), so emails can show both times. */
  timeZone?: string;
  /**
   * Tour requests, legacy: up to five times, as ISO timestamps (or `Date`s). The API maps each to the organization's window that
   * contains that local time. Kept for sites that have not moved to `picks`.
   */
  preferredTimes?: (string | Date)[];
  /**
   * Cloudflare Turnstile token, verified server-side. It must come from the widget made for your site: render it with
   * `site.turnstileSiteKey` (from `site.get()`). A token from another widget is rejected, and a rejected token is answered like an
   * accepted inquiry with nothing created.
   */
  turnstileToken: string;
};

/** The `202` answer. It is the same for every email, whether or not the Turnstile check passed. */
export type InquiryAccepted = Wire<Schemas["StorefrontInquiryAccepted"]>;

/*
 * Tours (`GET /tour-windows`, `POST /tours/view`, `POST /tours/answer`, `GET /tours/ics`). The shapes are the generated ones; the
 * document types `status`, the window keys and the answer action as plain strings, so those carry their known values here.
 */

/** A tour window of the organization's day: morning, afternoon or evening. The hours come from `TourWindows.windows`. */
export type TourWindowKey = "morning" | "afternoon" | "evening";

/** One thing a visitor picked: an organization-local calendar day (`YYYY-MM-DD`) and one of its windows. */
export type TourPick = Omit<Wire<Schemas["StorefrontTourPick"]>, "window"> & {
  window: TourWindowKey;
};

/** Query for `GET /tour-windows`. Without a listing the offer is the organization's general one. */
export type TourWindowsQuery = Wire<NonNullable<operations["Storefront_GetTourWindows"]["parameters"]["query"]>>;

/** One day of the offer. `date` is the organization-local day; `windows` are the ones open that day (closed days are not listed). */
export type TourOfferDay = Omit<Wire<Schemas["TourOfferDayDto"]>, "weekday" | "windows"> & {
  /** `mon` to `sun`; derive a display label from `date` when you need one. */
  weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | (string & {});
  windows: TourWindowKey[];
};

/** The hours of a window, `HH:mm` in the organization's time zone. */
export type TourWindowHours = Wire<Schemas["TourWindowRangeDto"]>;

/**
 * `GET /tour-windows`: what a tour request form may offer. `days` runs from tomorrow, in the organization's calendar and
 * zone, without the closed days and windows; an empty `days` means the site offers no tours (show an email or phone fallback).
 * `zoneId` is that IANA zone, for example `America/Los_Angeles`.
 */
export type TourWindows = Omit<Wire<Schemas["TourWindowsDto"]>, "days" | "windows"> & {
  days: TourOfferDay[];
  /** Hours per window; a window that is off everywhere may be missing. */
  windows: Partial<Record<TourWindowKey, TourWindowHours>>;
};

/** The lifecycle of a tour as the visitor sees it. A cancel revokes the link, so `canceled` only ever comes back in the answer to `cancel`: opening the link again is a `NotFoundError`. */
export type TourStatus = "requested" | "needs_time" | "scheduled" | "toured" | "no_show" | "canceled" | "applied";

/** A time the organization suggested in place of the visitor's picks (`status: "requested"` with a proposal). `date` and `start` are organization-local. */
export type TourProposal = Wire<Schemas["TourVisitorProposal"]>;

/**
 * `POST /tours/view` and `POST /tours/answer`: the tour behind a visitor's private link. `date`, `start` and `end` describe the
 * booked time in the organization's zone (`zoneId`) and are null until a time is booked. `offer` is present when the visitor may pick
 * times (`canChange`). `applyUrl` appears after the tour. `photoUrl` is the home's cover.
 */
export type TourVisitorView = Omit<Wire<Schemas["TourVisitorView"]>, "status" | "picks" | "proposal" | "offer"> & {
  status: TourStatus;
  picks: TourPick[];
  proposal: TourProposal | null;
  offer: TourWindows | null;
};

/** What a visitor can do on the tour page. `pick` replaces their picks and needs `picks`. */
export type TourAnswerAction = "accept_proposal" | "coming" | "cant_make_it" | "cancel" | "pick";

/** Body of `POST /tours/answer`. */
export type TourAnswerInput = {
  /** The private token from the tour link. */
  token: string;
  action: TourAnswerAction;
  /** Only with `action: "pick"`: one to five picks, taken from the view's `offer`. */
  picks?: TourPick[];
  message?: string;
};

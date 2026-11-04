import { ApiClient, UNITFIELD_API_URL, type ClientOptions } from "../client.js";
import type { components } from "../generated/storefront.js";
import { paginateCursor, type IterateOptions, type PagedList } from "../pagination.js";
import { pathSegment, resolveApiUrl } from "../internal/url.js";
import { Transport, type MutationOptions, type RequestOptions } from "../transport.js";
import type {
  HostResolution,
  InquiryInput,
  ListingDetail,
  ListingPage,
  ListingQuery,
  ListingSummary,
  InquiryAccepted,
  PropertyCard,
  PropertyDetail,
  PropertyPage,
  PropertyQuery,
  StorefrontPage,
  StorefrontSite,
  TourAnswerAction,
  TourAnswerInput,
  TourPick,
  TourVisitorView,
  TourWindows,
  TourWindowsQuery,
} from "./types.js";

const BASE = "/api/storefront/v1";
const PREVIEW_HEADER = "X-Unitfield-Preview";
const PUBLISHABLE_KEY = /^pk_(live|test)_[A-Za-z0-9]+$/;
const MAX_LIMIT = 50;

export type StorefrontClientOptions = ClientOptions & {
  /** `pk_live_…` or `pk_test_…`. Public by design; it is bound to the origins the operator allowed. */
  publishableKey: string;
  /** A draft preview token (section 5.5). Only `site` and `pages` use it, and those requests bypass caches. */
  previewToken?: string;
};

export type PreviewOptions = RequestOptions & {
  /** Overrides the client's preview token for this call. */
  previewToken?: string;
};

export type StorefrontIterateOptions = RequestOptions & IterateOptions;

/**
 * Reads the public storefront of one site with a publishable key. Safe in browsers and on servers.
 *
 * Reads are cacheable (`Cache-Control: public, max-age=60`): the client sets no `cache` mode so the HTTP cache,
 * or a framework's data cache through `fetchOptions`, does its job. Preview reads are always `no-store`.
 */
export class StorefrontClient extends ApiClient {
  readonly publishableKey: string;
  /** `"test"` for `pk_test_…` keys. */
  readonly mode: "live" | "test";
  readonly hosts: StorefrontHosts;
  readonly site: StorefrontSiteResource;
  readonly pages: StorefrontPages;
  readonly listings: StorefrontListings;
  readonly properties: StorefrontProperties;
  readonly inquiries: StorefrontInquiries;
  readonly tours: StorefrontTours;
  readonly #options: StorefrontClientOptions;

  constructor(options: StorefrontClientOptions) {
    if (typeof options?.publishableKey !== "string" || !PUBLISHABLE_KEY.test(options.publishableKey.trim())) {
      throw new TypeError("publishableKey must be a publishable key (pk_live_… or pk_test_…).");
    }
    if (options.previewToken !== undefined && !options.previewToken.trim()) {
      throw new TypeError("previewToken must not be empty.");
    }
    const publishableKey = options.publishableKey.trim();
    super(new Transport({ ...options, baseUrl: options.baseUrl ?? UNITFIELD_API_URL, publishableKey }));
    this.#options = options;
    this.publishableKey = publishableKey;
    this.mode = publishableKey.startsWith("pk_test_") ? "test" : "live";
    const previewToken = options.previewToken?.trim();
    this.hosts = new StorefrontHosts(this.http);
    this.site = new StorefrontSiteResource(this.http, previewToken);
    this.pages = new StorefrontPages(this.http, previewToken);
    this.listings = new StorefrontListings(this.http);
    this.properties = new StorefrontProperties(this.http);
    this.inquiries = new StorefrontInquiries(this.http);
    this.tours = new StorefrontTours(this.http, this.baseUrl);
  }

  /** A client of the same site whose `site` and `pages` reads return the draft behind `previewToken`. */
  withPreview(previewToken: string): StorefrontClient {
    return new StorefrontClient({ ...this.#options, previewToken });
  }
}

export function createStorefrontClient(options: StorefrontClientOptions): StorefrontClient {
  return new StorefrontClient(options);
}

function previewRequest(token: string | undefined): Pick<RequestOptions, "headers" | "fetchOptions"> {
  return token ? { headers: { [PREVIEW_HEADER]: token }, fetchOptions: { cache: "no-store" } } : {};
}

function limitOf(query: { limit?: number } | undefined): void {
  const limit = query?.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
}

class StorefrontHosts {
  readonly #http: Transport;
  constructor(http: Transport) {
    this.#http = http;
  }

  /** Resolves a request host to its site. Anonymous: it never sends the publishable key. */
  async resolve(host: string, options: RequestOptions = {}): Promise<HostResolution> {
    const normalized = typeof host === "string" ? host.trim().toLowerCase() : "";
    if (!normalized || /[/\s?#@]/.test(normalized)) throw new TypeError("host must be a bare hostname.");
    return this.#http.request<HostResolution>({ ...options, path: `${BASE}/hosts/${pathSegment(normalized, "host")}`, anonymous: true });
  }
}

class StorefrontSiteResource {
  readonly #http: Transport;
  readonly #previewToken: string | undefined;
  constructor(http: Transport, previewToken: string | undefined) {
    this.#http = http;
    this.#previewToken = previewToken;
  }

  async get(options: PreviewOptions = {}): Promise<StorefrontSite> {
    const { previewToken, ...request } = options;
    const preview = previewRequest(previewToken?.trim() || this.#previewToken);
    return this.#http.request<StorefrontSite>({
      ...request,
      headers: mergeHeaders(request.headers, preview.headers),
      fetchOptions: { ...request.fetchOptions, ...preview.fetchOptions },
      path: `${BASE}/site`,
    });
  }
}

class StorefrontPages {
  readonly #http: Transport;
  readonly #previewToken: string | undefined;
  constructor(http: Transport, previewToken: string | undefined) {
    this.#http = http;
    this.#previewToken = previewToken;
  }

  async get(slug: string, options: PreviewOptions = {}): Promise<StorefrontPage> {
    const { previewToken, ...request } = options;
    const preview = previewRequest(previewToken?.trim() || this.#previewToken);
    return this.#http.request<StorefrontPage>({
      ...request,
      headers: mergeHeaders(request.headers, preview.headers),
      fetchOptions: { ...request.fetchOptions, ...preview.fetchOptions },
      path: `${BASE}/pages/${pathSegment(slug, "slug")}`,
    });
  }
}

class StorefrontListings {
  readonly #http: Transport;
  constructor(http: Transport) {
    this.#http = http;
  }

  /** One page. Follow `nextCursor`, or use {@link iterate}. */
  async list(query: ListingQuery = {}, options: RequestOptions = {}): Promise<ListingPage> {
    limitOf(query);
    return this.#http.request<ListingPage>({ ...options, path: `${BASE}/listings`, query: { ...query } });
  }

  /** Every listing matching `query`, page by page, lazily. `query.cursor` starts the walk mid-way. */
  iterate(query: Omit<ListingQuery, "cursor"> & { cursor?: string } = {}, options: StorefrontIterateOptions = {}): PagedList<ListingSummary, ListingPage> {
    const { maxItems, maxPages, ...request } = options;
    limitOf(query);
    return paginateCursor<ListingSummary, ListingPage>(
      (cursor) => this.list({ ...query, cursor: cursor ?? query.cursor }, request),
      { maxItems, maxPages },
    );
  }

  async get(listingPublicId: string, options: RequestOptions = {}): Promise<ListingDetail> {
    return this.#http.request<ListingDetail>({ ...options, path: `${BASE}/listings/${pathSegment(listingPublicId, "listingPublicId")}` });
  }
}

class StorefrontProperties {
  readonly #http: Transport;
  constructor(http: Transport) {
    this.#http = http;
  }

  async list(query: PropertyQuery = {}, options: RequestOptions = {}): Promise<PropertyPage> {
    limitOf(query);
    return this.#http.request<PropertyPage>({ ...options, path: `${BASE}/properties`, query: { ...query } });
  }

  iterate(query: PropertyQuery = {}, options: StorefrontIterateOptions = {}): PagedList<PropertyCard, PropertyPage> {
    const { maxItems, maxPages, ...request } = options;
    limitOf(query);
    return paginateCursor<PropertyCard, PropertyPage>(
      (cursor) => this.list({ ...query, cursor: cursor ?? query.cursor }, request),
      { maxItems, maxPages },
    );
  }

  async get(propertyPublicId: string, options: RequestOptions = {}): Promise<PropertyDetail> {
    return this.#http.request<PropertyDetail>({ ...options, path: `${BASE}/properties/${pathSegment(propertyPublicId, "propertyPublicId")}` });
  }
}

class StorefrontInquiries {
  readonly #http: Transport;
  constructor(http: Transport) {
    this.#http = http;
  }

  /**
   * Sends a contact or tour request. Resolves with `{ status: "accepted" }` when the API accepted it (`202`). The API
   * answers the same for every email and for a failed Turnstile check, so there is nothing more to read back. An
   * invalid request is a `ValidationError`; rate limits are a `RateLimitError`.
   */
  async create(input: InquiryInput, options: MutationOptions = {}): Promise<InquiryAccepted> {
    return this.#http.request<InquiryAccepted>({
      ...options,
      method: "POST",
      path: `${BASE}/inquiries`,
      body: inquiryBody(input),
    });
  }
}

const MAX_PICKS = 5;
const WINDOW_KEYS = new Set(["morning", "afternoon", "evening"]);
const ANSWER_ACTIONS = new Set<TourAnswerAction>(["accept_proposal", "coming", "cant_make_it", "cancel", "pick"]);
const PICK_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One to five picks, each an organization-local `YYYY-MM-DD` day and a window key. */
function validatePicks(picks: readonly TourPick[], name: string): void {
  if (!Array.isArray(picks) || picks.length === 0 || picks.length > MAX_PICKS) throw new TypeError(`${name} must hold 1 to ${MAX_PICKS} picks.`);
  for (const pick of picks) {
    if (!pick || typeof pick.date !== "string" || !PICK_DATE.test(pick.date) || Number.isNaN(Date.parse(`${pick.date}T12:00:00Z`))) {
      throw new TypeError(`${name} dates must be YYYY-MM-DD.`);
    }
    if (!WINDOW_KEYS.has(pick.window)) throw new TypeError(`${name} windows must be "morning", "afternoon" or "evening".`);
  }
}

function tourToken(token: unknown): string {
  if (typeof token !== "string" || !token.trim() || /\s/.test(token.trim())) throw new TypeError("token must be the tour link's token.");
  return token.trim();
}

class StorefrontTours {
  readonly #http: Transport;
  readonly #baseUrl: string;
  constructor(http: Transport, baseUrl: string) {
    this.#http = http;
    this.#baseUrl = baseUrl;
  }

  /**
   * What a tour request may offer (`GET /tour-windows`): the organization's open days and windows, from tomorrow, in its own
   * calendar. An empty `days` means tours are off. A `NotFoundError` means the API predates tours: fall back to your own days.
   * Cacheable like every public read.
   */
  async windows(query: TourWindowsQuery = {}, options: RequestOptions = {}): Promise<TourWindows> {
    return this.#http.request<TourWindows>({ ...options, path: `${BASE}/tour-windows`, query: { listingPublicId: query.listingPublicId?.trim() || undefined } });
  }

  /**
   * The tour behind a visitor's private link (`POST /tours/view`). An unknown, expired or revoked token is one uniform
   * `NotFoundError` (`tours.link_invalid`). Never cached, never retried; rate limited per visitor address.
   */
  async view(token: string, options: RequestOptions = {}): Promise<TourVisitorView> {
    return this.#http.request<TourVisitorView>({
      ...options,
      method: "POST",
      path: `${BASE}/tours/view`,
      body: { token: tourToken(token) },
      fetchOptions: { ...options.fetchOptions, cache: "no-store" },
    });
  }

  /**
   * One thing the visitor does on the tour page (`POST /tours/answer`): accept a proposed time, say they are coming or cannot make
   * it, cancel, or pick new times. Resolves with the tour as it is afterwards (after `cancel`, with status `canceled`: the link is
   * revoked from then on). Same errors as `view`, and two more: a `ConflictError` (`tours.wrong_status`) when the tour is no longer
   * in a state that allows the action, and a `ValidationError` (`tours.picks_invalid`) when no pick is on offer. `pick` is accepted
   * while the view's `canChange` is true; on a booked tour it releases the booking and goes back to `requested`.
   */
  async answer(input: TourAnswerInput, options: MutationOptions = {}): Promise<TourVisitorView> {
    const token = tourToken(input?.token);
    if (!ANSWER_ACTIONS.has(input.action)) throw new TypeError("action must be accept_proposal, coming, cant_make_it, cancel or pick.");
    if (input.action === "pick") {
      if (input.picks === undefined) throw new TypeError('picks are required with action "pick".');
      validatePicks(input.picks, "picks");
    } else if (input.picks !== undefined) {
      throw new TypeError('picks are only accepted with action "pick".');
    }
    if (input.message !== undefined && typeof input.message !== "string") throw new TypeError("message must be a string.");
    return this.#http.request<TourVisitorView>({
      ...options,
      method: "POST",
      path: `${BASE}/tours/answer`,
      body: {
        token,
        action: input.action,
        ...(input.picks ? { picks: input.picks.map(({ date, window }) => ({ date, window })) } : {}),
        ...(input.message?.trim() ? { message: input.message.trim() } : {}),
      },
      fetchOptions: { ...options.fetchOptions, cache: "no-store" },
    });
  }

  /**
   * The address of the `.ics` calendar file for the tour's current state (`GET /tours/ics?token=…`, `text/calendar`). This only
   * builds the URL: the call needs the same credentials as every storefront route, so fetch it on your server and serve the
   * file to the visitor. There is a file once a time is booked. Before that the answer is a 409 `tours.not_scheduled` (a valid
   * link whose tour has no time yet: a `ConflictError`), and for an unknown, revoked or canceled tour it is the uniform 404.
   */
  icsUrl(token: string): string {
    return resolveApiUrl(new URL(this.#baseUrl), `${BASE}/tours/ics`, { token: tourToken(token) }).toString();
  }
}

/** The request body as the API declares it: every field is optional-nullable on the wire, `preferredTimes` are ISO strings. */
function inquiryBody(input: InquiryInput): Partial<components["schemas"]["StorefrontInquiryRequest"]> {
  if (input.kind !== "contact" && input.kind !== "tour") throw new TypeError('kind must be "contact" or "tour".');
  for (const field of ["name", "email", "turnstileToken"] as const) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new TypeError(`${field} must be a non-empty string.`);
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(input.email.trim())) throw new TypeError("email must be an email address.");
  const { preferredTimes, picks, timeZone, ...rest } = input;
  if (preferredTimes && preferredTimes.length > 5) throw new TypeError("preferredTimes accepts at most 5 times.");
  if (picks !== undefined) validatePicks(picks, "picks");
  if (timeZone !== undefined && (typeof timeZone !== "string" || !timeZone.trim() || timeZone.length > 64)) {
    throw new TypeError("timeZone must be an IANA time zone name of at most 64 characters.");
  }
  return {
    ...rest,
    ...(picks ? { picks: picks.map(({ date, window }) => ({ date, window })) } : {}),
    ...(timeZone ? { timeZone: timeZone.trim() } : {}),
    ...(preferredTimes
      ? {
          preferredTimes: preferredTimes.map((time) => {
            const date = time instanceof Date ? time : new Date(time);
            if (Number.isNaN(date.getTime())) throw new TypeError("preferredTimes must be valid dates.");
            return date.toISOString();
          }),
        }
      : {}),
  };
}

function mergeHeaders(base: HeadersInit | undefined, extra: HeadersInit | undefined): HeadersInit | undefined {
  if (!base) return extra;
  if (!extra) return base;
  const merged = new Headers(base);
  new Headers(extra).forEach((value, key) => merged.set(key, value));
  return merged;
}

import {
  createApplicantClient,
  createAppsClient,
  createCustomerAuth,
  createCustomerSession,
  createPlatformClient,
  createResidentClient,
  createStorefrontClient,
  isUnitfieldError,
  memoryTokenStore,
  platformAvailabilityAction,
  RateLimitError,
  type AccessTokenProvider,
  type AppActionSubmit,
  type AppManifest,
  type AppsComponents,
  type AuthorizationRequest,
  type ApplicationStatus,
  type CursorPage,
  type HostResolution,
  type ListingDetail,
  type ListingQuery,
  type ListingSummary,
  type Organization,
  type ResidentLease,
  type StorefrontSite,
  type TokenSet,
} from "@unitfield/sdk";
import {
  createAuthorizationRequestCookie,
  createClientCredentialsTokenProvider,
  createCookieTokenStore,
  createWebhookVerifier,
  type AccessTokenProvider as ServerAccessTokenProvider,
  type WebhookEvent,
} from "@unitfield/sdk/server";

const tokenProvider: AccessTokenProvider = createClientCredentialsTokenProvider({
  tokenUrl: "https://auth.unitfield.test/oauth2/token",
  clientId: "client-id",
  clientSecret: "client-secret",
  scopes: ["listings:read"],
});
const sameType: ServerAccessTokenProvider = tokenProvider;

const apps = createAppsClient({ baseUrl: "https://api.unitfield.test", tokenProvider });
const organization: Promise<Organization> = apps.getOrganization();
const generated: Promise<AppsComponents["schemas"]["AppOrganizationContextDto"]> = organization;
// @ts-expect-error Submitting an application needs an idempotency key.
apps.submitApplication("draft", { certifiedApplication: true, typedSignature: "A", rentalApplicationTermsDocumentId: "d", rentalApplicationTermsVersion: "1", rentalApplicationTermsContentSha256: "s", certificationTextSha256: "s" }, {});
const action: AppActionSubmit = {
  extensionKey: "availability", resourcePublicId: "corg_abcdefghijklmnopqrstuvwx",
  input: { listingPublicId: "clst_abcdefghijklmnopqrstuvwx", startDate: "2026-11-01" }, idempotencyKey: "once",
};
// @ts-expect-error Caller input cannot override a lease reservation.
const invalidAction: AppActionSubmit = { ...action, input: { ...action.input, excludeLeaseId: "private" } };
// @ts-expect-error The listing API has no pet or lease-term filter any more.
apps.listListings({ petFriendly: true });
const platform = createPlatformClient({ tokenProvider });
// @ts-expect-error The `site.block` extension target is retired.
platform.listAppExtensions("e7a9d8c0-11c4-49b6-a1c2-559ed024db36", "app_0123456789abcdef0123456789abcdef", { target: "site.block", contextType: "listing", resourcePublicId: "clst_1" });
const manifest: AppManifest = {
  schemaVersion: "1", appKey: "rental-tools", version: "1.0.0", displayName: "Rental tools", runtimeMode: "service",
  requiredScopes: [...platformAvailabilityAction.requiredScopes], optionalScopes: [], redirectUris: [], allowedOrigins: [], extensions: [],
};

const storefront = createStorefrontClient({ publishableKey: "pk_test_abcdefghijklmnopqrstuvwxyz012345" });
const site: Promise<StorefrontSite> = storefront.site.get();
// The site carries the public key of its own Turnstile widget, or null; an older API sends nothing.
async function turnstileSiteKey(): Promise<string | null | undefined> {
  return (await site).turnstileSiteKey;
}
// The API returns the menus as { header, footer }, never a bare list.
const menus: StorefrontSite["navigation"] = { header: [{ label: "Homes", pageId: "p_homes", url: null }], footer: [{ label: "Call us", pageId: null, url: "tel:+15550100" }] };
const page: Promise<CursorPage<ListingSummary>> = storefront.listings.list({ city: "Austin", limit: 12, sort: "rent_desc" });
const detail: Promise<ListingDetail> = storefront.listings.get("clst_1");
async function detailTitle(): Promise<string> {
  return (await detail).card.title;
}
async function firstListing(): Promise<ListingSummary | undefined> {
  for await (const listing of storefront.listings.iterate({ city: "Austin" }, { maxItems: 1 })) return listing;
  return undefined;
}
// The host resolution carries the storefront client id; the API may omit it, or send null.
declare const host: HostResolution;
const storefrontClientId: string | null | undefined = host.storefrontClientId;
const hostStatus: string = host.status;
// Listings can be narrowed to one unit, and numbers arrive as numbers.
const byUnit: ListingQuery = { unitPublicKey: "unit-4b", availableBy: new Date(), bedroomsMin: 2 };
storefront.listings.list(byUnit);
declare const summary: ListingSummary;
const bedrooms: number = summary.bedrooms;
const rent: number = summary.rent;
const latitude: number | null = summary.latitude;
// @ts-expect-error The publishable key is required.
createStorefrontClient({});
// @ts-expect-error The storefront client takes a publishable key, never a bearer token.
createStorefrontClient({ publishableKey: "pk_test_x", accessToken: "token" });
// @ts-expect-error limit is a number.
storefront.listings.list({ limit: "50" });
// @ts-expect-error unknown sort.
storefront.listings.list({ sort: "price" });
storefront.inquiries.create({ kind: "contact", name: "Ada", email: "ada@example.test", turnstileToken: "token" });
// @ts-expect-error An inquiry needs a Turnstile token.
storefront.inquiries.create({ kind: "contact", name: "Ada", email: "ada@example.test" });

const auth = createCustomerAuth({ clientId: "client", redirectUri: "https://shop.example.test/callback" });
const request: Promise<AuthorizationRequest> = auth.createAuthorizationRequest();
const store = memoryTokenStore();
const session = createCustomerSession({ auth, store });
const tokens: Promise<TokenSet | null> = session.getTokens();
const resident = createResidentClient({ tokenProvider: session.tokenProvider });
const lease: Promise<ResidentLease> = resident.leases.get("clea_1");
// @ts-expect-error A payment needs an idempotency key.
resident.payments.create("clea_1", { amount: 1, paymentMethod: "card", successUrl: "https://x.test/ok", cancelUrl: "https://x.test/no" }, {});
const applicant = createApplicantClient({ tokenProvider: session.tokenProvider });
const draft = applicant.createDraft("unit-key");
declare const applicationStatus: ApplicationStatus;
const progress: number = applicationStatus.progressPercent;
// @ts-expect-error Submitting an application needs an idempotency key.
applicant.submit("draft", { certifiedApplication: true, typedSignature: "A", rentalApplicationTermsDocumentId: "d", rentalApplicationTermsVersion: "1", rentalApplicationTermsContentSha256: "s", certificationTextSha256: "s" }, {});

const verifier = createWebhookVerifier({ secret: ["current", "previous"] });
async function handle(body: string, headers: Headers): Promise<string> {
  const { event, delivery } = await verifier.constructEvent<{ listingPublicId: string }>(body, headers);
  const typed: WebhookEvent<{ listingPublicId: string }> = event;
  return `${typed.data.listingPublicId}:${delivery.deliveryId ?? ""}`;
}
declare const jar: Parameters<typeof createCookieTokenStore>[0];
const serverStore = createCookieTokenStore(jar, { secret: "x".repeat(32) });
const requestCookie = createAuthorizationRequestCookie(jar, { secret: "x".repeat(32) });

function describe(error: unknown): string {
  if (error instanceof RateLimitError) return `retry in ${error.retryAfterSeconds ?? "?"}s`;
  return isUnitfieldError(error) ? error.code : "unknown";
}

void [storefrontClientId, hostStatus, bedrooms, rent, latitude, progress, platform, sameType, generated, invalidAction, manifest, site, turnstileSiteKey, page, detail, detailTitle, firstListing, request, tokens, lease, applicant, draft, handle, serverStore, requestCookie, describe];

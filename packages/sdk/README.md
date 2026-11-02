# @unitfield/sdk

The official JavaScript and TypeScript SDK for Unitfield. ESM only, no runtime
dependencies, built on `fetch` and Web Crypto: it runs in browsers, Node 20+, edge
runtimes and serverless functions.

```bash
npm install @unitfield/sdk
```

| Entry point | Safe in a browser | What it holds |
| --- | --- | --- |
| `@unitfield/sdk` | Yes | `StorefrontClient`, customer sign-in (`CustomerAuth`, `CustomerSession`), `ResidentClient`, `ApplicantClient`, `AppsClient`, `PlatformClient`, typed errors, pagination |
| `@unitfield/sdk/server` | No | client-credentials token provider, webhook verification, sealed httpOnly cookie stores, publisher credential delivery |

## Read a storefront

```ts
import { createStorefrontClient } from "@unitfield/sdk";

const storefront = createStorefrontClient({ publishableKey: "pk_live_…" }); // baseUrl defaults to https://api.unitfield.com

const site = await storefront.site.get();
const { items, nextCursor } = await storefront.listings.list({ city: "Austin", bedroomsMin: 2, sort: "rent", limit: 12 });
for await (const listing of storefront.listings.iterate({ city: "Austin" }, { maxItems: 100 })) {
  console.log(listing.title, listing.applyUrl);
}
await storefront.inquiries.create({ kind: "contact", name, email, message, turnstileToken });
```

Methods: `hosts.resolve`, `site.get`, `pages.get`, `listings.list|iterate|get`,
`properties.list|iterate|get`, `inquiries.create`. `listings.list` also filters by
`unitPublicKey` (the key in `/apply/{unitPublicKey}`). A preview token
(`storefront.withPreview(token)`) reads the draft and bypasses caches. Public reads
set no `cache` mode so the HTTP cache (or a framework's, via `fetchOptions`) applies.

## Sign customers in (OIDC authorization code + PKCE)

```ts
const auth = createCustomerAuth({ clientId, redirectUri: "https://shop.example.com/callback", scopes: ["openid", "email", "offline_access", "resident:read"] });
const session = createCustomerSession({ auth });

const request = await auth.createAuthorizationRequest(); // url, state, nonce, codeVerifier
saveAuthorizationRequest(request);                       // sessionStorage, keyed by state
location.assign(request.url);

// callback page
await session.completeSignIn(location.href, takeAuthorizationRequestFor(location.href)!);
const resident = createResidentClient({ tokenProvider: session.tokenProvider });

const { logoutUrl } = await session.signOut();           // revokes, clears, returns the end-session URL
```

`handleCallback` verifies `error`, `state` and `iss`, redeems the code with the PKCE
verifier (public client: no secret), and validates the ID token's issuer, audience,
expiry and nonce (signatures are not verified: the token comes straight from the
token endpoint over TLS; the API verifies access tokens itself). Refresh tokens
rotate with no grace window and reuse revokes the family, so a rejected refresh
clears the session and throws `RefreshTokenRevokedError`. Refreshes are
single-flight, and across tabs serialized with the Web Locks API.

Server flows keep tokens out of JavaScript: `createCookieTokenStore` and
`createAuthorizationRequestCookie` (`@unitfield/sdk/server`) seal them with
AES-256-GCM into httpOnly `__Host-` cookies over any cookie jar (Next.js `cookies()`
fits as is). `/api/customer-auth/v1` is a first-party server API with no SDK client.

## Resident and applicant

`ResidentClient` (`/api/v1/resident`): `context`, `leases`, `payments`, `autopay`,
`requests`, `renewals`, `notifications`, `extensionActions`, profile and notification
preferences. `ApplicantClient` (`/api/customer/v1/applications`): `legal`, `list`,
`createDraft`, `getDraft`, `deleteDraft`, `saveStep`, `saveHousehold`, `recordConsent`,
upload sessions, `submit`, `status`, `screening`, `openSigningSession`. The
organization always comes from the token. Operations that
move money or create records require a caller-chosen `idempotencyKey`.

## Installed apps (server)

```ts
import { createAppsClient } from "@unitfield/sdk";
import { createClientCredentialsTokenProvider } from "@unitfield/sdk/server";

const unitfield = createAppsClient({
  baseUrl: process.env.UNITFIELD_API_URL!,
  tokenProvider: createClientCredentialsTokenProvider({
    tokenUrl: process.env.UNITFIELD_AUTH_TOKEN_URL!,
    clientId: process.env.UNITFIELD_APP_CLIENT_ID!,
    clientSecret: process.env.UNITFIELD_APP_CLIENT_SECRET!,
    scopes: ["listings:read"],
  }),
});
const listings = await unitfield.iterateListings({ pageSize: 25 }).toArray();
```

The provider uses `client_secret_basic` (each credential form-encoded before HTTP
Basic), requests the `unitfield-api` audience, refuses redirects, caches tokens and
fetches a fresh one when the API answers 401. `AppsClient` covers `/api/apps/v1`
(organization, listings, payments, checkout sessions, app actions and the rental
application helpers). `PlatformClient` covers app management
(`/api/platform/v1`): catalog, installations and grants, vendor review, native
extension hosts and per-installation webhooks. It needs a real Unitfield staff
session; business routes take the organization UUID and send `X-Tenant-Id`.

## Webhooks (server)

```ts
import { createWebhookVerifier } from "@unitfield/sdk/server";

const webhooks = createWebhookVerifier({ secret: [current, previous] });
const { event, delivery } = await webhooks.constructEvent(await request.text(), request.headers);
```

Verifies `X-Unitfield-Signature: t=<unix>,v1=<hmac>` (HMAC-SHA-256 over
`<t>.<raw body>`, constant-time), a 300 s timestamp window in both directions, and
that this exact signature was not accepted before (pluggable `replayStore`; the
default is in memory). Retries are re-signed with a new timestamp, so legitimate
retries pass; dedupe processing on `delivery.deliveryId`. Failures throw
`WebhookVerificationError` with a `reason`. Several secrets and several `v1` values
are honored so secrets rotate without dropped deliveries.

## Errors, retries, cancellation, pagination

Every failure is a `UnitfieldError`; non-2xx answers are `UnitfieldApiError`
subclasses (`ValidationError`, `AuthenticationError`, `PermissionError`,
`NotFoundError`, `ConflictError`, `RateLimitError`, `ServerError`) carrying `status`,
the API `code`, `detail`, field `errors`, trace/request/support ids, `rateLimit` and
`retryAfterSeconds`. Also `NetworkError`, `RequestTimeoutError`,
`InvalidResponseError`, and for sign-in `CustomerAuthError`, `OAuthTokenError`,
`RefreshTokenRevokedError`. Aborts surface as the native `AbortError`.

GET requests retry with jittered exponential backoff on network errors, timeouts,
408, 429, 502, 503 and 504 (default 2 retries, `Retry-After` honored up to 30 s).
Other methods retry only with an idempotency key, and only on network errors,
timeouts, 429 and 503. `idempotencyKey: true` generates a key reused across retries.
A 401 with a token provider is replayed once with `forceRefresh`. Configure with
`retry`, `timeoutMs` (default 30 s per attempt), `signal`, `fetch`, `headers` and
`fetchOptions` on the client or per call. Lists return `{ items, nextCursor }`;
`iterate()` gives a lazy `AsyncIterable` with `pages()`, `toArray()`, `maxItems`
and `maxPages`.

## Contract and types

Request and response types come from the API's OpenAPI documents
(`src/generated/*.ts`, re-exported as `AppsPaths`, `AppsComponents`, `ResidentPaths`,
`PlatformPaths`, `CustomerAuthPaths`, `StorefrontPaths`, `CustomerPaths` and so on).
The storefront and applicant types (`ListingSummary`, `ApplicationDraft`, ...) are those
schemas under stable names, with numbers typed as numbers. Regenerate with `pnpm gen:api`
from the repository root; the contract tests check every SDK call against the snapshots.

Licensed under the MIT License. See `LICENSE`.

## Publishing

Authenticate to the `@unitfield` npm scope and publish an unused version from this
directory:

```bash
npm whoami
npm publish --dry-run --access public
npm publish --access public
```

Run the repository-level `pnpm audit` and `pnpm check` gates first.

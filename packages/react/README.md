# @unitfield/react

React bindings for sites built on the Unitfield storefront API: a provider, hooks for the site, listings and the signed-in
customer, and a few headless components. It adds no styles and no markup you did not ask for.

It is a thin layer over [`@unitfield/sdk`](../sdk), which is a peer dependency so your app and this package share one copy
of the SDK (and of its error classes).

```bash
npm install @unitfield/react @unitfield/sdk
```

Works with React 18 and 19. ESM only. Every hook and the provider carry `"use client"`; the components in
[Headless components](#headless-components) have no hooks and render in Server Components too.

## Provider and hooks

```tsx
import { UnitfieldProvider, useListings } from "@unitfield/react";
import { ApplyButton, ListingGrid, ListingPrice, ListingTitle } from "@unitfield/react";

export function App() {
  return (
    <UnitfieldProvider publishableKey="pk_live_…" /* apiUrl defaults to https://api.unitfield.com */>
      <Homes />
    </UnitfieldProvider>
  );
}

function Homes() {
  const { data, status, error } = useListings({ city: "Austin", bedroomsMin: 2, sort: "rent", limit: 12 });
  if (status === "loading") return <p>Loading…</p>;
  if (error) return <p>Could not load homes.</p>;
  return (
    <ListingGrid listings={data!.items} empty={<p>No homes are listed right now.</p>}>
      {(listing) => (
        <>
          <ListingTitle listing={listing} />
          <ListingPrice listing={listing} />
          <ApplyButton listing={listing} />
        </>
      )}
    </ListingGrid>
  );
}
```

| Hook | Reads |
| --- | --- |
| `useSite(options?)` | `GET /site`: brand, navigation, contact, `hostedUrls` (apply, sign-in, account). `previewToken` reads the draft. |
| `useListings(query?, options?)` | `GET /listings`. `data` is `{ items, nextCursor }`; pass `nextCursor` back as `cursor` for the next page. |
| `useListing(listingPublicId, options?)` | `GET /listings/{id}`. Pass `undefined` while the id is not known. |
| `useCustomer()` | The signed-in customer of the browser session (see below). |
| `useSignIn(options?)` | `signIn()` and `completeSignIn()` for OIDC authorization code + PKCE. |
| `useUnitfield()` | `{ client, session, navigate }`, for calls the hooks do not wrap (`client.inquiries.create(...)`, `client.properties.list()`). |

Read hooks return `{ data, error, status, isLoading, refetch }`. `status` is `idle` (disabled), `loading`, `success` or
`error`; `error` is the SDK's typed error (`NotFoundError`, `RateLimitError`, ...). Pass `{ enabled: false }` to wait.

The provider takes `publishableKey`, `apiUrl` and `fetchOptions` (extra `fetch` init for every read; keep the object
stable), or a `client` you built with `createStorefrontClient`.

### What the hooks do not do

They keep **no cache of their own**. Repeat reads rely on the browser's HTTP cache (the API answers with
`Cache-Control: public, max-age=60`), and two components that ask for the same thing make two requests. Nothing is fetched
while rendering, so a server render shows `loading` (or `idle`) unless you hand over `initialData`.

### Server-rendered data

Read on the server with the SDK, pass the result down, and the hook starts in `success` without a request:

```tsx
// app/homes/page.tsx (Next.js Server Component)
import { createStorefrontClient } from "@unitfield/sdk";
import { Homes } from "./homes"; // a client component that calls useListings

export default async function Page() {
  const storefront = createStorefrontClient({ publishableKey: process.env.UNITFIELD_PUBLISHABLE_KEY!, fetchOptions: { next: { revalidate: 60 } } });
  const initialData = await storefront.listings.list({ limit: 12 });
  return <Homes initialData={initialData} />;
}

// homes.tsx
"use client";
export function Homes({ initialData }: { initialData: ListingPage }) {
  const { data } = useListings({ limit: 12 }, { initialData });
  …
}
```

The hook reads again when the query changes or when you call `refetch()`. For a Server Component you usually need no hooks at
all: call the SDK, render the headless components.

### TanStack Query

If you want a real cache, use TanStack Query. `unitfieldQueries(client)` returns `{ queryKey, queryFn }` objects for `site`,
`listings` and `listing`; this package does not import TanStack Query.

```tsx
import { useQuery } from "@tanstack/react-query";
import { unitfieldQueries, useUnitfield } from "@unitfield/react";

const { client } = useUnitfield();
const queries = unitfieldQueries(client);
const { data } = useQuery({ ...queries.listings({ city: "Austin" }), staleTime: 60_000 });
```

The keys are JSON arrays (`["unitfield", "listings", { city: "Austin" }]`) and the functions pass TanStack's abort signal on.

## Customer sign-in in the browser

Pass `auth` (the SDK's `CustomerAuth` options) to the provider to turn on `useSignIn` and `useCustomer`:

```tsx
<UnitfieldProvider
  publishableKey="pk_live_…"
  auth={{ clientId: "…", redirectUri: "https://www.example.com/callback", postLogoutRedirectUri: "https://www.example.com/" }}
>
```

```tsx
function SignInButton() {
  const { signIn } = useSignIn();
  const { status, customer, signOut } = useCustomer();
  if (status === "signed-in") return <button onClick={async () => { const { logoutUrl } = await signOut(); if (logoutUrl) location.assign(logoutUrl); }}>Sign out {customer?.email}</button>;
  return <button onClick={() => signIn()}>Sign in</button>;
}

// the page at redirectUri
function Callback() {
  const { completeSignIn, error } = useSignIn();
  useEffect(() => { void completeSignIn().then(() => location.replace("/")).catch(() => {}); }, []);
  return error ? <p>Sign-in failed.</p> : <p>Signing you in…</p>;
}
```

`signIn()` creates the PKCE request, keeps it (verifier included) in `sessionStorage` under its `state`, and sends the browser
to the issuer. `completeSignIn()` verifies the callback, redeems the code, validates the ID token and stores the tokens.
Tokens live **in memory** unless you pass `auth.store`: a reload signs the customer out. `useCustomer` renders as `loading` on
the server and in the first client render, so markup matches; it then reads the store.

`useCustomer().session.tokenProvider` is what `createResidentClient` and `createApplicantClient` take.

Sites that render on a server (Next.js and the like) should keep tokens out of JavaScript: do the redirect and callback in
route handlers with the SDK's `createAuthorizationRequestCookie` and `createCookieTokenStore`
(`@unitfield/sdk/server`). The `create-unitfield-site` starter does exactly that and uses no sign-in hooks.

## Headless components

Stateless, hook-free, and free of class names or wrappers beyond the one element each returns. Every part takes the usual
native props for its element.

| Component | Renders |
| --- | --- |
| `ListingGrid` | A `<ul>` with one `<li>` per listing; `children` is a render function, `empty` replaces the list when there are no listings. |
| `ListingImage` | A lazy `<img>` of the cover image (`listing`) or a gallery photo (`photo`), with a `fallback`. |
| `ListingTitle` | The title in an element you choose (`as`, default `h3`). |
| `ListingPrice` | `$4,800/mo`. |
| `ListingFacts` | A `<ul>` of `2 bd`, `1.5 ba`, `1,050 sq ft` (a zero-bedroom home is `Studio`). |
| `ListingLocation` | `Austin, TX`, or nothing. |
| `ListingAvailability` | A `<time>` with the first available day. |
| `ApplyButton` | An `<a>` to the listing's hosted apply page (`applyUrl`). Renders `fallback` (default nothing) when applications are closed. |

`ApplyButton` links to the page on the operator's Unitfield-hosted domain: the applicant continues there, where the draft,
sign-in and submission live. It only renders `http(s)` URLs.

The formatters behind the parts are exported too: `formatRent`, `formatBedrooms`, `formatBathrooms`, `formatArea`,
`formatLocation`, `formatAvailability`, `listingFacts`.

## License

MIT

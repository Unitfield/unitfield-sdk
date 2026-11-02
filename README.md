# Unitfield SDKs

Typed JavaScript and TypeScript SDKs for [Unitfield](https://unitfield.com), the property management platform.

| Package | What it is |
| --- | --- |
| [`@unitfield/sdk`](packages/sdk) | Storefront, customer sign-in, resident and applicant APIs, installed apps and webhooks. Works in Node 20+, edge runtimes and browsers. |
| [`@unitfield/react`](packages/react) | A provider, hooks (`useSite`, `useListings`, `useListing`, `useCustomer`, `useSignIn`) and headless components (`ListingGrid` parts, `ApplyButton`) over the SDK. |
| [`create-unitfield-site`](packages/create-unitfield-site) | `npx create-unitfield-site my-site`: a Next.js (App Router) starter with listings, sign-in and an inquiry form. |

```bash
npm install @unitfield/sdk
npm install @unitfield/react @unitfield/sdk      # React bindings
npx create-unitfield-site my-site                # a starter site
```

Start with the package README ([packages/sdk/README.md](packages/sdk/README.md)) or the guides in [docs/](docs/index.mdx):
quickstart, the Next.js starter, customer sign-in with PKCE, hosted apply, webhooks and revalidation, the account domain, and
testing with test keys. The [examples](examples) show the core package in Vue 3 and Svelte 5.

Until the first release of `@unitfield/react` and `create-unitfield-site`, only `@unitfield/sdk` is on npm; see
[RELEASING.md](RELEASING.md).

## Development

Node 24 and pnpm 11.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm docs:check
```

The API types are generated from OpenAPI snapshots in `packages/sdk/openapi/`. `pnpm gen:api` refreshes them from a running Unitfield API, and the tests fail when the generated types and the snapshots disagree. `pnpm docs:reference` regenerates the API reference index in `docs/reference/` from the same snapshots.

`node packages/create-unitfield-site/scripts/smoke.mjs` (after `pnpm build`) scaffolds the starter into a temporary directory, installs it with the locally packed packages, builds it, and runs it against a mock Unitfield API and a mock sign-in issuer. CI runs it on every push.

## Releases

Bump `version` in the package's `package.json` and merge to `main`. The release workflow publishes every package whose version npm does not have yet, one job per package, with provenance through npm trusted publishing. A package's first publish is manual: see [RELEASING.md](RELEASING.md).

## Security

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## License

MIT

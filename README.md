# Unitfield SDKs

Typed JavaScript and TypeScript SDKs for [Unitfield](https://unitfield.com), the property management platform.

| Package | What it is |
| --- | --- |
| [`@unitfield/sdk`](packages/sdk) | Storefront, customer sign-in, resident and applicant APIs, installed apps and webhooks. Works in Node 20+, edge runtimes and browsers. |

```bash
npm install @unitfield/sdk
```

Start with the package README: [packages/sdk/README.md](packages/sdk/README.md).

## Development

Node 24 and pnpm 11.

```bash
pnpm install
pnpm test
```

The API types are generated from OpenAPI snapshots in `packages/sdk/openapi/`. `pnpm gen:api` refreshes them from a running Unitfield API, and the tests fail when the generated types and the snapshots disagree.

## Releases

Bump `version` in `packages/sdk/package.json` and merge to `main`. The release workflow tests the package and publishes it to npm with provenance through npm trusted publishing.

## Security

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## License

MIT

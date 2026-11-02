# Vue example

A listings page and a listing page in Vue 3, on `@unitfield/sdk` alone: no Unitfield-specific Vue package is needed, the
core client works in any framework.

```bash
cp .env.example .env.local      # then put your publishable key in it
pnpm install                     # from the repository root
pnpm --filter @unitfield-examples/vue dev
```

- `src/storefront.ts` creates the client from `VITE_UNITFIELD_PUBLISHABLE_KEY` and `VITE_UNITFIELD_API_URL`.
- `src/App.vue` lists homes with a city and bedroom filter (`storefront.listings.list`), shows one home
  (`storefront.listings.get`) and links to the hosted apply page (`applyUrl`).

This runs in the browser, so the origin you serve it from must be listed under **Allowed origins** for the key in Unitfield
(Website > Developers). A test key accepts `http://localhost` on any port.

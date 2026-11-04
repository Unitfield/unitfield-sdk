# developers.unitfield.com

The SDK guides, the API reference and the webhook event catalog, built as a static site (Next.js and Fumadocs, `output: "export"`). Not published to npm.

## Why this is not part of the workspace

Every icon on the site is a Unitfield icon from `@unitfield/ui/icons`. That package lives in a private Unitfield repository (the icons are a paid set whose files may not be redistributed), so this repository never contains an icon file, an icon path or a generated icon component: only `import` statements. The site resolves the package at build time through a `link:` to a sibling checkout, `../../../unitfield-dashboard`, the same way Unitfield's other frontends do.

Because of that this folder is its own pnpm project (`pnpm-workspace.yaml` and `pnpm-lock.yaml` here), and the root `pnpm install`, `pnpm build`, `pnpm typecheck` and `ci.yml` never touch it. The SDK packages build and test for everyone, forks included, without the sibling.

## Build it locally

```sh
# next to this repository: git clone <the private dashboard repository> unitfield-dashboard
(cd ../../../unitfield-dashboard && pnpm install --ignore-scripts --filter @unitfield/ui)
pnpm install
pnpm dev        # or: pnpm build  (writes out/ and verifies it)
```

## Icons from Fumadocs itself

Fumadocs UI and Fumadocs OpenAPI draw their own icons (sidebar chevrons, search, theme switch, callouts, code block copy, ...) inside their components, where no prop or slot reaches them. `next.config.mjs` aliases their icon import to `lib/fumadocs-icons.tsx`, which maps each name Fumadocs asks for to an adopted Unitfield icon. A name Fumadocs adds in a later release makes the build fail until it is mapped there; `scripts/verify-output.mjs` also fails the build if any icon of another set reaches `out/`. Use `UnitfieldIcon` names only from the adopted catalogue (`unitfieldIconCatalogue` in `@unitfield/ui/icons`); a missing icon is adopted in the dashboard repository, never added here.

## CI and deploy

`.github/workflows/developers-site.yml` checks the sibling out at the commit in `unitfield-siblings.json` (using the `UNITFIELD_SIBLINGS_TOKEN` secret), builds and verifies the site, and from `main` deploys `out/` to Cloudflare Pages with `wrangler pages deploy`. It is skipped until the repository variable `DEVELOPERS_SITE_ENABLED` is `true`, and never runs for a pull request from a fork. The header of the workflow lists every secret and variable it needs. To move the pinned sibling forward, run `node scripts/siblings/bump.mjs` at the repository root and commit `unitfield-siblings.json`.

The site's dependencies are pinned exactly and are not covered by Dependabot (it cannot resolve the private `link:`); update them by hand.

# Releasing

Three packages are published from this repository:

| Package | Directory | On npm |
| --- | --- | --- |
| `@unitfield/sdk` | `packages/sdk` | yes |
| `@unitfield/react` | `packages/react` | **not yet: first publish is manual** |
| `create-unitfield-site` | `packages/create-unitfield-site` | **not yet: first publish is manual** |

`examples/*` are never published.

## The normal release (a package that is already on npm)

1. Bump `version` in the package's `package.json`.
2. Merge to `main`.

The **Release packages** workflow (`.github/workflows/release-sdk.yml`) then:

1. **Plans** (`scripts/release-plan.mjs`): reads the three manifests and asks the npm registry what it has. A package is published
   when its version is **not** on npm. A package that is not on npm at all is skipped with a note, never published: trusted
   publishing can only be set up for a package that exists, so its first publish is manual (below). A registry answer other than
   `200` or `404` fails the plan instead of being read as "absent".
2. **Publishes one job per package**, in order: `@unitfield/sdk`, then `@unitfield/react`, then `create-unitfield-site`. Each job
   needs the one before it to have succeeded or been skipped. A job runs typecheck and tests for its package, then
   `npm publish --access public --provenance` through npm trusted publishing (GitHub OIDC). There is no npm token anywhere.
   The job for `create-unitfield-site` also checks that the `@unitfield/*` versions its template pins are on npm, and runs the
   scaffold smoke test, before it publishes.

Jobs that have nothing to publish are skipped, so they never ask for approval of the `npm-release` environment.

The workflow file keeps the name `release-sdk.yml` although it now releases every package. Each package's trusted-publisher entry
on npm names this exact file and the `npm-release` environment; renaming either breaks releases until every entry is changed.

### Things to keep in step by hand

- **`@unitfield/react` peers `@unitfield/sdk` at `^0.1.3`.** In 0.x that means `>=0.1.3 <0.2.0`. When the SDK moves to `0.2.0`,
  change the peer range (and the dev dependency) in `packages/react/package.json`, and release both.
- **The starter pins exact versions.** `packages/create-unitfield-site/template/package.json` pins `@unitfield/sdk` and
  `@unitfield/react`, Next.js and React. After a new SDK or React release is on npm, update the pins in a follow-up commit (a test
  keeps them from naming a version newer than this repository has, and the release job refuses to publish while a pin is not on
  npm). Dependabot opens pull requests for the template's other pins; the scaffold smoke test in CI is what proves they still work.
- A new `@unitfield/*` dependency of the starter must be on npm first, for the same reason.

## The first publish of `@unitfield/react` and `create-unitfield-site` (manual)

Do this once per package, in this order. The scaffolder's template pins `@unitfield/react@0.1.0`, so `npx create-unitfield-site`
cannot install until React is on npm.

You need: an npm account in the `@unitfield` organization with publish rights, Node 24, pnpm 11, and npm 11.10 or newer
(`npm --version`; `npm install --global npm@latest` if it is older).

### 0. Check the commit you are publishing

```bash
git checkout main && git pull
pnpm install --frozen-lockfile
pnpm build && pnpm typecheck && pnpm test && pnpm test:scripts && pnpm docs:check
node packages/create-unitfield-site/scripts/smoke.mjs
```

`pnpm build` matters: `npm publish` runs each package's `prepack` (a build), and React's build needs the SDK's `dist/`.

### 1. Sign in to npm

```bash
npm login        # opens the browser: web sign-in as the owner
npm whoami
```

### 2. Publish `@unitfield/react`

```bash
cd packages/react
npm pack --dry-run          # expect: dist/, README.md, LICENSE, package.json; no src/, test/ or config files
npm publish --access public # approve in the browser if npm asks
npm view @unitfield/react version   # 0.1.0
```

A publish from a laptop carries no provenance; provenance comes from the CI releases that follow.

### 3. Add the trust entry for `@unitfield/react`

On npmjs.com open the package, then **Settings > Trusted Publisher > GitHub Actions**, and enter:

| Field | Value |
| --- | --- |
| Organization or user | `Unitfield` |
| Repository | `unitfield-sdk` |
| Workflow filename | `release-sdk.yml` |
| Environment name | `npm-release` |

or, from a terminal, the same entry:

```bash
npm trust github @unitfield/react --file release-sdk.yml --repository Unitfield/unitfield-sdk --environment npm-release --allow-publish
npm trust list @unitfield/react
```

### 4. Publish `create-unitfield-site`

```bash
cd ../create-unitfield-site
node scripts/check-pins.mjs     # must print "on npm" for both @unitfield/* pins; fails until React is published
npm pack --dry-run              # expect: dist/, template/ (with _gitignore and .env.example), README.md, LICENSE
npm publish --access public
npm view create-unitfield-site version   # 0.1.0
```

Then the trust entry, the same way (package name and nothing else changes):

```bash
npm trust github create-unitfield-site --file release-sdk.yml --repository Unitfield/unitfield-sdk --environment npm-release --allow-publish
npm trust list create-unitfield-site
```

### 5. Check what a user gets

```bash
cd "$(mktemp -d)"
npx create-unitfield-site@latest my-site --key pk_test_example --yes
cd my-site && npm run build
```

`next build` needs no environment, so this works without a real key.

### 6. Hand over to CI

From now on the normal release applies: bump `version`, merge to `main`, and the workflow publishes with provenance. The first
CI release is the real test of the trust entry, so watch the first run of each package.

## If a release fails

| Symptom | Likely cause |
| --- | --- |
| `npm error code E404` or `ENEEDAUTH` in the publish step | The package's trust entry is missing or does not match: check the repository (`Unitfield/unitfield-sdk`), the workflow filename (`release-sdk.yml`) and the environment (`npm-release`) with `npm trust list <package>`. |
| The plan job fails with "cannot tell whether ... is published" | The npm registry answered something other than `200` or `404`. Re-run the workflow. |
| The job for `create-unitfield-site` fails in `check-pins.mjs` | A pinned `@unitfield/*` version is not on npm yet. Publish it first, or fix the pin. |
| The job waits for approval | The `npm-release` environment has required reviewers. Approve it. |
| A package was skipped with "first publish is manual" | It is not on npm yet. Follow the steps above. |

Re-running the workflow is safe: a version that is already on npm is skipped.

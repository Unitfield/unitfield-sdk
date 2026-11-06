# Unitfield SDKs

Public repository with the npm packages `@unitfield/sdk`, `@unitfield/react` and `create-unitfield-site` (`packages/`), runnable `examples/` and the developer documentation (`docs/`, `apps/developers`). Node 24 and pnpm 11; see `README.md` and `RELEASING.md`. Everything here is public: never commit internal URLs, credentials or customer data.

## Branches, releases and configuration

The shared rules are in the workspace [`../AGENTS.md`](../AGENTS.md); read them first. In short: `main` is the only long-lived branch, nobody pushes to it directly, and every change is a branch `<type>/<slug>` made in a worktree under `../wt/`, a pull request into `main`, a squash merge once CI is green, a check on staging, and (after the owner agrees) the infra `promote` workflow for production.

- **CI and release:** `.github/workflows/ci.yml` (typecheck, tests, build, docs check) runs on pull requests and `main`; `developers-site.yml` builds the developer site from `apps/developers`; `release-sdk.yml` (workflow `Release packages`) publishes every package whose version npm does not have yet when a version bump merges to `main` (npm trusted publishing; keep the file name, see `RELEASING.md`). Nothing here ships as a service image.
- **Tests:** `pnpm typecheck`, `pnpm test`, `pnpm test:scripts`, `pnpm docs:check`, `pnpm build`.
- **Sibling pins:** `unitfield-siblings.json` pins the dashboard (OpenAPI/UI inputs for the developer site) to a full commit SHA. Bump with `node scripts/siblings/bump.mjs` (`--sha <sha>` for an exact commit) in a branch and open a PR; `--check` verifies the pins.
- **Settings and secrets** live in `unitfield-infra`, not here: none of this repository's code runs as a service, so there is nothing in `services/`. Never put real keys in examples or docs; use obviously fake test keys. A new setting is this repository's code change plus the template line, schema entry and value in unitfield-infra (`scripts/check <env> --deploy` must pass). Never commit secrets or `.env` files with values.


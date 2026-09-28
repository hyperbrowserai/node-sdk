# Node SDK Agent Guide

## Cursor Cloud specific instructions

### Dev commands

- `yarn install` — install dependencies (also runs `yarn build` via `prepare`)
- `yarn build` — compile TypeScript
- `yarn lint` — ESLint
- `yarn test` — unit + local integration tests; no API credentials or Docker daemon needed
- `yarn test:unit` / `yarn test:integration` — run either local test group
- `yarn test:e2e` — live API tests; requires `HYPERBROWSER_API_KEY`
- `yarn format` — Prettier

### Gotchas

- `yarn install` triggers the `prepare` script which runs `yarn build`. If the
  build fails on install, check for TypeScript errors in `src/`.
- `vitest.config.ts` defines unit, integration, and e2e projects. The default
  selection (including watch mode) runs only unit and integration tests.
- Only live tests in `tests/e2e/` load env files and require a running
  Hyperbrowser API and a valid `HYPERBROWSER_API_KEY`.

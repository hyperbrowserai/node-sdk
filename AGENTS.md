# Node SDK Agent Guide

## Cursor Cloud specific instructions

### Dev commands

- `yarn install` — install dependencies (also runs `yarn build` via `prepare`)
- `yarn build` — compile TypeScript
- `yarn lint` — ESLint
- `yarn test` — vitest (unit + contract tests pass without a running API; e2e/integration tests need `HYPERBROWSER_API_KEY`)
- `yarn format` — Prettier

### Gotchas

- `yarn install` triggers the `prepare` script which runs `yarn build`. If the
  build fails on install, check for TypeScript errors in `src/`.
- Integration and e2e tests (`tests/sandbox/e2e/`, `tests/integration/`) require
  a running Hyperbrowser API and a valid `HYPERBROWSER_API_KEY`. Without these,
  only the contract/unit tests in the suite will pass; the e2e tests fail with
  `ECONNREFUSED`.

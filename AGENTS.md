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

<!-- agent-access:begin (synced by .agents/sync-kit; edit the kit, not this section) -->

## Cloud agent access (Cursor and Devin)

Cloud agent VMs have keyless access to GCP, AWS and the company tailnet
through short-lived platform OIDC tokens (`.agents/README.md`):

- gcloud: configuration `coding-agents`; check with `gcloud auth list`. If
  another configuration is active, add `--configuration=coding-agents`.
- aws: profile `coding-agents`, read-only; check with
  `aws sts get-caller-identity`. If `AWS_PROFILE` is not set in the shell,
  add `--profile coding-agents`.
- tailscale: the VM joins the tailnet on its own and rejoins after sleeping.
  If `tailscale status` shows no connection, run `agent-tailscale-up`.
  `agent-tailscale-devices` lists the tailnet's devices.

On Cursor, reach tailnet hosts through the local proxies:

```bash
export ALL_PROXY=socks5h://localhost:1055/ HTTPS_PROXY=http://localhost:1054/ HTTP_PROXY=http://localhost:1054/
```

<!-- agent-access:end -->

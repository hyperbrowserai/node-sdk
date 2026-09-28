# Sandbox parity implementation

Reference: Python SDK 1.9.1 (`c36d3d9`), with existing Node runtime-class support
preserved. Scope is sandbox functionality; browser/web/agent additions are deferred.

| Plan area | Implemented | Verification |
| --- | --- | --- |
| G1 processes | Start-time SSE collection; complete output or structured failure; limits; replay; local waits; disconnect and AbortSignal | Collection fixtures and real HTTP lifetime/heartbeat/cancellation tests |
| G2 image builds | Remote/local Dockerfile and Docker-image imports; resources; source selection/ignore rules; deterministic packaging; selective uploads; reuse; cleanup | Python/Go golden fixtures, Docker-save fixtures, upload/packaging failure tests, real local Docker build/import |
| G3 image resolution | Public fingerprints and image names; expected identity checks; ready lookup and compatible build joining; independent waits | Identity/resolution fixtures, deadline and independent-cancellation tests |
| G4 transport | Control GET retries; request context; body deadlines; stream idle budgets; empty bodies; response cleanup; one-time auth refresh; consumed uploads rejected; environment base URL | Real HTTP fault tests and existing routing/proxy contracts |
| G5 files/watches | True upload/download streaming; run-as; content length; public watch/getWatch/status/refresh/event/done; aliases and overwrite | 20 MiB pull-based upload, early download cancellation, real WebSocket resume/done/cancellation, operation payload tests |
| G6 lifecycle | Snapshot startup; runtime sessions; launch validation; exposure fallback; sandbox/volume numeric and nullable fields; gVisor declarations | Lifecycle/wire/type fixtures |
| G7 delivery | Public root/subpath exports; fresh packed consumer; local/live test separation; PR/merge quality matrix; migration docs | Build, source/test typecheck, full-source lint, local tests, installed CJS/ESM/types |

## Intentional Node equivalents

- Promises and camelCase options replace separate Python sync/async clients.
- True downloads return async generators of `Buffer`; uploads accept readable /
  iterable chunks. Existing buffered read/write overloads remain supported.
- Watch status uses wire-format millisecond timestamps; existing file metadata
  exposes `Date`. Control-plane date strings remain strings.
- Optional sandbox and volume numeric fields normalize numeric strings and empty
  strings; nullable metadata is represented in public types. Tokens and token
  expiry normalize missing/empty values to `null`; exposed ports default to `[]`.
- Python-only Pydantic/legacy-object compatibility is not copied. JavaScript
  launch inputs are validated at runtime; Node's runtime-class API is retained.
- Resource owners release their own connections: process disconnect/AbortSignal,
  file iterator completion/cancellation, watch iteration/stop, terminal close.
- Image wait cancellation affects that caller, not an accepted shared build.
  Context identities do not resolve mutable external dependencies.

## Migration notes

- Commands now require a receiver supporting streamed `POST /sandbox/processes`.
  An older receiver can have started the command before returning JSON; the SDK
  reports `streaming_not_supported` without replaying that operation.
- Processes started by this client replay collected output locally. To test or use
  the receiver's limited replay window, obtain a separate handle through `get()`.
- Local process wait expiry reports `wait_timeout`, without a fabricated HTTP
  status. Incomplete retained results are rejected instead of returned as success.
- Invalid launch sources/resources are rejected locally. Some formerly overstated
  response types now explicitly admit missing/null values.
- Default tests are local. Live tests require explicit `test:e2e` invocation.
- Release this as the next minor SDK version: command receiver requirements,
  nullable response types, local launch validation, and the documented Node
  baseline can require consumer changes. Version bump and publication remain
  part of the release process.

## Release validation

The local Docker validation built a scratch image, inspected its platform digest,
parsed real OCI descriptor/config/layers from Docker save, preserved PATH / command /
working directory, and removed its temporary image and artifacts.

Live Hyperbrowser build → image readiness → volume mount → sandbox launch →
streamed command → file/watch → exposure → snapshot/restore → cleanup is covered
by `tests/sandbox/e2e/parity-smoke.test.ts`. This must pass on the intended deployment
before release; local mocks and Docker verification do not establish receiver rollout.
On 2026-09-28 both dev and production passed remote Dockerfile submission/upload/completion,
ready-image reuse, sandbox launch, runtime-session refresh, complete 512 KiB command
output, 20 MiB streaming upload/download with checksum comparison, watch resume/done,
authenticated exposure, snapshot restore, and cleanup. Dev used the existing runtime
proxy override to reach the local HTTP proxy; production used the public API/runtime
endpoints. Each environment also passed 58 existing live file/process/terminal/
exposure/sudo tests (59 live tests including the smoke). Production authentication
used the CLI OAuth session to create a temporary sandbox-scoped SDK API key, which
was revoked after testing.

Both signed-in teams reject volume creation because `sandbox_volumes` is disabled,
so the passing smoke runs explicitly used `HYPERBROWSER_SMOKE_VOLUMES=0`. Volume
behavior is covered by local wire/type tests; live volume mounting remains a
release gate on a team with that feature enabled.

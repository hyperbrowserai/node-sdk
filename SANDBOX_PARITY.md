# Sandbox parity implementation

Reference: Python SDK 1.9.1 (`c36d3d9`), with existing Node runtime-class support
preserved. Scope is sandbox functionality; browser/web/agent additions are deferred.

This checklist records implementation and verification. The detailed
[conformance audit](SANDBOX_CONFORMANCE.md) maps 194 Python test functions to Node
coverage, intentional language differences, or deferred scope. It does not claim
exhaustive branch coverage or correctness for every possible input.

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

On 2026-09-28, 646 local tests passed, along with source/test typechecking,
full-source lint, and fresh packed-package CommonJS, ESM, subpath export and
TypeScript consumer checks. CI runs the same checks on Linux with Node
20.20.2/22.22.1/24.15.0 and macOS 14 with Node 24.15.0.

The conformance suite uses regenerated results from the actual pinned Python code:
79 ignore patterns, 10 invalid patterns, 19 Dockerfile analyses, 26 image identities,
32 filesystem fingerprints, 20 Docker initialization cases, 83 process event cases,
53 HTTP request/response scenarios, and 18 SSE streams. Both Python sync and async
clients produce the same expected HTTP/SSE results. Additional real HTTP,
WebSocket and subprocess tests exercise retries, timeouts, cancellation,
concurrent build joining, malformed archives, resource forwarding and cleanup.

The local Docker validation used Docker 29.4.2 to build a scratch image, inspect its
platform digest, parse real OCI descriptors/config/layers from Docker save, preserve
PATH / command / working directory, and remove temporary images and artifacts.

All 84 live tests across nine suites passed on both dev and production after the
source fixes. These include lifecycle/list/resource sizing, files/processes/terminals,
exposure/sudo, and the complete remote build → ready-image reuse → sandbox launch →
auth refresh → streamed command → 20 MiB checksum-verified transfer → watch
resume/done → authenticated exposure → snapshot/restore → cleanup workflow.
Dev used the existing runtime proxy override to reach the local HTTP proxy;
production used public API/runtime endpoints. Production authentication used the
CLI OAuth session to create a temporary sandbox-scoped SDK key, revoked after testing.

## Scope limits

- Live volume tests were explicitly skipped at the user's request because the test
  teams have `sandbox_volumes` disabled. Local volume wire/type contracts pass;
  live volume creation/mounting is excluded from this signoff.
- Native language differences, including TypeScript declarations versus Python's
  Pydantic runtime model validation, are documented in the conformance audit.
- Windows and Docker versions other than the recorded local version remain
  unverified. The macOS CI job exercises fake Docker and filesystem behavior,
  not a live Docker daemon.
- Browser/web/agent feature parity is outside this sandbox work.

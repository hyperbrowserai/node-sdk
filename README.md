# Hyperbrowser Node SDK

Checkout the full documentation [here](https://hyperbrowser.ai/docs)

## Installation

Hyperbrowser can be installed via npm by running:

```bash
npm install @hyperbrowser/sdk
```

or

```bash
yarn add @hyperbrowser/sdk
```

## WebMCP page tools

Create a session with `enableWebMcp: true` (default: false), then navigate to a page
that exposes WebMCP tools using Playwright or Puppeteer. With that session open:

```typescript
const discovery = await client.sessions.webmcp.listTools(session.id);
// Select a tool using its name, source page/frame, and input schema.
const tool = discovery.tools.find((tool) => tool.name === "search");
if (!tool) throw new Error("The page has no search tool");
const result = await client.sessions.webmcp.invoke(session.id, {
  toolRef: tool.toolRef,
  input: { query: "flights to Tokyo" }, // Match the selected tool's schema.
});
console.log(result.status, result.output);
```

For long-running tools or forms awaiting human submission, use
`sessions.webmcp.start(sessionId, params)`, then
`sessions.webmcp.getResult(sessionId, invocationId, { waitSeconds: 30 })` until the
status is terminal. `sessions.webmcp.cancel(sessionId, invocationId)` requests
best-effort cancellation. Blocking invocation defaults to 60 seconds (maximum
120); `start` defaults to 300 seconds (maximum 3,600) via `timeoutSeconds`.

Discover tools again after navigation. Invocations never automatically retry;
losing a response can leave an unknown outcome. Handles are ephemeral and
terminal results expire after 10 minutes or earlier eviction. Check result
status and truncation metadata before using output. Public types, including
`WebMCPTool`, `WebMCPInvocation`, and the request types, are exported from
`@hyperbrowser/sdk/types`.

See the [WebMCP guide](https://hyperbrowser.ai/docs/sessions/webmcp) for complete
examples, cancellation behavior, human submission, and limits.

## Web Bot Auth

A session can sign its requests with Web Bot Auth so websites can verify that they
come from Hyperbrowser. Web Bot Auth is enabled for teams on request.

```typescript
const session = await client.sessions.create({ webBotAuth: true });
console.log(session.launchState?.webBotAuth?.signatureAgent); // "https://www.hyperbrowser.ai"

// Sign only requests to these hosts and their subdomains:
await client.sessions.create({ webBotAuth: { onlyDomains: ["example.com"] } });
```

Agent tasks accept `webBotAuth` in `sessionOptions`; scrape, crawl, and extract
jobs do not. It cannot be combined with `useUltraStealth` or `startFromSnapshot`.
See the [Web Bot Auth guide](https://hyperbrowser.ai/docs/sessions/web-bot-auth).

## Proxy routes

`proxyRoutes` sends some hosts' traffic straight out instead of through the
session's proxy, or the other way round. The first route that matches a host
decides; hosts that no route matches use the proxy. Proxy routes require
`useProxy` and are enabled for teams on request.

```typescript
const session = await client.sessions.create({
  useProxy: true,
  proxyRoutes: [
    { match: "api.example.com", proxy: "default" }, // stays on the proxy
    { match: ["*.example.com", "cdn.example.net"], proxy: "direct" },
  ],
});
```

A pattern is a hostname, `*.example.com` (its subdomains, not `example.com` itself),
or `*` (every host). Proxy routes only apply to `sessions.create` and cannot be
combined with `allowInternetAccess: false`, `allowOut`, or `denyOut`. See the
[proxy routes guide](https://hyperbrowser.ai/docs/sessions/proxy-routes).

## Secrets, vaults and credential fill

Secrets are encrypted locally before upload; after that, neither the API, your
code, nor an LLM ever sees the values. A login is two secrets (or three, with a
TOTP seed), each limited to the origins it may be filled into, grouped in a
**vault** that names them as entries such as `USERNAME` and `PASSWORD`.

```typescript
import { chromium } from "playwright-core";
import { Hyperbrowser } from "@hyperbrowser/sdk";

const client = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY });

// Once: the secrets, fillable only on their allowed origins, and a vault.
const allowedOrigins = ["https://github.com"];
await client.secrets.create({ name: "github-username", value: "ada", allowedOrigins });
await client.secrets.create({
  name: "github-password",
  value: process.env.GITHUB_PASSWORD!,
  allowedOrigins,
});
// A TOTP secret holds the seed (base32 or an otpauth://totp/ URI); fills and
// sandboxes get its current code.
await client.secrets.create({
  name: "github-otp",
  type: "totp",
  value: process.env.GITHUB_TOTP_SEED!,
  allowedOrigins,
});
await client.vaults.create({
  name: "github-login",
  entries: {
    USERNAME: { name: "github-username" },
    PASSWORD: { name: "github-password" },
    OTP: { name: "github-otp" },
  },
});

// Secrets can only be attached when the session is created.
const session = await client.sessions.create({ credentials: [{ vault: "github-login" }] });
try {
  const browser = await chromium.connectOverCDP(session.wsEndpoint);
  const page = await browser.contexts()[0].newPage();
  await page.goto("https://github.com/login");

  // Fill only types into the inputs; it never submits.
  const result = await client.sessions.credentials.fill(session.id, {
    vault: "github-login",
    fields: [
      { field: "USERNAME", selector: "#login_field" },
      { field: "PASSWORD", selector: "#password" },
    ],
  });
  if (result.fields.every(({ outcome }) => outcome === "filled")) {
    await page.click('input[type="submit"]');
  } else {
    console.log(result.fields); // e.g. [{ selector: "#password", outcome: "not_found", ... }]
  }
  // On the next screen: { field: "OTP", selector: "#app_totp" } types the current code.
} finally {
  await client.sessions.stop(session.id);
}
```

- `credentials` takes up to 20 items: a secret's name (or `{ secret }`),
  `{ vault }` for the secrets a stored vault names when the session is created,
  or `{ onePassword }` for an `op_token` secret (see
  [Fill from 1Password](#fill-from-1password)); the API validates names and limits.
  `session.credentials` lists the attached secrets as `{ id, name }`. Fill a
  single secret with `{ credential: "github-password", fields: [{ selector }] }`;
  with `vault`, each field names its entry in `field`.
- Each input reports an `outcome`: `filled`, `not_found` (no input matched),
  `ambiguous` (several visible inputs matched), `not_editable` (disabled,
  read-only, hidden or not a text input), or `not_accepted` (the page didn't
  keep the value, e.g. `maxlength`), plus its `secretId` and `version`, the
  vault `field`, and for TOTP inputs `expiresAt`. Submit only when the inputs
  you need are `filled`. Fill is safe to retry; it is not retried automatically.
- Without `pageId`, fill considers the tabs whose URL starts with `pageUrl`
  (all tabs when it's not given). If one is left, that's the target. If several
  are left, it prefers the tabs on an origin every secret allows (not for an
  iframe fill, whose tab is usually on another origin), then the visible one
  among them; if more than one still qualifies, it fails with
  `CREDENTIAL_PAGE_AMBIGUOUS` and the candidates in
  `error.details.details.pages` (`{ pageId, url, title }`). The chosen tab's
  origin is then checked: on any other origin nothing is typed and the fill
  fails with `CREDENTIAL_ORIGIN_NOT_ALLOWED`.
  Under Playwright every tab reports as visible, so pass `pageUrl` or the
  page's target ID: `(await page.context().newCDPSession(page)).send("Target.getTargetInfo")`
  (in Puppeteer, `page.createCDPSession()`) returns it as `targetInfo.targetId`.
  For a form inside an iframe, pass `frameUrl` (a URL prefix).
- Origins are `scheme://host[:port]`, 1-20 per secret; a leading `*.` matches
  subdomains only (of a domain such as `example.com`, not `*.com` or an IP
  address), and `http:` is accepted only for `localhost`, `127.0.0.1` and
  `[::1]`. The API validates and normalizes them.
  `setAllowedOrigins(secret, origins)` replaces them and `null`
  clears them (the secret then can't be filled). `list({ type })` filters by
  type.
- Values are checked locally before anything is sent (`invalid_secret_value`):
  1 byte to 32 KiB of UTF-8 without NUL, and for TOTP a base32 seed (spaces,
  hyphens, line breaks, lowercase and trailing `=` padding are fine) or an `otpauth://totp/`
  URI with `secret` and optionally `algorithm` (SHA1, SHA256, SHA512), `digits`
  (6 or 8) and `period` (1-300). HOTP is not supported, and a seed whose
  length is 1, 3 or 6 characters past a multiple of 8 is refused as
  incompletely copied. Seeds under 10 bytes (16 characters) are accepted, but
  check that a short one was copied whole. `addVersion` applies the rules of
  the secret's type. Fill, origin, vault-entry and 1Password policy errors come
  from the API; inspect the error's status, code (when supplied) and details.
- Session create needs the API key scope `secrets.use`; fill also needs
  `browser.sessions.update`. Attaching secrets runs the session on Firecracker
  with Chrome's password manager off. Fills are recorded in the session event
  log as `credential_filled` and `credential_fill_refused`.

### Vaults

Vaults also deliver environment variables to sandboxes (see
[Sandboxes](#sandboxes)). A vault names stored secrets and holds no values
itself.

```typescript
await client.vaults.create({
  name: "prod-db",
  entries: {
    DB_USER: { name: "db-user" },
    DB_PASS: { name: "db-pass", version: 2 },
  },
});
await client.vaults.update("prod-db", {
  entries: { DB_OTP: { name: "db-otp" }, DB_USER: null },
});
const vault = await client.vaults.get("prod-db"); // entries include each secret's ID
const { vaults } = await client.vaults.list({ search: "prod" });
await client.vaults.delete("prod-db");
```

- Vault methods take a vault's ID or exact name. Entry names are environment
  variable names (`^[A-Za-z_][A-Za-z0-9_]*$`, at most 256 characters), and
  entries are `{ name, version? }` (an omitted version, or `"latest"`, follows
  the latest). `update` takes a description or entries; an entry set to `null`
  is removed and entries not given are kept. Limits: 100 vaults per team, 32
  entries per vault. Vaults use the `secrets.read` and `secrets.manage`
  scopes, like secrets.
- A secret a vault uses can't be deleted (`SECRET_IN_USE`), nor a version a
  vault pins (`SECRET_VERSION_IN_USE`).

### 1Password

Sandbox processes, and an image's startup command, can read fields from a
1Password vault when they start: pass `onePassword` to `processes.start`,
`processes.exec` or `sandboxes.create`. It signs in with a service account
token stored as an `op_token` secret. Tokens start with `ops_`, but the SDK
doesn't refuse other values. `op_token` secrets are never environment
variables or typed into pages themselves, so they take no `allowedOrigins`.
Nothing about the fields is stored. Browser sessions can fill 1Password
fields too: see [Fill from 1Password](#fill-from-1password).

```typescript
await client.secrets.create({
  name: "op-token",
  type: "op_token",
  value: process.env.OP_SERVICE_ACCOUNT_TOKEN!,
});

const onePassword = {
  token: "op-token",
  vault: "Engineering",
  fields: {
    DB_PASS: { item: "Postgres", section: "prod", field: "password" },
    DB_OTP: { item: "Postgres", field: "one-time password?attribute=totp" },
  },
};
const sandbox = await client.sandboxes.create({ imageName: "my-image", onePassword });
const migrate = await sandbox.exec("node migrate.js", {
  onePassword,
  secrets: { API_KEY: "provider-key" },
});
const worker = await sandbox.processes.start("node worker.js", { onePassword });
console.log(worker.secrets); // [{ env: "DB_PASS", reference: "op://Engineering/Postgres/prod/password", tokenSecret: "op-token", source: { type: "onePassword" } }, ...]
```

- `token` names the `op_token` secret (its latest version is used), `vault`
  is the 1Password vault's name or ID, and `fields` maps 1 to 32 environment
  variables to `{ item, section?, field }`. Names and IDs are 1-256
  characters without `/` or `?`, control or format characters, and not `.` or
  `..`; the field may end with a query such as `?attribute=totp` or
  `?ssh-format=openssh`. The full `op://<vault>/<item>/[<section>/]<field>`
  reference is at most 512 bytes. The API validates these rules and rejects
  unknown members.
- A 1Password field's variable must come from it alone: `secrets` or `env`
  setting it too, including a `vault` entry, is refused by the API
  (`SECRET_SOURCES_INVALID`). Together with `vault` and
  `secrets` it delivers at most 32 variables.
- Requirements are those of `secrets`: the `secrets.use` scope, and for
  `sandboxes.create` an image launch with a startup command on Firecracker.

### Fill from 1Password

Attach the `op_token` secret when the session is created, then fill fields
read with it. The request names the 1Password vault, each input's field as
`ref`, and the origins the values may be typed on: nothing stored says where
a 1Password value belongs.

```typescript
const session = await client.sessions.create({ credentials: [{ onePassword: "op-token" }] });
// ... open https://www.scrapingcourse.com/login in the session ...
const result = await client.sessions.credentials.fill(session.id, {
  onePassword: {
    token: "op-token",
    vault: "Dev Vault for Testing",
    allowedOrigins: ["https://www.scrapingcourse.com"],
  },
  fields: [
    { selector: "#email", ref: { item: "scrapingcourse login", field: "username" } },
    { selector: "#password", ref: { item: "scrapingcourse login", field: "password" } },
  ],
  pageUrl: "https://www.scrapingcourse.com/login",
});
console.log(result.fields);
// [{ selector: "#email", outcome: "filled", secretId: "<op-token's ID>", version: 1,
//    reference: "op://Dev Vault for Testing/scrapingcourse login/username" }, ...]
```

- Pass exactly one of `credential`, `vault` and `onePassword`. With
  `onePassword` every field needs `ref` (`{ item, section?, field }`) and none
  may have `field`; without it, none may have `ref`.
- `token` names an `op_token` secret attached as `{ onePassword }` (its
  latest version is used), and `vault` is the 1Password vault's name or ID.
  `ref` and `vault` follow the rules of sandbox `onePassword` fields above,
  so `{ field: "one-time password?attribute=otp" }` types the current code,
  and each `op://` reference is at most 512 bytes.
- `allowedOrigins` is required: 1-20 origins with the same rules as a
  secret's. A page on any other origin is refused with
  `CREDENTIAL_ORIGIN_NOT_ALLOWED`, and tab choice treats these as the
  allowed origins.
- The API validates these rules and rejects unknown members of `onePassword`
  and `ref`, along with the usual 1-16 fields and unique selectors.
- The result has no top-level `version`. Each field's `secretId` and
  `version` are the `op_token`'s, and `reference` is the field that was read.
- A missing item or field fails with `SECRET_ONEPASSWORD_REFERENCE_FAILED`
  and fills nothing; `error.details.details.selectors` lists the inputs and
  `reasons` says why, by selector. Without the token attached it is
  `CREDENTIAL_NOT_ATTACHED`; a host that can't read 1Password for browsers
  gives `CREDENTIAL_VALUE_UNSUPPORTED`.
- An `op_token` is still refused as a plain credential (`"op-token"` or
  `{ secret: "op-token" }` at create, or `credential` in a fill) with
  `SECRET_TYPE_MISMATCH`.
- The session event log records these fills with the token's name as
  `onePasswordToken` and its `secretId` in the metadata.
- `CredentialFillTool` can't fill from 1Password; call
  `sessions.credentials.fill` directly (see [Use with LLM SDKs](#use-with-llm-sdks)).

### Errors

API errors are `HyperbrowserError`s with `statusCode`, `code` and `retryable`
(the API's own flag when it sends one); `details` is the API's error body, whose
own `details` holds the specifics (such as `error.details.details.origin`).

| Code | Meaning |
|---|---|
| `CREDENTIAL_NOT_ATTACHED` | The secret, vault or 1Password token wasn't attached to the session, or a vault entry was repointed since. |
| `CREDENTIAL_ORIGIN_NOT_ALLOWED` | The page isn't on the secret's allowed origins (for 1Password, the request's); nothing was typed. |
| `CREDENTIAL_NOT_READY` | The secret has no allowed origins or no value. |
| `CREDENTIAL_PAGE_NOT_FOUND`, `CREDENTIAL_FRAME_NOT_FOUND` | No tab or iframe matched. |
| `CREDENTIAL_PAGE_AMBIGUOUS`, `CREDENTIAL_FRAME_AMBIGUOUS` | Several matched; pass `pageId` or `pageUrl` (`details.pages`), or a longer `frameUrl`. |
| `CREDENTIAL_FILL_TIMEOUT` | Retryable. |
| `CREDENTIAL_FILL_FAILED` | The fill failed in the browser. |
| `CREDENTIAL_FILL_UNSUPPORTED`, `CREDENTIAL_VALUE_UNSUPPORTED` | The browser image predates fill, or the host can't resolve this value type (such as 1Password). |
| `CREDENTIALS_UNSUPPORTED_RUNTIME`, `CREDENTIALS_SNAPSHOT_PASSWORD_MANAGER_ENABLED` | Session create: secrets need Firecracker, and a snapshot taken with the password manager off. |
| `SESSION_NOT_ACTIVE` | The session has stopped. |
| `SECRET_NOT_FOUND`, `SECRET_VERSION_NOT_FOUND` | |
| `SECRET_TYPE_MISMATCH` | A secret used where its type can't be, such as an `op_token` in `secrets`, a vault entry, or attached or filled as a plain credential, or another type as a `onePassword` token. |
| `SECRET_METADATA_INVALID` | A bad allowed origin, or allowed origins on an `op_token`. |
| `SECRET_VALUE_INVALID` | The stored value is unusable (such as a bad TOTP seed); add a new version. |
| `SECRET_IN_USE`, `SECRET_VERSION_IN_USE`, `SECRET_VERSION_IS_LATEST` | Delete refused: a vault uses the secret or pins the version, or the version is the latest. An `op_token` is never in use. |
| `SECRET_TOTP_UNSUPPORTED`, `SECRET_ONEPASSWORD_UNSUPPORTED` | The sandbox host predates TOTP or 1Password, so nothing started. Retryable on sandbox create (another host), not on a process start. |
| `SECRET_ONEPASSWORD_REFERENCE_FAILED` | A 1Password field couldn't be read; `details` names the variables (`envs`), or on a fill the inputs (`selectors`), with `reasons` for each. |
| `SECRET_ONEPASSWORD_AUTH_FAILED` | 1Password refused the token, or the token is malformed or signs in somewhere other than `1password.com`, `.ca` or `.eu` (or their subdomains). |
| `SECRET_ONEPASSWORD_RATE_LIMITED`, `SECRET_ONEPASSWORD_FAILED` | Retryable. |
| `SECRET_SOURCES_INVALID` | Bad `vault`/`onePassword`/`secrets`/`env` combination, such as a `onePassword` variable also set by the vault, more than 32 variables, or a vault with no entries. |
| `VAULT_NOT_FOUND`, `VAULT_ENTRY_NOT_FOUND` | |
| `VAULT_NAME_TAKEN`, `VAULT_LIMIT_REACHED`, `VAULT_ENTRY_LIMIT_REACHED` | |
| `SECRETS_FEATURE_DISABLED` | The team doesn't have secrets enabled. |

### Use with LLM SDKs

`CredentialFillTool` from `@hyperbrowser/sdk/tools` exposes fill as a
`fill_credential` tool. Your application binds the session ID; the model picks
only a `credential` or a `vault` (with a `field` per input), the selectors and,
when needed, `page_id`, `page_url` or `frame_url`. In OpenAI's strict mode every
property is required, so unused ones are `null`. Results and errors come back as
JSON text and never contain values; an error's `details` there is the API's own
details object (such as `pages`). Fill doesn't submit, so give the model your
other browser tools as well (to click the login button, for example).

The tool has no `onePassword`: a 1Password fill names the origins its values
may be typed on, and a model shouldn't choose those. Call
`sessions.credentials.fill` directly for [1Password](#fill-from-1password).

OpenAI (Chat Completions):

```typescript
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { CredentialFillTool } from "@hyperbrowser/sdk/tools";

const openai = new OpenAI();
const messages: ChatCompletionMessageParam[] = [
  { role: "user", content: "Sign in to GitHub with the github-login vault." },
];
for (;;) {
  const completion = await openai.chat.completions.create({
    model: "gpt-5",
    messages,
    tools: [CredentialFillTool.openaiToolDefinition /* , your browser tools */],
  });
  const message = completion.choices[0].message;
  messages.push(message);
  if (!message.tool_calls?.length) break;
  for (const call of message.tool_calls) {
    if (call.type !== "function" || call.function.name !== "fill_credential") continue;
    const content = await CredentialFillTool.runnable(
      client,
      session.id,
      JSON.parse(call.function.arguments)
    );
    messages.push({ role: "tool", tool_call_id: call.id, content });
  }
}
```

Anthropic (Messages):

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { CredentialFillTool, type CredentialFillToolParams } from "@hyperbrowser/sdk/tools";

const anthropic = new Anthropic();
const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "Sign in to GitHub with the github-login vault." },
];
for (;;) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 4096,
    tools: [CredentialFillTool.anthropicToolDefinition /* , your browser tools */],
    messages,
  });
  messages.push({ role: "assistant", content: response.content });
  if (response.stop_reason !== "tool_use") break;
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const block of response.content) {
    if (block.type !== "tool_use" || block.name !== "fill_credential") continue;
    const content = await CredentialFillTool.runnable(
      client,
      session.id,
      block.input as CredentialFillToolParams
    );
    results.push({ type: "tool_result", tool_use_id: block.id, content });
  }
  messages.push({ role: "user", content: results });
}
```

Gemini (`@google/genai`):

```typescript
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { CredentialFillTool, type CredentialFillToolParams } from "@hyperbrowser/sdk/tools";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const contents: Content[] = [
  { role: "user", parts: [{ text: "Sign in to GitHub with the github-login vault." }] },
];
for (;;) {
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents,
    config: {
      tools: [{ functionDeclarations: [CredentialFillTool.geminiToolDefinition] }],
    },
  });
  const calls = response.functionCalls ?? [];
  if (calls.length === 0) break;
  contents.push(response.candidates![0].content!);
  const parts: Part[] = [];
  for (const call of calls) {
    if (call.name !== "fill_credential") continue;
    const output = await CredentialFillTool.runnable(
      client,
      session.id,
      call.args as unknown as CredentialFillToolParams
    );
    parts.push({
      functionResponse: { id: call.id, name: call.name, response: JSON.parse(output) },
    });
  }
  contents.push({ role: "user", parts });
}
```

`FILL_CREDENTIAL_TOOL_OPENAI`, `FILL_CREDENTIAL_TOOL_ANTHROPIC` and
`FILL_CREDENTIAL_TOOL_GEMINI` are also exported. `CredentialFillTool` provides
`geminiToolDefinition` for the credential-fill tool.

## Usage

### Playwright

```typescript
import { chromium } from "playwright-core";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { config } from "dotenv";

config();

const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
});

const main = async () => {
  const session = await client.sessions.create();

  try {
    const browser = await chromium.connectOverCDP(session.wsEndpoint);

    const defaultContext = browser.contexts()[0];
    const page = await defaultContext.newPage();

    // Navigate to a website
    console.log("Navigating to Hacker News...");
    await page.goto("https://news.ycombinator.com/");
    const pageTitle = await page.title();
    console.log("Page 1:", pageTitle);
    await page.evaluate(() => {
      console.log("Page 1:", document.title);
    });

    await page.goto("https://example.com");
    console.log("Page 2:", await page.title());
    await page.evaluate(() => {
      console.log("Page 2:", document.title);
    });

    await page.goto("https://apple.com");
    console.log("Page 3:", await page.title());
    await page.evaluate(() => {
      console.log("Page 3:", document.title);
    });

    await page.goto("https://google.com");
    console.log("Page 4:", await page.title());
    await page.evaluate(() => {
      console.log("Page 4:", document.title);
    });
  } catch (err) {
    console.error(`Encountered error: ${err}`);
  } finally {
    await client.sessions.stop(session.id);
  }
};

main();
```

### Puppeteer

```typescript
import { connect } from "puppeteer-core";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { config } from "dotenv";

config();

const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
});

const main = async () => {
  const session = await client.sessions.create();

  try {
    const browser = await connect({
      browserWSEndpoint: session.wsEndpoint,
      defaultViewport: null,
    });

    const [page] = await browser.pages();

    // Navigate to a website
    console.log("Navigating to Hacker News...");
    await page.goto("https://news.ycombinator.com/");
    const pageTitle = await page.title();
    console.log("Page 1:", pageTitle);
    await page.evaluate(() => {
      console.log("Page 1:", document.title);
    });

    await page.goto("https://example.com");
    console.log("Page 2:", await page.title());
    await page.evaluate(() => {
      console.log("Page 2:", document.title);
    });

    await page.goto("https://apple.com");
    console.log("Page 3:", await page.title());
    await page.evaluate(() => {
      console.log("Page 3:", document.title);
    });

    await page.goto("https://google.com");
    console.log("Page 4:", await page.title());
    await page.evaluate(() => {
      console.log("Page 4:", document.title);
    });
  } catch (err) {
    console.error(`Encountered error: ${err}`);
  } finally {
    await client.sessions.stop(session.id);
  }
};

main();
```

### Sandboxes

For local sandbox development, you can explicitly route sandbox runtime traffic
through a regional proxy override:

```typescript
const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
  runtimeProxyOverride: process.env.REGIONAL_PROXY_DEV_HOST,
});
```

```typescript
import { Hyperbrowser } from "@hyperbrowser/sdk";

const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
});

const main = async () => {
  const sandbox = await client.sandboxes.create({
    imageName: "ubuntu-24-node",
    region: "us-west",
    cpu: 4,
    memoryMiB: 4096,
    diskMiB: 8192,
  });

  // Provide exactly one launch source:
  // snapshotName or imageName.
  // snapshotId requires snapshotName and imageId requires imageName.
  // cpu, memoryMiB, and diskMiB are only available for image launches.

  const version = await sandbox.exec("node -v");
  console.log(version.stdout.trim());

  await sandbox.files.writeText("/tmp/hello.txt", "hello from sdk");

  const content = await sandbox.files.readText("/tmp/hello.txt");
  console.log(content);

  const watch = await sandbox.files.watchDir(
    "/tmp",
    (event) => {
      if (event.type === "write") {
        console.log(event.name);
      }
    },
    {
      recursive: false,
    }
  );

  await sandbox.files.writeText("/tmp/watch-demo.txt", "watch me");
  await watch.stop();

  const proc = await sandbox.processes.start(
    "echo process-started && sleep 1 && echo process-finished",
    {
      runAs: "root",
    }
  });

  for await (const event of proc.stream()) {
    if (event.type === "stdout") {
      process.stdout.write(event.data);
    }
  }

  const terminal = await sandbox.terminal.create({
    command: "bash",
    cols: 120,
    rows: 30,
  });

  const connection = await terminal.attach();
  await connection.write("echo terminal-ok\n");

  for await (const event of connection.events()) {
    if (event.type === "output" && event.data.includes("terminal-ok")) {
      break;
    }
  }

  await connection.close();

  const snapshot = await sandbox.createMemorySnapshot();
  console.log(snapshot.snapshotId);

  await sandbox.stop();
};

main().catch(console.error);
```

Reconnect an existing sandbox:

```typescript
const sandbox = await client.sandboxes.connect("sandbox-id");
await sandbox.files.readText("/tmp/hello.txt");
await sandbox.stop();
```

`connect()` refreshes runtime auth and throws if the sandbox is no longer running.

Run commands and stream complete output. `exec()` and `processes.start()` open a
single streamed request and collect stdout/stderr from process start, so output is
complete even beyond the receiver's replay window. `wait()` timeouts are local and
keep collecting; `disconnect()` stops collecting without killing the process.

```typescript
const result = await sandbox.exec("npm test", {
  cwd: "/workspace",
  maxOutputBytes: 128 * 1024 * 1024, // default 64 MiB; exceeding it fails, never truncates
});
console.log(result.exitCode, result.stdout);

const proc = await sandbox.processes.start("tail -f /var/log/app.log");
try {
  await proc.wait({ timeoutSec: 5 });
} catch (error) {
  // Local wait timeout: the process is still running and output is still collected.
}
for await (const event of proc.stream()) {
  if (event.type === "stdout") process.stdout.write(event.data);
  if (event.type === "exit") console.log(event.result.exitCode);
}
proc.disconnect();
```

Build a custom sandbox image from a Dockerfile or a local Docker image. `getOrBuildImage()`
derives a content-based image name, reuses a ready image with the same identity, joins a
matching in-progress build, or creates a new one. Dockerfile builds package the effective
build context (Dockerfile sources, `.dockerignore`) and build remotely; no local Docker is
required. `dockerImage` imports a local `linux/amd64` image via the Docker CLI.

```typescript
const resolved = await client.sandboxes.getOrBuildImage({
  contextPath: "./services/api",
  dockerfile: "Dockerfile", // relative to contextPath
  imageInit: { env: { NODE_ENV: "production" }, workingDir: "/app" },
  builderCpus: 4,
  builderMemoryMiB: 8192,
  builderScratchMiB: 20480,
});
console.log(resolved.outcome, resolved.imageName, resolved.imageId); // "reused" | "joined" | "created"

const sandbox = await client.sandboxes.create({ imageName: resolved.imageName });

// Import a local Docker image instead (requires docker CLI, linux/amd64 image):
const imported = await client.sandboxes.getOrBuildImage({ dockerImage: "myorg/app:1.2.3" });

// Detached build: return immediately and poll later.
const pending = await client.sandboxes.getOrBuildImage({ contextPath: ".", wait: false });
if (pending.build) {
  const build = await client.sandboxes.waitForImageBuild(pending.build.id, {
    pollInterval: 3,
    timeout: 35 * 60,
  });
  console.log(build.status, build.imageId);
}
```

Lower-level helpers are also available: `buildImageFromDockerfile()`,
`buildImageFromDockerImage()`, `findReadyImage()`, `reuseDockerImage()`, plus the raw
`createImageBuild()` / `completeImageBuild()` / `getImageBuild()` / `listImageBuilds()` /
`cancelImageBuild()` APIs. Control-plane `GET` requests retry transient failures
(429/502/503/504 and network errors) up to three times with jittered backoff.

Create a sandbox with pre-exposed ports:

```typescript
const sandbox = await client.sandboxes.create({
  imageName: "node",
  cpu: 2,
  memoryMiB: 2048,
  diskMiB: 8192,
  exposedPorts: [{ port: 3000, auth: true }],
});

console.log(sandbox.exposedPorts[0].browserUrl);
```

Manage volumes and mount them into a sandbox:

```typescript
const volume = await client.volumes.create({ name: "project-cache" });
const volumes = await client.volumes.list();
const sameVolume = await client.volumes.get(volume.id);

const sandbox = await client.sandboxes.create({
  imageName: "node",
  mounts: {
    "/workspace/cache": {
      id: sameVolume.id,
      type: "rw",
      shared: true,
    },
  },
});

await sandbox.stop();
await client.volumes.delete(sameVolume.id);
```

Store secrets and deliver them to sandbox processes as environment variables:

```typescript
// The value is encrypted locally to the platform key; the API only receives
// the envelope, and values are never returned.
await client.secrets.create({
  name: "provider-key",
  description: "Provider API key",
  value: process.env.PROVIDER_KEY!,
});
await client.secrets.addVersion("provider-key", newValue); // next version
const secrets = await client.secrets.list({ search: "provider" });
const detail = await client.secrets.get("provider-key"); // metadata and versions

const sandbox = await client.sandboxes.create({ imageName: "node" });
const result = await sandbox.exec("node app.js", {
  secrets: { API_KEY: "provider-key", DB_URL: { name: "db-url", version: 2 } },
});

// Long-running processes report the versions they received.
const worker = await sandbox.processes.start("node worker.js", {
  secrets: { API_KEY: "provider-key" },
});
console.log(worker.secrets);

// A vault's entries as variables; `secrets` is merged over it and wins on a clash.
const migrate = await sandbox.exec("node migrate.js", {
  vault: "prod-db",
  secrets: { API_KEY: "provider-key" },
});

// Secrets for the image's startup command (image launches only).
const started = await client.sandboxes.create({
  imageName: "my-image",
  vault: "prod-db",
  secrets: { API_KEY: "provider-key" },
});
console.log(started.toJSON().startupSecrets);

await client.secrets.deleteVersion("provider-key", 1);
await client.secrets.delete("provider-key");
```

- Secret methods take a secret's ID or exact name. Values are strings or bytes,
  used byte-for-byte: 1 to 32,768 bytes of UTF-8 without NUL. A `totp`
  secret's variable holds the code that is current when the process starts
  (it isn't refreshed); `op_token` secrets can't be variables.
- `secrets` on a process handle (and `startupSecrets` on a created sandbox)
  report what each variable received, never a value: a stored secret's
  `name`, `secretId` and `version` (with `secretType: "totp"` for TOTP), its
  `source` (`{ type: "vault", name }` or `{ type: "secrets" }`) and any
  `overrides` it replaced; or for [1Password](#1password) the `reference`,
  `tokenSecret` and `source: { type: "onePassword" }`. `vault`, `onePassword`
  and `secrets` together hold at most 32 variables, and `env` can't set one
  of them.
- A secret is delivered only to the process it is passed to, but anything
  running as the same user (or root) in the sandbox can read that process's
  environment. The sandbox and its later snapshots are marked
  `containsSecrets`.
- Deleting a secret does not revoke a value already delivered to a sandbox.
- Limits: 100 secrets per team, 10 stored versions per secret, 32 secrets per
  process or sandbox. The API key needs the `secrets.read`, `secrets.manage`
  or `secrets.use` scope for reading, managing or delivering secrets.
  SDK updates, version additions, and deletions also require `secrets.read`
  alongside `secrets.manage`: the SDK resolves the existing secret before
  changing it, even when given an ID. Encryption also needs its encryption
  context. Creating a new secret needs only `secrets.manage`.
- A process start with secrets is never retried. If it times out, its
  response is lost, or the API reports that the sandbox host did not confirm
  the start (`SECRET_PROCESS_OUTCOME_UNKNOWN`), the error code is
  `secret_process_outcome_unknown` and the API's response, if any, is in
  `details`: check the sandbox's processes before starting it again.
- The same applies to `sandboxes.create` with `secrets`, `vault` or `onePassword`: if the create result
  can't be confirmed, the error code is `secret_process_outcome_unknown`, since
  a sandbox may already be running its startup command with the secrets. List
  sandboxes before creating it again.
- Startup secrets need an image with a startup command and a Firecracker
  sandbox. Otherwise the create fails with `SECRET_STARTUP_UNSUPPORTED`; create
  the sandbox without `secrets` and pass them to `processes.exec` or
  `processes.start` instead.
- Secrets routes return 403 `SECRETS_FEATURE_DISABLED` when the team doesn't
  have secrets enabled, and 503 `SECRETS_NOT_CONFIGURED` (not retryable) when
  the server has no secrets encryption key.
- A command timeout (`timeoutSec` or `timeoutMs`) for a process started with
  secrets is sent in whole milliseconds and can be at most 24 hours.
- Secret-started handles support `wait()` and `result()` without a local
  deadline. An explicit wait timeout limits the whole local wait, leaving the
  command running; the same handle can be awaited again. Runtime waits use
  bounded requests below the client's request timeout. Output still comes from
  the receiver's retained output, so `maxOutputBytes` does not apply.

List sandboxes with time-range and search filters:

```typescript
const sandboxes = await client.sandboxes.list({
  status: "active",
  start: Date.now() - 60 * 60 * 1000,
  end: Date.now(),
  search: "sbx_",
  limit: 25,
});
```

List snapshots for a specific image:

```typescript
const snapshots = await client.sandboxes.listSnapshots({
  imageName: "node",
  status: "created",
  limit: 10,
});
```

Expose and unexpose ports:

```typescript
const sandbox = await client.sandboxes.create({ imageName: "node" });

const exposure = await sandbox.expose({ port: 8080, auth: true });
console.log(exposure.url, exposure.browserUrl, exposure.browserUrlExpiresAt);

await sandbox.unexpose(8080);
```

Write batch files with per-entry options:

```typescript
await sandbox.files.write([
  {
    path: "/tmp/hello.txt",
    data: "hello",
    append: true,
    mode: "600",
  },
  {
    path: "/tmp/payload.bin",
    data: Buffer.from([1, 2, 3]).toString("base64"),
    encoding: "base64",
  },
]);
```

Resume a PTY attach from a cursor:

```typescript
const terminal = await sandbox.terminal.create({
  command: "bash",
  rows: 24,
  cols: 80,
});

const connection = await terminal.attach(10);
```

### Streaming file transfers and watches

`read({ format: "stream" })` retains its buffered behavior. Use `uploadStream()`
and `downloadStream()` for large transfers with backpressure and bounded memory:

```typescript
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

await sandbox.files.withRunAs("root").uploadStream(
  "/tmp/archive.tar", createReadStream("./archive.tar"),
);
await pipeline(sandbox.files.downloadStream("/tmp/archive.tar"), createWriteStream("./copy.tar"));
```

Uploads accept a Node readable or iterable of string/byte chunks and optional
`{ contentLength, signal }`. Downloads return an async generator of buffers and
accept `{ signal }`. Breaking download iteration closes the request. After an
authentication failure, a consumed upload is rejected with `stream_not_replayable`;
open a fresh source to retry it. `files.stat`, `mkdir`, `move`, and `delete` are
aliases; `rename(oldPath, newPath, { overwrite: false })` forwards overwrite policy.

```typescript
const watch = await sandbox.files.watch("/workspace", { recursive: true });
try {
  for await (const message of watch.events({ cursor: 0, route: "ws" })) {
    if (message.type === "done") break;
    console.log(message.event.seq, message.event.path, message.event.op);
    break; // Close this connection; the remote watch remains active.
  }
  // Persist watch.id and the last sequence to resume an active watch:
  const resumed = await sandbox.files.getWatch(watch.id, true);
  await resumed.refresh(true);
  console.log(resumed.current, resumed.toJSON());
} finally {
  await watch.stop();
}
```

Both watch routes (`ws` and `stream`) use WebSocket transport. Watch events include
an explicit `done` envelope. `watchDir()` remains the callback convenience API.
Stopping a watcher stops the remote watch; breaking event iteration only closes
that connection. Watch timestamps remain milliseconds; existing file metadata
continues to expose `modifiedTime` as a `Date`.

### Image identities, snapshots, and runtime sessions

Offline identity helpers are available from the package root and
`@hyperbrowser/sdk/image-builds`:

```typescript
import {
  dockerBuildContextFingerprint, imageBuildName, DockerBuildContextChangedError,
} from "@hyperbrowser/sdk/image-builds";

const fingerprint = await dockerBuildContextFingerprint("./app");
const imageName = imageBuildName({ source: "dockerfile", fingerprint });
try {
  await client.sandboxes.buildImageFromDockerfile({
    contextPath: "./app", imageName, expectedContextFingerprint: fingerprint,
    builderCpus: 4, builderMemoryMiB: 8192, builderScratchMiB: 20480,
  });
} catch (error) {
  if (error instanceof DockerBuildContextChangedError) {
    // Recompute identity after a local edit, then retry explicitly.
  } else throw error;
}

const restored = await client.sandboxes.startFromSnapshot({ snapshotName: "saved" });
const session = await restored.createRuntimeSession({ forceRefresh: true });
// Also available without keeping a handle:
await client.sandboxes.getRuntimeSession(restored.id);
```

Remote Dockerfile builds need no local Docker. Local builds/imports require Docker;
platform-specific digest lookup requires Docker API 1.49+ (Docker 28.1+). Imports
preserve image `PATH`, entrypoint/CMD, working directory, and supported environment
variables; explicit image initialization overrides take precedence. Names include
context/digest, platform, and initialization overrides. Mutable base tags and
network downloads are not resolved by fingerprinting; use `forceBuild` when needed.

Only `linux/amd64` image builds are supported. Sandbox creation preserves
`runtimeClass: "firecracker" | "gvisor-cpu"`; use response capabilities when choosing
snapshot, volume, or exposure operations. Snapshot launches cannot override image
resources. Invalid or conflicting launch sources fail before a network request.

### Timeouts, cancellation, and compatibility

- Client `timeout` is milliseconds. Normal runtime requests have separate header
  and body budgets. Streaming transfers reset inactivity budgets as data moves.
- Process `timeoutMs` / `timeoutSec` limit remote execution. `wait({ timeoutMs })`
  only limits local waiting and leaves collection running.
- `exec()` / `processes.start()` accept an `AbortSignal`. Aborting stops local
  collection and closes its connection; the detached remote process continues.
  Use `signal()` or `kill()` when you intend to stop the command.
- Process stream inactivity is limited to 60 seconds; receiver keepalives reset it.
  Incomplete output, exceeded output limits, and unsupported receivers produce
  structured errors. A failed streaming start is never automatically re-executed.
- Image polling `pollInterval`, `waitTimeout`, and `uploadTimeout` are seconds.
  `getOrBuildImage()` defaults uploads to 600 seconds of inactivity and polling to
  35 minutes. Explicit `null` disables the corresponding timeout. Polling deadlines
  include control GET retries. A polling `signal` or timeout leaves accepted builds
  running for other callers. Lower-level build helpers leave upload timeouts unset
  unless explicitly supplied.
- `HYPERBROWSER_BASE_URL` supplies the API base URL when `baseUrl` is not provided.

Public handle classes are available from `@hyperbrowser/sdk/sandbox`; request and
response types remain under `@hyperbrowser/sdk/types`.

### Development checks

The supported Node baseline is 20.20.2. Run `yarn build`, `yarn typecheck`,
`yarn lint`, and `yarn test` for local verification. Tests share `vitest.config.ts`:

- `tests/unit`: isolated logic and mocked contracts (`yarn test:unit`).
- `tests/integration`: local HTTP, WebSocket, filesystem, and subprocess tests
  (`yarn test:integration`).
- `tests/e2e`: live Hyperbrowser API tests (`yarn test:e2e`).

`yarn test` and `yarn test:watch` select unit and integration tests by default;
neither requires API credentials or a Docker daemon.

Live tests are opt-in: set `HYPERBROWSER_API_KEY` and `HYPERBROWSER_BASE_URL`, then
run `yarn test:e2e`. They create remote resources and require a receiver supporting
streamed process starts.

### GPU sandboxes

Build a GPU-ready image from a remote Dockerfile context, then select a GPU when
creating the sandbox. GPU publication happens after the ordinary build;
`enableGPUBuilds: true` makes the build helpers wait for `gpuImageReady` and
keeps CPU-only images out of GPU cache reuse. Local/prebuilt Docker image imports
do not support GPU publication.

```typescript
import { Hyperbrowser } from "@hyperbrowser/sdk";

const client = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY! });
const image = await client.sandboxes.getOrBuildImage({
  contextPath: "./gpu-image", // Your CUDA-compatible Dockerfile and context
  enableGPUBuilds: true,
});
const sandbox = await client.sandboxes.create({
  imageName: image.imageName,
  imageId: image.imageId,
  gpu: "H100",
  gpuCount: 2,
  preempt: false, // Require on-demand capacity; account enablement required
  region: "us",
  cpu: 8,
  memoryMiB: 32768,
  diskMiB: 65536,
  exposedPorts: [{ port: 8000, auth: true }],
});
try {
  // create() can return status='provisioning', runtime=null, and token=null.
  await sandbox.waitUntilReady({ timeout: 20 * 60 });
  console.log((await sandbox.exec("nvidia-smi -L")).stdout);
  await sandbox.updateNetwork({ allowOut: ["example.com"], denyOut: [] });
} finally {
  await sandbox.stop();
}
```

`gpuCount` defaults to one and accepts 1–8; the API checks that the requested
GPU, CPU, and memory combination is available. Omitted `preempt` (or `true`)
allows spot capacity. `false` requires on-demand capacity. GPU launches require
`region: "us"`; `runtimeClass: "gvisor-cpu"` is inferred by the API. The disk is
quota-limited ephemeral storage, from 12 GiB (the default) up to 512 GiB, subject
to your plan and host capacity. Snapshots, volume mounts, and startup secrets are
not supported for GPU launches.

`waitUntilReady()` returns the same handle, retries transient reads with backoff,
and reports failures with the sandbox ID and close reason. Its timeout and poll
interval are in seconds. The wait timeout is independent of `timeoutMinutes`,
which controls the sandbox lifetime. Pass an `AbortSignal` to cancel the wait.
Timeout or cancellation stops only the wait; use the saved ID to inspect or stop
the sandbox. `get()` and `list()` can also return provisioning sandboxes; the
list API's existing `status: "active"` filter includes provisioning requests.
`Sandbox.runtime` is now nullable, so check it before directly accessing its URL.

GPU handles expose `gpuType`, `gpuCount`, `preempt`, `runtimeClass`, `capabilities`,
`recordingEnabled`, and `closeReason`. Existing files, commands, PTY, exposed-port
authentication, and network-update methods work after readiness. `creditsUsed`
and termination details remain available through `info()`.

For a custom image that starts an X11 desktop and installs the receiver's input
and screenshot tools, use the sandbox runtime computer-action endpoint:

```typescript
import { ComputerAction } from "@hyperbrowser/sdk/types";

const screenshot = await sandbox.computerAction({ action: ComputerAction.SCREENSHOT });
await sandbox.computerAction({ action: ComputerAction.CLICK, x: 300, y: 200 });
await sandbox.computerAction({ action: ComputerAction.TYPE_TEXT, text: "Hello" });
```

These calls belong inside the sandbox's active lifetime (before `stop()`). They
use the sandbox runtime token, including token refresh, and the existing typed
computer-action payloads. The image owns display startup; runtime readiness does
not imply desktop readiness. Set `enableRecording: true` at creation to record a
supported image's display and retrieve the video through
`client.sessions.getVideoRecordingURL(sandbox.id)`.

GPU cache lookup verifies the API's latest 100 completed builds. An older image
may be rebuilt when its GPU readiness cannot be verified from that window.
For live validation, set `HYPERBROWSER_API_KEY` and
`HYPERBROWSER_GPU_IMAGE_NAME` (an already published image containing `nvidia-smi`),
then run `yarn test:e2e tests/e2e/gpu.test.ts`. Optional `HYPERBROWSER_GPU_TYPE`,
`HYPERBROWSER_GPU_COUNT`, and `HYPERBROWSER_GPU_PREEMPT=false` select the GPU
configuration; `HYPERBROWSER_GPU_DESKTOP=1` also checks screenshots. These tests
create billable sandboxes and stop them in cleanup.

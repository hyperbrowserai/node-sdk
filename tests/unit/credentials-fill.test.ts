import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { Response } from "node-fetch";

const fetchMock = vi.fn();
vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  return { ...actual, default: (...args: unknown[]) => fetchMock(...args) };
});

import { HyperbrowserClient as Hyperbrowser, HyperbrowserError } from "../../src/client";
import {
  BrowserUseTool,
  ClaudeComputerUseTool,
  CredentialFillTool,
  OpenAICuaTool,
  WebsiteCrawlTool,
  WebsiteExtractTool,
  WebsiteScrapeTool,
  WebsiteScreenshotTool,
  FILL_CREDENTIAL_SCHEMA,
  FILL_CREDENTIAL_TOOL_ANTHROPIC,
  FILL_CREDENTIAL_TOOL_GEMINI,
  FILL_CREDENTIAL_TOOL_OPENAI,
  toGeminiSchema,
} from "../../src/tools";
import type {
  CreateSessionParams,
  CredentialFillOutcome,
  CredentialFillResult,
  SessionDetail,
} from "../../src/types";

const SESSION = "sess/1";
const FILL_URL = "https://example.test/api/session/sess%2F1/credentials/fill";

const client = (timeout = 1000) =>
  new Hyperbrowser({ apiKey: "test-key", baseUrl: "https://example.test", timeout });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const lastRequest = () => {
  const [url, init] = fetchMock.mock.lastCall!;
  return { url, init, body: JSON.parse(init.body) };
};

const filled: CredentialFillResult = {
  pageId: "TARGET-1",
  origin: "https://github.com",
  fields: [
    { selector: "#login_field", outcome: "filled", secretId: "s1", version: 2, field: "USERNAME" },
    { selector: "#password", outcome: "not_found", secretId: "s2", version: 5, field: "PASSWORD" },
    {
      selector: "#otp",
      outcome: "filled",
      secretId: "s3",
      version: 1,
      field: "OTP",
      expiresAt: "2026-10-14T12:00:30Z",
    },
  ],
};
const single: CredentialFillResult = {
  version: 3,
  pageId: "TARGET-1",
  origin: "https://github.com",
  fields: [{ selector: "#password", outcome: "filled", secretId: "s2", version: 3 }],
};
const ambiguous = {
  code: "CREDENTIAL_PAGE_AMBIGUOUS",
  message: "Several pages could be the target; pass pageId",
  details: {
    pages: [
      { pageId: "A", url: "https://github.com/login", title: "Sign in" },
      { pageId: "B", url: "https://github.com/", title: "GitHub" },
    ],
  },
};
const vaultFields = [
  { field: "USERNAME", selector: "#login_field" },
  { field: "PASSWORD", selector: "#password" },
  { field: "OTP", selector: "#otp" },
];
const fields = [{ selector: "#password" }];

afterEach(() => fetchMock.mockReset());

describe("sessions", () => {
  test("secrets and vaults are attached on create and the session lists the secrets", async () => {
    const attached = [
      { id: "s1", name: "github-username" },
      { id: "s2", name: "github-password" },
    ];
    fetchMock.mockResolvedValue(respond({ id: "session", credentials: attached }));
    const params: CreateSessionParams = {
      credentials: ["github-password", { secret: "github-username" }, { vault: "github-login" }],
    };
    const session = await client().sessions.create(params);
    expect(lastRequest().body).toEqual({
      credentials: ["github-password", { secret: "github-username" }, { vault: "github-login" }],
    });
    expect(session.credentials).toEqual(attached);
    expectTypeOf<SessionDetail["credentials"]>().toEqualTypeOf<
      { id: string; name: string }[] | undefined
    >();
  });

  test("a vault fill posts the entries with a timeout above the server's", async () => {
    fetchMock.mockResolvedValue(respond(filled));
    const result = await client(1000).sessions.credentials.fill(SESSION, {
      vault: "github-login",
      fields: vaultFields,
      pageUrl: "https://github.com/login",
      frameUrl: "https://github.com/",
    });
    const { url, init, body } = lastRequest();
    expect(url).toBe(FILL_URL);
    expect(init.method).toBe("POST");
    expect(init.timeout).toBe(30_000);
    expect(body).toEqual({
      vault: "github-login",
      fields: vaultFields,
      pageUrl: "https://github.com/login",
      frame: { url: "https://github.com/" },
    });
    expect(result).toEqual(filled);
    expectTypeOf(result.fields[0].outcome).toEqualTypeOf<CredentialFillOutcome>();
  });

  test("a single-secret fill sends selectors only and omits absent options", async () => {
    fetchMock.mockResolvedValue(respond(single));
    const result = await client(90_000).sessions.credentials.fill(SESSION, {
      credential: "github-password",
      fields,
      pageId: "TARGET-1",
    });
    const { init, body } = lastRequest();
    expect(init.timeout).toBe(90_000);
    expect(body).toEqual({ credential: "github-password", fields, pageId: "TARGET-1" });
    expect(result.version).toBe(3);
  });

  test("unknown outcomes pass through", async () => {
    fetchMock.mockResolvedValue(
      respond({ ...single, fields: [{ ...single.fields[0], outcome: "not_visible_yet" }] })
    );
    const result = await client().sessions.credentials.fill(SESSION, {
      credential: "github-password",
      fields,
    });
    expect(result.fields[0].outcome).toBe("not_visible_yet");
  });

  test("errors carry the server's code, retryable flag and body as details", async () => {
    fetchMock.mockResolvedValue(respond(ambiguous, 409));
    const error = await client()
      .sessions.credentials.fill(SESSION, { vault: "github-login", fields: vaultFields })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HyperbrowserError);
    expect(error).toMatchObject({
      statusCode: 409,
      code: "CREDENTIAL_PAGE_AMBIGUOUS",
      retryable: false,
      details: ambiguous,
    });
    expect(error.details.details.pages).toEqual(ambiguous.details.pages);
    expect(error.message).toContain("Several pages could be the target");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const timeout = { code: "CREDENTIAL_FILL_TIMEOUT", message: "timed out", retryable: true };
    fetchMock.mockResolvedValue(respond(timeout, 504));
    await expect(
      client().sessions.credentials.fill(SESSION, { credential: "github-password", fields })
    ).rejects.toMatchObject({
      code: "CREDENTIAL_FILL_TIMEOUT",
      retryable: true,
      details: timeout,
    });
  });

  test.each([
    ["neither credential nor vault", { fields }],
    ["both credential and vault", { credential: "a", vault: "b", fields: vaultFields }],
    ["an empty credential", { credential: "", fields }],
    ["a credential over 255 characters", { credential: "c".repeat(256), fields }],
    ["a vault that isn't a vault name", { vault: "github login", fields: vaultFields }],
    ["no fields", { credential: "github-password", fields: [] }],
    [
      "17 fields",
      {
        credential: "github-password",
        fields: Array.from({ length: 17 }, (_, i) => ({ selector: `#f${i}` })),
      },
    ],
    [
      "a repeated selector",
      {
        vault: "github-login",
        fields: [vaultFields[0], { field: "PASSWORD", selector: "#login_field" }],
      },
    ],
    ["a field with a credential", { credential: "github-password", fields: [vaultFields[1]] }],
    ["a vault fill without field", { vault: "github-login", fields }],
    [
      "a field that isn't an entry name",
      { vault: "github-login", fields: [{ field: "pass word", selector: "#p" }] },
    ],
    ["an empty selector", { credential: "github-password", fields: [{ selector: "" }] }],
    [
      "a selector over 1024 bytes",
      { credential: "github-password", fields: [{ selector: "é".repeat(513) }] },
    ],
    ["an empty page ID", { credential: "github-password", fields, pageId: "" }],
    [
      "a page ID over 128 bytes",
      { credential: "github-password", fields, pageId: "p".repeat(129) },
    ],
    [
      "pageId with pageUrl",
      { credential: "github-password", fields, pageId: "A", pageUrl: "https://a" },
    ],
    [
      "a page URL over 2048 bytes",
      { credential: "github-password", fields, pageUrl: "u".repeat(2049) },
    ],
    ["an empty frame URL", { credential: "github-password", fields, frameUrl: "" }],
    [
      "a frame URL over 2048 bytes",
      { credential: "github-password", fields, frameUrl: "u".repeat(2049) },
    ],
  ])("fill rejects %s before any request", async (_name, params) => {
    await expect(client().sessions.credentials.fill(SESSION, params as any)).rejects.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fill requires a session ID", async () => {
    await expect(
      client().sessions.credentials.fill("", { credential: "github-password", fields })
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the longest allowed selector, page ID and URLs are accepted", async () => {
    fetchMock.mockImplementation(async () => respond(single));
    await client().sessions.credentials.fill(SESSION, {
      credential: "github-password",
      fields: [{ selector: "é".repeat(512) }],
      pageId: "p".repeat(128),
      frameUrl: "u".repeat(2048),
    });
    await client().sessions.credentials.fill(SESSION, {
      credential: "github-password",
      fields,
      pageUrl: "u".repeat(2048),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("1Password fills", () => {
  const onePassword = {
    token: "op-token",
    vault: "Dev Vault for Testing",
    allowedOrigins: ["https://www.scrapingcourse.com"],
  };
  const refFields = [
    { selector: "#email", ref: { item: "scrapingcourse login", field: "username" } },
    {
      selector: "#otp",
      ref: { item: "scrapingcourse login", section: "Security", field: "otp?attribute=totp" },
    },
  ];
  const opResult: CredentialFillResult = {
    pageId: "TARGET-1",
    origin: "https://www.scrapingcourse.com",
    fields: [
      {
        selector: "#email",
        outcome: "filled",
        secretId: "tok",
        version: 2,
        reference: "op://Dev Vault for Testing/scrapingcourse login/username",
      },
      {
        selector: "#otp",
        outcome: "filled",
        secretId: "tok",
        version: 2,
        reference: "op://Dev Vault for Testing/scrapingcourse login/Security/otp?attribute=totp",
      },
    ],
  };

  test("create attaches an op_token as { onePassword }", async () => {
    fetchMock.mockResolvedValue(respond({ id: "session" }));
    const params: CreateSessionParams = {
      credentials: ["github-password", { vault: "github-login" }, { onePassword: "op-token" }],
    };
    await client().sessions.create(params);
    expect(lastRequest().body).toEqual({
      credentials: ["github-password", { vault: "github-login" }, { onePassword: "op-token" }],
    });
  });

  test("create accepts 20 credentials and no credentials", async () => {
    fetchMock.mockImplementation(async () => respond({ id: "session" }));
    await client().sessions.create({
      credentials: Array.from({ length: 20 }, (_, i) => ({ onePassword: `op-${i}` })),
    });
    await client().sessions.create();
    await client().sessions.create({ credentials: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test.each([
    ["21 items", Array.from({ length: 21 }, (_, i) => `s-${i}`)],
    ["a name with a space", [{ onePassword: "op token" }]],
    ["an empty name", [""]],
    ["a non-string name", [{ onePassword: 1 }]],
    ["two kinds in one item", [{ onePassword: "op-token", secret: "s" }]],
    ["an unknown kind", [{ token: "op-token" }]],
    ["an empty object", [{}]],
    ["not a list", "op-token"],
  ])("create rejects credentials with %s before any request", async (_name, credentials) => {
    await expect(
      client().sessions.create({ credentials: credentials as any })
    ).rejects.toMatchObject({ code: "invalid_request", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fill sends onePassword and each field's ref, and returns references", async () => {
    fetchMock.mockResolvedValue(respond(opResult));
    const result = await client().sessions.credentials.fill(SESSION, {
      onePassword,
      fields: refFields,
      pageUrl: "https://www.scrapingcourse.com/login",
      frameUrl: "https://www.scrapingcourse.com/",
    });
    const { url, body } = lastRequest();
    expect(url).toBe(FILL_URL);
    expect(body).toEqual({
      onePassword,
      fields: refFields,
      pageUrl: "https://www.scrapingcourse.com/login",
      frame: { url: "https://www.scrapingcourse.com/" },
    });
    expect(result).toEqual(opResult);
    expect(result.version).toBeUndefined();
    expect(result.fields[1].reference).toBe(
      "op://Dev Vault for Testing/scrapingcourse login/Security/otp?attribute=totp"
    );
    expectTypeOf(result.fields[0].reference).toEqualTypeOf<string | undefined>();
    expectTypeOf(result.version).toEqualTypeOf<number | undefined>();
  });

  test("local and wildcard origins, and a 512-byte reference, are accepted", async () => {
    fetchMock.mockImplementation(async () => respond(opResult));
    await client().sessions.credentials.fill(SESSION, {
      onePassword: {
        token: "op-token",
        vault: "v",
        allowedOrigins: [
          "http://localhost:3000",
          "http://127.0.0.1",
          "http://[::1]:8080",
          "https://*.example.com",
          "HTTPS://Example.com:443/",
          ...Array.from({ length: 15 }, (_, i) => `https://a${i}.example.com`),
        ],
      },
      // 256 characters, 503 bytes: op://v/i/ makes 512.
      fields: [{ selector: "#f", ref: { item: "i", field: "é".repeat(247) + "x".repeat(9) } }],
      pageId: "TARGET-1",
    });
    expect(Buffer.byteLength(`op://v/i/${lastRequest().body.fields[0].ref.field}`)).toBe(512);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  const opFill = (overrides: Record<string, unknown> = {}, fieldList: unknown = refFields) => ({
    onePassword: { ...onePassword, ...overrides },
    fields: fieldList,
  });
  const ref = (value: Record<string, unknown>) => [{ selector: "#f", ref: value }];

  test.each([
    ["onePassword with credential", { ...opFill(), credential: "github-password" }],
    ["onePassword with vault", { ...opFill(), vault: "github-login" }],
    ["a field without ref", opFill({}, [refFields[0], { selector: "#otp" }])],
    ["a ref without onePassword", { credential: "github-password", fields: refFields }],
    [
      "a ref in a vault fill",
      { vault: "github-login", fields: [{ ...vaultFields[0], ref: refFields[0].ref }] },
    ],
    ["a field with onePassword", opFill({}, [{ ...refFields[0], field: "USERNAME" }])],
    ["onePassword that isn't an object", { onePassword: "op-token", fields: refFields }],
    ["a token that isn't a secret name", opFill({ token: "op token" })],
    ["no token", opFill({ token: undefined })],
    ["an empty vault", opFill({ vault: "" })],
    ["a vault with a slash", opFill({ vault: "Dev/Vault" })],
    ["a vault of '..'", opFill({ vault: ".." })],
    ["a vault over 256 characters", opFill({ vault: "v".repeat(257) })],
    ["no allowedOrigins", opFill({ allowedOrigins: undefined })],
    ["0 allowedOrigins", opFill({ allowedOrigins: [] })],
    [
      "21 allowedOrigins",
      opFill({ allowedOrigins: Array.from({ length: 21 }, (_, i) => `https://a${i}.example.com`) }),
    ],
    ["an http origin", opFill({ allowedOrigins: ["http://example.com"] })],
    ["a wildcard on a single label", opFill({ allowedOrigins: ["https://*.com"] })],
    ["a wildcard on an IP address", opFill({ allowedOrigins: ["https://*.10.0.0.1"] })],
    ["an origin with a path", opFill({ allowedOrigins: ["https://example.com/login"] })],
    ["an origin without a scheme", opFill({ allowedOrigins: ["example.com"] })],
    ["an origin over 512 characters", opFill({ allowedOrigins: [`https://${"a".repeat(505)}`] })],
    ["a bad IPv6 origin", opFill({ allowedOrigins: ["https://[nope]"] })],
    ["an unknown member of onePassword", opFill({ fields: {} })],
    ["an unknown member of ref", opFill({}, ref({ item: "i", field: "f", vault: "v" }))],
    ["a ref that isn't an object", opFill({}, [{ selector: "#f", ref: "op://v/i/f" }])],
    ["a ref without item", opFill({}, ref({ field: "password" }))],
    ["a ref without field", opFill({}, ref({ item: "i" }))],
    ["an item with a slash", opFill({}, ref({ item: "a/b", field: "f" }))],
    ["an item with a question mark", opFill({}, ref({ item: "a?b", field: "f" }))],
    ["an item with a control character", opFill({}, ref({ item: "a\u0007", field: "f" }))],
    ["an empty section", opFill({}, ref({ item: "i", section: "", field: "f" }))],
    ["a section of '.'", opFill({}, ref({ item: "i", section: ".", field: "f" }))],
    ["a field over 256 characters", opFill({}, ref({ item: "i", field: "f".repeat(257) }))],
    [
      "a field query with an uppercase key",
      opFill({}, ref({ item: "i", field: "otp?Attribute=otp" })),
    ],
    ["a field with an empty query", opFill({}, ref({ item: "i", field: "otp?" }))],
    ["a field of '..'", opFill({}, ref({ item: "i", field: "..?attribute=otp" }))],
    [
      "a 513-byte reference",
      opFill({ vault: "v" }, ref({ item: "i", field: "é".repeat(248) + "x".repeat(8) })),
    ],
    [
      "a repeated selector",
      opFill({}, [refFields[0], { selector: "#email", ref: refFields[1].ref }]),
    ],
    ["no fields", opFill({}, [])],
    [
      "17 fields",
      opFill(
        {},
        Array.from({ length: 17 }, (_, i) => ({ selector: `#f${i}`, ref: refFields[0].ref }))
      ),
    ],
  ])("fill rejects %s before any request", async (_name, params) => {
    await expect(client().sessions.credentials.fill(SESSION, params as any)).rejects.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a reference failure keeps the selectors and reasons in details", async () => {
    const failure = {
      code: "SECRET_ONEPASSWORD_REFERENCE_FAILED",
      message: "A 1Password field could not be read; nothing was filled",
      retryable: false,
      details: {
        selectors: ["#otp"],
        reason: "field not found",
        reasons: { "#otp": "field not found" },
        tokenSecretId: "tok",
        tokenVersion: 2,
      },
    };
    fetchMock.mockResolvedValue(respond(failure, 422));
    await expect(
      client().sessions.credentials.fill(SESSION, { onePassword, fields: refFields })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "SECRET_ONEPASSWORD_REFERENCE_FAILED",
      retryable: false,
      details: failure,
    });
  });

  test("the fill_credential tool has no onePassword and drops one a model sends", async () => {
    expect(JSON.stringify(FILL_CREDENTIAL_SCHEMA)).not.toMatch(/onePassword|one_password|"ref"/);
    const output = await CredentialFillTool.runnable(client(), SESSION, {
      onePassword,
      fields: refFields,
    } as any);
    expect(JSON.parse(output)).toMatchObject({ error: { code: "invalid_request" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** Every object schema lists all its properties as required and allows no others. */
const expectStrict = (schema: any, path = "$"): void => {
  if (schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"))) {
    expect(schema.additionalProperties, path).toBe(false);
    expect([...schema.required].sort(), path).toEqual(Object.keys(schema.properties).sort());
  }
  for (const [name, property] of Object.entries<any>(schema.properties ?? {})) {
    expect(typeof property.description, `${path}.${name}`).toBe("string");
    expectStrict(property, `${path}.${name}`);
  }
  if (schema.items) expectStrict(schema.items, `${path}[]`);
};

const collectKeys = (schema: unknown, keys = new Set<string>()): Set<string> => {
  if (Array.isArray(schema)) schema.forEach((item) => collectKeys(item, keys));
  else if (schema && typeof schema === "object") {
    for (const [key, value] of Object.entries(schema)) {
      keys.add(key);
      if (key !== "properties") collectKeys(value, keys);
      else Object.values(value as object).forEach((property) => collectKeys(property, keys));
    }
  }
  return keys;
};

describe("fill_credential tool", () => {
  const nullable = { type: "STRING", nullable: true, description: expect.any(String) };

  test("the OpenAI definition is strict-compatible", () => {
    expect(FILL_CREDENTIAL_TOOL_OPENAI.type).toBe("function");
    expect(FILL_CREDENTIAL_TOOL_OPENAI.function.name).toBe("fill_credential");
    expect(FILL_CREDENTIAL_TOOL_OPENAI.function.strict).toBe(true);
    expect(FILL_CREDENTIAL_TOOL_OPENAI.function.parameters).toBe(FILL_CREDENTIAL_SCHEMA);
    expectStrict(FILL_CREDENTIAL_SCHEMA);
    expect(Object.keys(FILL_CREDENTIAL_SCHEMA.properties)).toEqual([
      "credential",
      "vault",
      "fields",
      "page_id",
      "page_url",
      "frame_url",
    ]);
    expect(FILL_CREDENTIAL_SCHEMA.properties.fields).toMatchObject({ minItems: 1, maxItems: 16 });
    for (const name of ["credential", "vault", "page_id", "page_url", "frame_url"] as const) {
      expect(FILL_CREDENTIAL_SCHEMA.properties[name].type).toEqual(["string", "null"]);
    }
    expect(FILL_CREDENTIAL_SCHEMA.properties.fields.items.properties.field.type).toEqual([
      "string",
      "null",
    ]);
    // The session is bound by the application, never chosen by the model.
    expect(JSON.stringify(FILL_CREDENTIAL_SCHEMA)).not.toMatch(/session/i);
  });

  test("the Anthropic definition shares the schema and description", () => {
    expect(FILL_CREDENTIAL_TOOL_ANTHROPIC).toEqual({
      name: "fill_credential",
      description: FILL_CREDENTIAL_TOOL_OPENAI.function.description,
      input_schema: FILL_CREDENTIAL_SCHEMA,
    });
    expect(CredentialFillTool.anthropicToolDefinition).toBe(FILL_CREDENTIAL_TOOL_ANTHROPIC);
    expect(CredentialFillTool.openaiToolDefinition).toBe(FILL_CREDENTIAL_TOOL_OPENAI);
    const description = FILL_CREDENTIAL_TOOL_ANTHROPIC.description!;
    for (const word of [
      "NOT submit",
      "vault",
      "TOTP",
      "filled",
      "not_found",
      "ambiguous",
      "not_editable",
      "not_accepted",
      "CREDENTIAL_PAGE_AMBIGUOUS",
      "page_id",
      "page_url",
    ]) {
      expect(description).toContain(word);
    }
    expect(description).not.toContain("not_populated");
  });

  test("the Gemini declaration uses Gemini's schema form", () => {
    const declaration = CredentialFillTool.geminiToolDefinition;
    expect(declaration).toBe(FILL_CREDENTIAL_TOOL_GEMINI);
    expect(declaration.name).toBe("fill_credential");
    expect(declaration.description).toBe(FILL_CREDENTIAL_TOOL_OPENAI.function.description);
    const keys = collectKeys(declaration.parameters);
    expect(keys.has("additionalProperties")).toBe(false);
    expect(JSON.stringify(declaration.parameters)).not.toContain('"null"');
    expect(declaration.parameters).toEqual({
      type: "OBJECT",
      properties: {
        credential: nullable,
        vault: nullable,
        fields: {
          type: "ARRAY",
          description: expect.any(String),
          minItems: "1",
          maxItems: "16",
          items: {
            type: "OBJECT",
            properties: {
              selector: { type: "STRING", description: expect.any(String) },
              field: nullable,
            },
            required: ["selector", "field"],
          },
        },
        page_id: nullable,
        page_url: nullable,
        frame_url: nullable,
      },
      required: ["credential", "vault", "fields", "page_id", "page_url", "frame_url"],
    });
  });

  test.each([
    WebsiteScrapeTool,
    WebsiteScreenshotTool,
    WebsiteCrawlTool,
    WebsiteExtractTool,
    BrowserUseTool,
    ClaudeComputerUseTool,
    OpenAICuaTool,
    CredentialFillTool,
  ])("$name has a Gemini declaration matching its OpenAI definition", (tool) => {
    const declaration = tool.geminiToolDefinition;
    expect(declaration.name).toBe(tool.openaiToolDefinition.function.name);
    expect(declaration.description).toBe(tool.openaiToolDefinition.function.description);
    expect(declaration.parameters?.type).toBe("OBJECT");
    expect(collectKeys(declaration.parameters).has("additionalProperties")).toBe(false);
    expect(Object.keys(declaration.parameters?.properties ?? {})).toEqual(
      Object.keys((tool.openaiToolDefinition.function.parameters as any).properties)
    );
  });

  test("the Gemini converter refuses schemas it can't express", () => {
    expect(() => toGeminiSchema({ type: ["string", "number"] })).toThrow(/Unsupported/);
    expect(toGeminiSchema({ type: "integer", enum: ["1"], default: 1 })).toEqual({
      type: "INTEGER",
      enum: ["1"],
      default: 1,
    });
  });

  test("runnable maps a vault call to the API and returns JSON text", async () => {
    fetchMock.mockResolvedValue(respond(filled));
    const output = await CredentialFillTool.runnable(client(), SESSION, {
      credential: null,
      vault: "github-login",
      fields: [
        { field: "USERNAME", selector: "#login_field", extra: "dropped" } as any,
        { field: "PASSWORD", selector: "#password" },
      ],
      page_id: null,
      page_url: "https://github.com/login",
      frame_url: "https://github.com/",
    });
    const { url, body } = lastRequest();
    expect(url).toBe(FILL_URL);
    expect(body).toEqual({
      vault: "github-login",
      fields: [
        { field: "USERNAME", selector: "#login_field" },
        { field: "PASSWORD", selector: "#password" },
      ],
      pageUrl: "https://github.com/login",
      frame: { url: "https://github.com/" },
    });
    expect(typeof output).toBe("string");
    expect(JSON.parse(output)).toEqual(filled);
  });

  test("strict mode's nulls are left out of a single-secret call", async () => {
    fetchMock.mockResolvedValue(respond(single));
    await CredentialFillTool.runnable(client(), SESSION, {
      credential: "github-password",
      vault: null,
      fields: [{ selector: "#password", field: null }],
      page_id: "TARGET-1",
      page_url: null,
      frame_url: null,
    });
    expect(lastRequest().body).toEqual({
      credential: "github-password",
      fields: [{ selector: "#password" }],
      pageId: "TARGET-1",
    });
  });

  test("empty strings, as Gemini sends for unused options, are left out", async () => {
    fetchMock.mockResolvedValue(respond(filled));
    await CredentialFillTool.runnable(client(), SESSION, {
      credential: "",
      vault: "github-login",
      fields: [{ selector: "#login_field", field: "USERNAME" }],
      page_id: "",
      page_url: "",
      frame_url: "",
    });
    expect(lastRequest().body).toEqual({
      vault: "github-login",
      fields: [{ selector: "#login_field", field: "USERNAME" }],
    });
    fetchMock.mockResolvedValue(respond(single));
    await CredentialFillTool.runnable(client(), SESSION, {
      credential: "github-password",
      vault: "",
      fields: [{ selector: "#password", field: "" }],
    });
    expect(lastRequest().body).toEqual({
      credential: "github-password",
      fields: [{ selector: "#password" }],
    });
  });

  test("API errors come back as JSON with the server's own details", async () => {
    fetchMock.mockResolvedValue(respond(ambiguous, 409));
    const output = await CredentialFillTool.runnable(client(), SESSION, {
      credential: "github-password",
      fields,
    });
    expect(JSON.parse(output)).toEqual({
      error: {
        code: "CREDENTIAL_PAGE_AMBIGUOUS",
        message: "Several pages could be the target; pass pageId",
        retryable: false,
        details: ambiguous.details,
      },
    });

    fetchMock.mockResolvedValue(
      respond({ code: "CREDENTIAL_FILL_TIMEOUT", message: "timed out", retryable: true }, 504)
    );
    const timedOut = await CredentialFillTool.runnable(client(), SESSION, {
      credential: "github-password",
      fields,
    });
    expect(JSON.parse(timedOut)).toEqual({
      error: {
        code: "CREDENTIAL_FILL_TIMEOUT",
        message: "timed out",
        retryable: true,
        details: null,
      },
    });
  });

  test.each([
    ["an empty selector", { credential: "github-password", fields: [{ selector: "" }] }],
    ["both names", { credential: "a", vault: "b", fields: vaultFields }],
    ["a vault without fields' entries", { vault: "github-login", fields }],
    ["no input at all", undefined],
  ])("invalid model input (%s) comes back as JSON without a request", async (_name, input) => {
    const output = await CredentialFillTool.runnable(client(), SESSION, input as any);
    expect(JSON.parse(output)).toMatchObject({
      error: { code: "invalid_request", retryable: false, details: null },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("errors other than HyperbrowserError are thrown", async () => {
    const hb = client();
    vi.spyOn(hb.sessions.credentials, "fill").mockRejectedValue(new TypeError("bug"));
    await expect(
      CredentialFillTool.runnable(hb, SESSION, { credential: "github-password", fields })
    ).rejects.toThrow(TypeError);
  });
});

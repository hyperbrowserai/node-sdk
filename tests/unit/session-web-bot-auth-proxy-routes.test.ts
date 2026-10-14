import { afterEach, expect, expectTypeOf, test, vi } from "vitest";
import { Response } from "node-fetch";

const fetchMock = vi.fn();
vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  return { ...actual, default: (...args: unknown[]) => fetchMock(...args) };
});

import { HyperbrowserClient as Hyperbrowser } from "../../src/client";
import type {
  CreateSessionParams,
  ProxyRoute,
  SessionLaunchState,
  SessionWebBotAuth,
  WebBotAuthParams,
} from "../../src/types";

const client = () => new Hyperbrowser({ apiKey: "test-key", baseUrl: "https://example.test" });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const lastBody = () => JSON.parse(fetchMock.mock.lastCall![1].body);

afterEach(() => fetchMock.mockReset());

test("session creation sends webBotAuth as given", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(respond({ id: "session" })));
  const sdk = client();
  for (const params of [
    {},
    { webBotAuth: true },
    { webBotAuth: false },
    { webBotAuth: { onlyDomains: ["example.com", "shop.example.org"] } },
  ] satisfies CreateSessionParams[]) {
    await sdk.sessions.create(params);
    expect(lastBody()).toEqual(params);
  }
});

test("session creation sends proxyRoutes in order", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(respond({ id: "session" })));
  const params = {
    useProxy: true,
    proxyRoutes: [
      { match: "api.example.com", proxy: "default" },
      { match: ["*.example.com", "cdn.example.net"], proxy: "direct" },
    ],
  } satisfies CreateSessionParams;
  await client().sessions.create(params);
  expect(lastBody()).toEqual(params);
});

test("agent tasks pass webBotAuth through sessionOptions", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(respond({ jobId: "job" })));
  await client().agents.browserUse.start({
    task: "Open example.com",
    sessionOptions: { webBotAuth: { onlyDomains: ["example.com"] } },
  });
  expect(fetchMock.mock.lastCall![0]).toBe("https://example.test/api/task/browser-use");
  expect(lastBody().sessionOptions).toEqual({ webBotAuth: { onlyDomains: ["example.com"] } });
});

test("public types describe the options and the signing launch state", () => {
  expectTypeOf<CreateSessionParams["webBotAuth"]>().toEqualTypeOf<
    boolean | WebBotAuthParams | undefined
  >();
  expectTypeOf<CreateSessionParams["proxyRoutes"]>().toEqualTypeOf<ProxyRoute[] | undefined>();
  expectTypeOf<ProxyRoute["proxy"]>().toEqualTypeOf<"direct" | "default">();
  expectTypeOf<ProxyRoute["match"]>().toEqualTypeOf<string | string[]>();
  expectTypeOf<SessionLaunchState["webBotAuth"]>().toEqualTypeOf<SessionWebBotAuth | undefined>();
  expectTypeOf<SessionWebBotAuth>().toEqualTypeOf<{
    signatureAgent: string;
    onlyDomains?: string[];
  }>();
});

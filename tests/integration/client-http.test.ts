import http, { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { HyperbrowserClient } from "../../src/client";

type RecordedRequest = {
  method?: string;
  url?: string;
  apiKey?: string;
  contentType?: string;
  body?: unknown;
};

type TestServer = {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  const encoded = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": encoded.length,
  });
  response.end(encoded);
};

const startServer = async (): Promise<TestServer> => {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (request, response) => {
    const body = await readJsonBody(request);
    requests.push({
      method: request.method,
      url: request.url,
      apiKey: request.headers["x-api-key"]?.toString(),
      contentType: request.headers["content-type"]?.toString(),
      body,
    });

    if (request.method === "POST" && request.url === "/api/scrape") {
      sendJson(response, 200, { jobId: "job_123" });
      return;
    }

    if (request.method === "POST" && request.url === "/api/session") {
      sendJson(response, 200, {
        id: "52dd29fb-75a2-43f9-9831-8ff377fedb0a",
        teamId: "team_123",
        status: "active",
        createdAt: "2026-06-16T00:00:00.000Z",
        updatedAt: "2026-06-16T00:00:00.000Z",
        sessionUrl: "https://session.example.com",
        launchState: null,
        creditsUsed: null,
        creditBreakdown: {
          creditsUsed: null,
          browserTimeCreditsUsed: null,
          proxyDataCreditsUsed: null,
        },
        wsEndpoint: "wss://session.example.com/devtools/browser",
        liveUrl: "https://live.example.com",
        token: "session-token",
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/scrape/job_123/status") {
      sendJson(response, 200, { status: "completed" });
      return;
    }

    if (
      request.method === "POST" &&
      request.url === "/api/session/52dd29fb-75a2-43f9-9831-8ff377fedb0a/snapshot"
    ) {
      sendJson(response, 200, {
        snapshotName: "browser-session-11111111-1111-4111-8111-111111111111",
        snapshotId: "11111111-1111-4111-8111-111111111111",
        namespace: "team_team_123",
        status: "created",
        uploaded: false,
        ready: false,
        imageName: "browser-base",
        imageId: "22222222-2222-4222-8222-222222222222",
        imageNamespace: "default",
      });
      return;
    }

    if (
      request.method === "POST" &&
      request.url ===
        "/api/session/52dd29fb-75a2-43f9-9831-8ff377fedb0a/captcha/evaluate"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      sendJson(response, 200, {
        success: true,
        captcha: "recaptcha-visual",
        iterationsRequested: 5,
        iterationsRun: 1,
        solved: true,
        solvedCaptchas: ["recaptcha-visual"],
        pages: [
          {
            url: "https://example.com",
            targetId: "target_123",
            iterationsRun: 1,
            solved: true,
            solvedCaptchas: ["recaptcha-visual"],
            checkedCaptchas: ["recaptcha-visual"],
            captchaSolvedCounts: { "recaptcha-visual": 1 },
            lastSolveTime: { "recaptcha-visual": 123 },
          },
        ],
      });
      return;
    }

    if (
      request.method === "PUT" &&
      request.url === "/api/session/52dd29fb-75a2-43f9-9831-8ff377fedb0a/update"
    ) {
      const updateBody = body as { type?: string; params?: { enabled?: boolean } };
      if (updateBody.type === "solveCaptchas") {
        sendJson(response, 200, {
          success: true,
          solveCaptchas: Boolean(updateBody.params?.enabled),
        });
        return;
      }
    }

    sendJson(response, 404, { message: `unexpected route ${request.method} ${request.url}` });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

const servers: TestServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("client HTTP integration", () => {
  test("scrape requests use the configured API endpoint and parse responses", async () => {
    const server = await startServer();
    servers.push(server);
    const client = new HyperbrowserClient({
      apiKey: "test-api-key",
      baseUrl: server.baseUrl,
    });

    const started = await client.scrape.start({
      url: "https://example.com",
      scrapeOptions: {
        formats: ["markdown"],
      },
    });
    const status = await client.scrape.getStatus(started.jobId);

    expect(started).toEqual({ jobId: "job_123" });
    expect(status).toEqual({ status: "completed" });
    expect(server.requests).toEqual([
      {
        method: "POST",
        url: "/api/scrape",
        apiKey: "test-api-key",
        contentType: "application/json",
        body: {
          url: "https://example.com",
          scrapeOptions: {
            formats: ["markdown"],
          },
        },
      },
      {
        method: "GET",
        url: "/api/scrape/job_123/status",
        apiKey: "test-api-key",
        contentType: "application/json",
        body: undefined,
      },
    ]);
  });

  test("session create can start from a snapshot", async () => {
    const server = await startServer();
    servers.push(server);
    const client = new HyperbrowserClient({
      apiKey: "test-api-key",
      baseUrl: server.baseUrl,
    });

    const session = await client.sessions.create({
      startFromSnapshot: {
        snapshotId: "11111111-1111-4111-8111-111111111111",
      },
      liveViewTtlSeconds: 300,
    });

    expect(session.id).toBe("52dd29fb-75a2-43f9-9831-8ff377fedb0a");
    expect(server.requests).toEqual([
      {
        method: "POST",
        url: "/api/session",
        apiKey: "test-api-key",
        contentType: "application/json",
        body: {
          startFromSnapshot: {
            snapshotId: "11111111-1111-4111-8111-111111111111",
          },
          liveViewTtlSeconds: 300,
        },
      },
    ]);
  });

  test("session snapshot posts an empty body and parses the snapshot result", async () => {
    const server = await startServer();
    servers.push(server);
    const client = new HyperbrowserClient({
      apiKey: "test-api-key",
      baseUrl: server.baseUrl,
    });

    const snapshot = await client.sessions.createSnapshot(
      "52dd29fb-75a2-43f9-9831-8ff377fedb0a"
    );

    expect(snapshot).toEqual({
      snapshotName: "browser-session-11111111-1111-4111-8111-111111111111",
      snapshotId: "11111111-1111-4111-8111-111111111111",
      namespace: "team_team_123",
      status: "created",
      uploaded: false,
      ready: false,
      imageName: "browser-base",
      imageId: "22222222-2222-4222-8222-222222222222",
      imageNamespace: "default",
    });
    expect(server.requests).toEqual([
      {
        method: "POST",
        url: "/api/session/52dd29fb-75a2-43f9-9831-8ff377fedb0a/snapshot",
        apiKey: "test-api-key",
        contentType: "application/json",
        body: {},
      },
    ]);
  });

  test("session captcha evaluation posts the requested captcha target and iterations", async () => {
    const server = await startServer();
    servers.push(server);
    const client = new HyperbrowserClient({
      apiKey: "test-api-key",
      baseUrl: server.baseUrl,
      timeout: 1,
    });

    const result = await client.sessions.evaluateCaptcha(
      "52dd29fb-75a2-43f9-9831-8ff377fedb0a",
      {
        captcha: "recaptcha-visual",
        iterations: 5,
      }
    );

    expect(result).toEqual({
      success: true,
      captcha: "recaptcha-visual",
      iterationsRequested: 5,
      iterationsRun: 1,
      solved: true,
      solvedCaptchas: ["recaptcha-visual"],
      pages: [
        {
          url: "https://example.com",
          targetId: "target_123",
          iterationsRun: 1,
          solved: true,
          solvedCaptchas: ["recaptcha-visual"],
          checkedCaptchas: ["recaptcha-visual"],
          captchaSolvedCounts: { "recaptcha-visual": 1 },
          lastSolveTime: { "recaptcha-visual": 123 },
        },
      ],
    });
    expect(server.requests).toEqual([
      {
        method: "POST",
        url: "/api/session/52dd29fb-75a2-43f9-9831-8ff377fedb0a/captcha/evaluate",
        apiKey: "test-api-key",
        contentType: "application/json",
        body: {
          captcha: "recaptcha-visual",
          iterations: 5,
        },
      },
    ]);
  });

  test("session captcha solving update starts and stops automatic solving", async () => {
    const server = await startServer();
    servers.push(server);
    const client = new HyperbrowserClient({
      apiKey: "test-api-key",
      baseUrl: server.baseUrl,
    });

    const started = await client.sessions.startCaptchaSolving(
      "52dd29fb-75a2-43f9-9831-8ff377fedb0a",
      {
        solverType: "visual",
      }
    );
    const stopped = await client.sessions.stopCaptchaSolving(
      "52dd29fb-75a2-43f9-9831-8ff377fedb0a"
    );

    expect(started).toEqual({ success: true, solveCaptchas: true });
    expect(stopped).toEqual({ success: true, solveCaptchas: false });
    expect(server.requests).toEqual([
      {
        method: "PUT",
        url: "/api/session/52dd29fb-75a2-43f9-9831-8ff377fedb0a/update",
        apiKey: "test-api-key",
        contentType: "application/json",
        body: {
          type: "solveCaptchas",
          params: {
            enabled: true,
            solverType: "visual",
          },
        },
      },
      {
        method: "PUT",
        url: "/api/session/52dd29fb-75a2-43f9-9831-8ff377fedb0a/update",
        apiKey: "test-api-key",
        contentType: "application/json",
        body: {
          type: "solveCaptchas",
          params: {
            enabled: false,
          },
        },
      },
    ]);
  });
});

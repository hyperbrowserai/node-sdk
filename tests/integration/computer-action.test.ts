import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { HyperbrowserClient, HyperbrowserError } from "../../src/client";
import type { SessionDetail } from "../../src/types";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

async function fixture(success = true) {
  const requests: { method?: string; url?: string; apiKey?: string; body?: unknown }[] = [];
  let session: SessionDetail;
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    requests.push({
      method: request.method,
      url: request.url,
      apiKey: request.headers["x-api-key"]?.toString(),
      body,
    });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/api/session/session-id") {
      response.end(JSON.stringify(session));
    } else if (request.method === "POST" && request.url === "/action") {
      response.end(
        JSON.stringify({
          success,
          ...(body.action === "cursor_position" ? { data: { x: 123, y: 456 } } : {}),
          ...(!success ? { error: "action failed" } : {}),
        })
      );
    } else {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "not found" }));
    }
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  session = {
    id: "session-id",
    teamId: "team-id",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    sessionUrl: baseUrl,
    token: "test-token",
    wsEndpoint: "wss://session.example",
    computerActionEndpoint: `${baseUrl}/action`,
    creditsUsed: null,
    creditBreakdown: {
      creditsUsed: null,
      browserTimeCreditsUsed: null,
      proxyDataCreditsUsed: null,
    },
  };
  const client = new HyperbrowserClient({ apiKey: "test-key", baseUrl });
  return { actions: client.computerAction, requests, session };
}

describe("computer action primitives", () => {
  test.each([false, true])(
    "reads cursor coordinates with borrowed session, by ID=%s",
    async (byId) => {
      const { actions, session, requests } = await fixture();
      const result = await actions.cursorPosition(byId ? session.id : session, true);
      expect(result).toEqual({ success: true, data: { x: 123, y: 456 } });
      expect(requests.at(-1)).toEqual({
        method: "POST",
        url: "/action",
        apiKey: "test-key",
        body: { action: "cursor_position", returnScreenshot: true },
      });
      expect(requests).toHaveLength(byId ? 2 : 1);
    }
  );

  test.each(["click", "drag", "scroll"] as const)(
    "sends %s modifier chords and preserves existing arguments",
    async (action) => {
      const { actions, session, requests } = await fixture();
      const keys = ["Control_L", "Shift_L"];
      if (action === "click") await actions.click(session, 10, 20, "right", 2, true, keys);
      if (action === "drag")
        await actions.drag(
          session,
          [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
          true,
          keys
        );
      if (action === "scroll") await actions.scroll(session, 10, 20, 0, -2, true, keys);
      const expected = {
        click: {
          action,
          x: 10,
          y: 20,
          button: "right",
          numClicks: 2,
          returnScreenshot: true,
          keys,
        },
        drag: {
          action,
          path: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
          returnScreenshot: true,
          keys,
        },
        scroll: { action, x: 10, y: 20, scrollX: 0, scrollY: -2, returnScreenshot: true, keys },
      };
      expect(requests.at(-1)?.body).toEqual(expected[action]);
      expect(keys).toEqual(["Control_L", "Shift_L"]);
    }
  );

  test.each([undefined, []])(
    "keeps omitted and empty modifier lists distinct: %s",
    async (keys) => {
      const { actions, session, requests } = await fixture();
      await actions.click(session, 10, 20, "left", 1, false, keys);
      await actions.drag(session, [{ x: 10, y: 20 }], false, keys);
      await actions.scroll(session, 10, 20, 0, 1, false, keys);
      for (const request of requests) {
        const body = request.body as Record<string, unknown>;
        if (keys === undefined) expect(body).not.toHaveProperty("keys");
        else expect(body.keys).toEqual([]);
      }
    }
  );

  test("uses current cursor when click or scroll coordinates are omitted", async () => {
    const { actions, session, requests } = await fixture();
    await actions.click(session);
    await actions.scroll(session, undefined, undefined, 0, 2, false, ["Control_L"]);
    expect(requests[0].body).toEqual({
      action: "click",
      button: "left",
      numClicks: 1,
      returnScreenshot: false,
    });
    expect(requests[1].body).toEqual({
      action: "scroll",
      scrollX: 0,
      scrollY: 2,
      returnScreenshot: false,
      keys: ["Control_L"],
    });
  });

  test("reports missing computer endpoint without issuing a request", async () => {
    const { actions, session, requests } = await fixture();
    await expect(
      actions.cursorPosition({ ...session, computerActionEndpoint: undefined })
    ).rejects.toBeInstanceOf(HyperbrowserError);
    expect(requests).toHaveLength(0);
  });

  test("preserves unsuccessful action responses", async () => {
    const { actions, session } = await fixture(false);
    expect(await actions.cursorPosition(session)).toMatchObject({
      success: false,
      error: "action failed",
    });
  });
});

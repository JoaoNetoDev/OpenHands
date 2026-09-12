import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, type RawData } from "ws";

import {
  AGENT_TUNNEL_PATH,
  createAgentTunnel,
  isSafePath,
  resolveAgentTunnelToken,
} from "../../scripts/agent-tunnel.mjs";

const loopbackHost = "127.0.0.1";

/** Subset of the envelope wire format the tests assert on. */
type TunnelFrame = {
  type?: string;
  id?: string;
  status?: number;
  method?: string;
  path?: string;
  body_b64?: string;
  headers?: Record<string, string>;
};

function parseFrame(raw: RawData): TunnelFrame {
  return JSON.parse(raw.toString()) as TunnelFrame;
}

/** Servers and tunnels opened by a test, torn down in afterEach. */
const openServers: Server[] = [];
const openTunnels: Array<{ close: () => Promise<void> }> = [];
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    socket.close();
  }
  for (const tunnel of openTunnels.splice(0)) {
    await tunnel.close();
  }
  for (const server of openServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function listenOnLoopback(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, loopbackHost, resolve));
  const address = server.address() as AddressInfo;
  return address.port;
}

/**
 * Issue a GET over node:http rather than global fetch: the repo-wide MSW setup
 * intercepts fetch and would answer /server_info with a mock, hiding whether the
 * ingress actually routed the request.
 */
function httpGet(url: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/** Start an HTTP server with the tunnel mounted on /agent-tunnel. */
async function startTunnelServer(bearerToken: string) {
  const tunnel = createAgentTunnel({
    bearerToken,
    logger: { info() {}, warn() {}, error() {} },
    requestTimeoutMs: 500,
  });
  openTunnels.push(tunnel);

  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith(AGENT_TUNNEL_PATH)) {
      tunnel.handleUpgrade(req, socket, head);
      return;
    }
    socket.destroy();
  });
  const port = await listenOnLoopback(server);
  openServers.push(server);

  return {
    tunnel,
    url: `ws://${loopbackHost}:${port}${AGENT_TUNNEL_PATH}`,
    httpUrl: `http://${loopbackHost}:${port}`,
  };
}

/** Connect a stand-in Tray and resolve once the handshake completes. */
async function connectTray(url: string, token: string) {
  const socket = new WebSocket(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  openSockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

describe("isSafePath", () => {
  it("accepts origin-relative paths", () => {
    expect(isSafePath("/server_info")).toBe(true);
    expect(isSafePath("/api/conversations?ids=a&ids=b")).toBe(true);
  });

  it("rejects paths that could retarget the request", () => {
    expect(isSafePath("//evil.example.com/x")).toBe(false);
    expect(isSafePath("http://evil.example.com/x")).toBe(false);
    expect(isSafePath("server_info")).toBe(false);
    expect(isSafePath("")).toBe(false);
    expect(isSafePath(undefined as unknown as string)).toBe(false);
  });
});

describe("resolveAgentTunnelToken", () => {
  it("returns the configured token", () => {
    expect(resolveAgentTunnelToken({ INGRESS_AGENT_TUNNEL_TOKEN: "abc" })).toBe(
      "abc",
    );
  });

  it("returns null when unset or empty", () => {
    expect(resolveAgentTunnelToken({})).toBeNull();
    expect(
      resolveAgentTunnelToken({ INGRESS_AGENT_TUNNEL_TOKEN: "" }),
    ).toBeNull();
  });
});

describe("createAgentTunnel", () => {
  it("requires a bearer token", () => {
    expect(() => createAgentTunnel({ bearerToken: "" })).toThrow(
      /bearerToken is required/,
    );
  });

  it("refuses an upgrade with the wrong bearer token", async () => {
    const { url } = await startTunnelServer("correct-token");

    const socket = new WebSocket(url, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    openSockets.push(socket);

    const status = await new Promise<number>((resolve, reject) => {
      socket.once("unexpected-response", (_req, res) =>
        resolve(res.statusCode!),
      );
      socket.once("error", (error: Error) => {
        // ws surfaces some refusals as a generic error; keep the test honest.
        if (String(error.message).includes("401")) {
          resolve(401);
          return;
        }
        reject(error);
      });
      socket.once("open", () =>
        reject(new Error("upgrade unexpectedly succeeded")),
      );
    });

    expect(status).toBe(401);
  });

  it("reports no tray before one connects", async () => {
    const { tunnel } = await startTunnelServer("token");
    expect(tunnel.hasTray()).toBe(false);
    await expect(
      tunnel.request({ method: "GET", path: "/server_info" }),
    ).rejects.toThrow(/no Tray is connected/);
  });

  it("rejects an unsafe path without sending it", async () => {
    const { tunnel } = await startTunnelServer("token");
    await expect(
      tunnel.request({ method: "GET", path: "//evil.example.com/x" }),
    ).rejects.toThrow(/unsafe path/);
  });

  it("forwards a request and resolves the matching response", async () => {
    const { tunnel, url } = await startTunnelServer("token");
    const tray = await connectTray(url, "token");

    const received: TunnelFrame[] = [];
    tray.on("message", (raw) => {
      const frame = parseFrame(raw);
      received.push(frame);
      tray.send(
        JSON.stringify({
          id: frame.id,
          status: 200,
          headers: { "content-type": "application/json" },
          body_b64: Buffer.from('{"ok":true}').toString("base64"),
        }),
      );
    });

    // Wait for the server side to register the connection.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(tunnel.hasTray()).toBe(true);

    const response = await tunnel.request({
      method: "POST",
      path: "/api/echo?limit=1",
      headers: { accept: "application/json" },
      body: Buffer.from("payload"),
    });

    expect(response.status).toBe(200);
    expect(Buffer.from(response.body_b64, "base64").toString()).toBe(
      '{"ok":true}',
    );
    expect(received[0].path).toBe("/api/echo?limit=1");
    expect(received[0].method).toBe("POST");
    expect(Buffer.from(received[0].body_b64 ?? "", "base64").toString()).toBe(
      "payload",
    );
  });

  it("answers a tray ping with a pong", async () => {
    const { url } = await startTunnelServer("token");
    const tray = await connectTray(url, "token");

    const pong = new Promise<TunnelFrame>((resolve) => {
      tray.on("message", (raw) => {
        const frame = parseFrame(raw);
        if (frame.type === "pong") {
          resolve(frame);
        }
      });
    });

    tray.send(JSON.stringify({ type: "ping" }));
    await expect(pong).resolves.toMatchObject({ type: "pong" });
  });

  it("times out when the tray never answers", async () => {
    const { tunnel, url } = await startTunnelServer("token");
    await connectTray(url, "token");
    await new Promise((resolve) => setTimeout(resolve, 30));

    await expect(
      tunnel.request({ method: "GET", path: "/server_info" }),
    ).rejects.toThrow(/timed out/);
  });

  it("ignores malformed frames without killing the session", async () => {
    const { tunnel, url } = await startTunnelServer("token");
    const tray = await connectTray(url, "token");
    await new Promise((resolve) => setTimeout(resolve, 30));

    tray.send("not json");
    tray.send(JSON.stringify({ status: 200 }));

    // The session must still be usable after the junk.
    tray.on("message", (raw) => {
      const frame = parseFrame(raw);
      tray.send(JSON.stringify({ id: frame.id, status: 204 }));
    });

    const response = await tunnel.request({ method: "GET", path: "/ping" });
    expect(response.status).toBe(204);
  });

  it("replaces an existing tray connection", async () => {
    const { tunnel, url } = await startTunnelServer("token");
    const first = await connectTray(url, "token");
    await new Promise((resolve) => setTimeout(resolve, 30));

    const closed = new Promise<number>((resolve) => {
      first.once("close", (code: number) => resolve(code));
    });

    await connectTray(url, "token");
    await expect(closed).resolves.toBe(1008);
    expect(tunnel.hasTray()).toBe(true);
  });

  it("sends a cancel frame when a pending request is cancelled", async () => {
    const { tunnel, url } = await startTunnelServer("token");
    const tray = await connectTray(url, "token");
    await new Promise((resolve) => setTimeout(resolve, 30));

    const cancelFrame = new Promise<TunnelFrame>((resolve) => {
      tray.on("message", (raw) => {
        const frame = parseFrame(raw);
        if (frame.type === "cancel") {
          resolve(frame);
        }
      });
    });

    const pending = tunnel.request({ method: "GET", path: "/api/slow" });
    pending.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 30));

    tunnel.cancel("vps-1");

    await expect(cancelFrame).resolves.toMatchObject({
      type: "cancel",
      id: "vps-1",
    });
    await expect(pending).rejects.toThrow();
  });
});

describe("ingress /agent-tunnel integration", () => {
  it("routes HTTP over the tunnel when a tray is connected", async () => {
    const { startIngress } = await import("../../scripts/ingress.mjs");

    const ingress = startIngress({
      port: 0,
      routes: {},
      defaultBackend: null,
      noReferrerPrefixes: [],
      runtimeServicesInfo: null,
      agentTunnelToken: "token",
      agentTunnelRoutes: ["/server_info", "/api"],
    });
    openServers.push(ingress as unknown as Server);
    await new Promise<void>((resolve) => ingress.once("listening", resolve));
    const port = (ingress.address() as AddressInfo).port;

    const tray = await connectTray(
      `ws://${loopbackHost}:${port}${AGENT_TUNNEL_PATH}`,
      "token",
    );
    tray.on("message", (raw) => {
      const frame = parseFrame(raw);
      if (frame.type) {
        return;
      }
      tray.send(
        JSON.stringify({
          id: frame.id,
          status: 200,
          headers: { "content-type": "text/plain" },
          body_b64: Buffer.from("from-tray").toString("base64"),
        }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const response = await httpGet(
      `http://${loopbackHost}:${port}/api/server_info`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toBe("from-tray");
  });

  it("returns 502 for a tunnel route with no tray connected", async () => {
    const { startIngress } = await import("../../scripts/ingress.mjs");

    const ingress = startIngress({
      port: 0,
      routes: {},
      defaultBackend: null,
      noReferrerPrefixes: [],
      runtimeServicesInfo: null,
      agentTunnelToken: "token",
      agentTunnelRoutes: ["/server_info", "/api"],
    });
    openServers.push(ingress as unknown as Server);
    await new Promise<void>((resolve) => ingress.once("listening", resolve));
    const port = (ingress.address() as AddressInfo).port;

    const response = await httpGet(
      `http://${loopbackHost}:${port}/api/server_info`,
    );
    expect(response.status).toBe(502);
  });

  // The agent-server exposes /server_info at the root while everything else
  // lives under /api, so the tunnel must be able to claim several prefixes.
  it("serves a root-level route over the tunnel alongside /api", async () => {
    const { startIngress } = await import("../../scripts/ingress.mjs");

    const ingress = startIngress({
      port: 0,
      routes: {},
      defaultBackend: null,
      noReferrerPrefixes: [],
      runtimeServicesInfo: null,
      agentTunnelToken: "token",
      agentTunnelRoutes: ["/server_info", "/api"],
    });
    openServers.push(ingress as unknown as Server);
    await new Promise<void>((resolve) => ingress.once("listening", resolve));
    const port = (ingress.address() as AddressInfo).port;

    const tray = await connectTray(
      `ws://${loopbackHost}:${port}${AGENT_TUNNEL_PATH}`,
      "token",
    );
    const seen: string[] = [];
    tray.on("message", (raw) => {
      const frame = parseFrame(raw);
      if (frame.type) {
        return;
      }
      seen.push(String(frame.path));
      tray.send(
        JSON.stringify({
          id: frame.id,
          status: 200,
          headers: { "content-type": "application/json" },
          body_b64: Buffer.from('{"version":"1.46.0"}').toString("base64"),
        }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const root = await httpGet(`http://${loopbackHost}:${port}/server_info`);
    const api = await httpGet(`http://${loopbackHost}:${port}/api/settings`);

    expect(root.status).toBe(200);
    expect(root.body).toBe('{"version":"1.46.0"}');
    expect(api.status).toBe(200);
    expect(seen).toEqual(["/server_info", "/api/settings"]);
  });

  it("leaves non-tunnel routes to the local backend", async () => {
    const { startIngress } = await import("../../scripts/ingress.mjs");

    const ingress = startIngress({
      port: 0,
      routes: {},
      defaultBackend: null,
      noReferrerPrefixes: [],
      runtimeServicesInfo: null,
      agentTunnelToken: "token",
      agentTunnelRoutes: ["/server_info", "/api"],
    });
    openServers.push(ingress as unknown as Server);
    await new Promise<void>((resolve) => ingress.once("listening", resolve));
    const port = (ingress.address() as AddressInfo).port;

    const tray = await connectTray(
      `ws://${loopbackHost}:${port}${AGENT_TUNNEL_PATH}`,
      "token",
    );
    const seen: string[] = [];
    tray.on("message", (raw) => {
      const frame = parseFrame(raw);
      if (!frame.type) seen.push(String(frame.path));
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    // No local backend is configured, so this 503s instead of going to the tray.
    const response = await httpGet(`http://${loopbackHost}:${port}/sockets`);
    expect(response.status).toBe(503);
    expect(seen).toEqual([]);
  });
});

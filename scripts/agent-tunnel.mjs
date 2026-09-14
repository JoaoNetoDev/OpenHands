#!/usr/bin/env node
/**
 * Agent Tunnel — VPS side of the OpenHands Tray bridge.
 *
 * A single local Tray process dials this endpoint over outbound WSS and exposes
 * its local agent-server through it. This module terminates that WebSocket and
 * exchanges request/response envelopes with the Tray; it is NOT a passthrough
 * proxy (unlike the generic upgrade handler in ingress.mjs), because there is no
 * local upstream to forward to — the Tray is on the other side of the socket.
 *
 * Wire format (one JSON envelope per WebSocket message):
 *   VPS  -> Tray: { id, method, path, headers, body_b64 }
 *                 { type: "ping" } | { type: "cancel", id }
 *   Tray -> VPS : { id, status, headers, body_b64 }
 *                 { type: "pong" }
 *
 * Security invariants:
 *   - The bearer token is compared in constant time; a mismatch is refused with
 *     HTTP 401 before any WebSocket handshake completes.
 *   - Paths are forced origin-relative so a compromised peer cannot make the
 *     Tray issue requests to arbitrary hosts.
 */

import { timingSafeEqual } from "node:crypto";
import process from "node:process";

import { WebSocketServer } from "ws";

export const AGENT_TUNNEL_PATH = "/agent-tunnel";

/** Decoded body size above which the Tray replies with a Binary frame. */
export const BINARY_THRESHOLD = 64 * 1024;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const CLOSE_POLICY_VIOLATION = 1008;

/**
 * Constant-time string comparison that tolerates unequal lengths.
 * @param {string} a
 * @param {string} b
 */
function safeEqual(a, b) {
  const left = Buffer.from(a ?? "", "utf8");
  const right = Buffer.from(b ?? "", "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Reject anything that is not an origin-relative path. A leading "//" is
 * protocol-relative and would let the peer retarget the request's host.
 * @param {string} path
 */
export function isSafePath(path) {
  return (
    typeof path === "string" && path.startsWith("/") && !path.startsWith("//")
  );
}

/**
 * @param {object} options
 * @param {string} options.bearerToken Token the Tray must present.
 * @param {Console|object} [options.logger]
 * @param {number} [options.requestTimeoutMs]
 */
export function createAgentTunnel({
  bearerToken,
  logger = console,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof bearerToken !== "string" || bearerToken.length === 0) {
    throw new Error("createAgentTunnel: bearerToken is required");
  }

  const wss = new WebSocketServer({ noServer: true });
  /** @type {import("ws").WebSocket | null} */
  let tray = null;
  /** @type {Map<string, {resolve: Function, timer: NodeJS.Timeout, cancel: Function}>} */
  const pending = new Map();
  let nextId = 0;
  let closed = false;

  const expectedHeader = `Bearer ${bearerToken}`;

  function rejectUpgrade(socket, status, message) {
    if (socket.writable) {
      socket.write(
        `HTTP/1.1 ${status} ${message}\r\n` +
          "Connection: close\r\n" +
          "Content-Length: 0\r\n" +
          "\r\n",
      );
    }
    socket.destroy();
  }

  function settlePending(error) {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      pending.delete(id);
    }
  }

  function send(frame) {
    if (!tray || tray.readyState !== tray.OPEN) {
      throw new Error("agent-tunnel: no Tray is connected");
    }
    tray.send(JSON.stringify(frame));
  }

  function onMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(raw.toString("utf8"));
    } catch {
      logger.warn?.("agent-tunnel: dropping malformed frame");
      return;
    }
    if (!frame || typeof frame !== "object") {
      return;
    }

    if (frame.type === "ping") {
      try {
        send({ type: "pong" });
      } catch {
        // The socket is going away; the close handler cleans up.
      }
      return;
    }

    if (typeof frame.id !== "string") {
      logger.warn?.("agent-tunnel: dropping frame without id");
      return;
    }
    const entry = pending.get(frame.id);
    if (!entry) {
      // A late response after a timeout; nothing is waiting for it.
      return;
    }
    pending.delete(frame.id);
    clearTimeout(entry.timer);
    entry.resolve(frame);
  }

  /**
   * Accept (or refuse) an HTTP upgrade on the tunnel path.
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:stream").Duplex} socket
   * @param {Buffer} head
   */
  function handleUpgrade(req, socket, head) {
    if (!safeEqual(req.headers.authorization ?? "", expectedHeader)) {
      logger.warn?.("agent-tunnel: rejected upgrade with invalid bearer token");
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (tray) {
        // Only one Tray per endpoint: the newest connection wins, so a stale
        // process cannot keep receiving traffic after a restart.
        logger.warn?.("agent-tunnel: replacing the active Tray connection");
        settlePending(new Error("agent-tunnel: Tray connection replaced"));
        tray.close(CLOSE_POLICY_VIOLATION, "replaced by a newer connection");
      }
      tray = ws;
      logger.info?.("agent-tunnel: Tray connected");

      ws.on("message", onMessage);
      ws.on("error", (error) =>
        logger.warn?.(`agent-tunnel: socket error: ${error.message}`),
      );
      ws.on("close", () => {
        if (tray === ws) {
          tray = null;
          settlePending(new Error("agent-tunnel: Tray disconnected"));
          logger.info?.("agent-tunnel: Tray disconnected");
        }
      });
    });
  }

  /**
   * Forward one request to the connected Tray and await its response.
   * @param {{method: string, path: string, headers?: Record<string,string>, body?: Buffer}} request
   */
  function request({ method, path, headers = {}, body }) {
    if (!isSafePath(path)) {
      return Promise.reject(
        new Error(`agent-tunnel: unsafe path ${JSON.stringify(path)}`),
      );
    }
    if (!tray) {
      return Promise.reject(new Error("agent-tunnel: no Tray is connected"));
    }

    const id = `vps-${++nextId}`;
    const frame = {
      id,
      method,
      path,
      headers,
      body_b64:
        body && body.length > 0 ? Buffer.from(body).toString("base64") : "",
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`agent-tunnel: request ${id} timed out`));
      }, requestTimeoutMs);
      timer.unref?.();

      pending.set(id, { resolve, reject, timer });

      try {
        send(frame);
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
        return;
      }

      // A request no longer worth waiting for should stop occupying the Tray.
      const cancel = () => {
        try {
          send({ type: "cancel", id });
        } catch {
          // The connection is already gone.
        }
      };

      // Expose cancellation to callers that gave up (e.g. the browser aborted).
      pending.get(id).cancel = cancel;
    });
  }

  /** Cancel an in-flight request. */
  function cancel(id) {
    const entry = pending.get(id);
    if (!entry) {
      return;
    }
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.cancel?.();
    entry.reject(new Error(`agent-tunnel: request ${id} cancelled`));
  }

  /**
   * Proxy a Node HTTP request over the tunnel and write the reply.
   * Used by ingress when a route is configured to target the active Tray.
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function proxyHttp(req, res) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }

    let frame;
    try {
      frame = await request({
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: collectHeaders(req),
        body: Buffer.concat(chunks),
      });
    } catch (error) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(String(error.message ?? error));
      return;
    }

    res.writeHead(frame.status ?? 502, frame.headers ?? {});
    res.end(frame.body_b64 ? Buffer.from(frame.body_b64, "base64") : undefined);
  }

  function hasTray() {
    return Boolean(tray && tray.readyState === tray.OPEN);
  }

  async function close() {
    closed = true;
    settlePending(new Error("agent-tunnel: shutting down"));
    if (tray) {
      tray.close(1001, "server shutting down");
      tray = null;
    }
    // Force-close any remaining sockets so wss.close() can complete; otherwise
    // a lingering client would keep the callback pending forever.
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise((resolve) => wss.close(() => resolve()));
  }

  return {
    handleUpgrade,
    request,
    cancel,
    proxyHttp,
    hasTray,
    close,
    get isClosed() {
      return closed;
    },
  };
}

function collectHeaders(req) {
  const headers = {};
  const raw = req.rawHeaders ?? [];
  for (let i = 0; i < raw.length; i += 2) {
    headers[raw[i]] = raw[i + 1];
  }
  return headers;
}

/**
 * Resolve the tunnel bearer token from the environment, if configured.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveAgentTunnelToken(env = process.env) {
  const token = env.INGRESS_AGENT_TUNNEL_TOKEN;
  return typeof token === "string" && token.length > 0 ? token : null;
}

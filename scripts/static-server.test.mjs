import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startStaticServer } from "./static-server.mjs";

const servers = [];
const dirs = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const startOnTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "static-server-test-"));
  dirs.push(dir);
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "index.html"), "<!doctype html><html></html>");

  const server = await startStaticServer({
    dir,
    host: "127.0.0.1",
    port: 0,
    routes: {},
  });
  servers.push(server);

  const { port } = server.address();
  return { dir, origin: `http://127.0.0.1:${port}` };
};

describe("static-server asset serving", () => {
  it("serves an asset written to the docroot after the server started", async () => {
    const { dir, origin } = await startOnTempDir();

    // Regression: `sirv` without `dev: true` indexes the docroot once at
    // startup, so assets produced by a `npm run build` that runs while the
    // service is up 404 forever until it restarts — the blank-screen
    // production outage in docs/bugs/deploy-tela-branca-assets-404/FICHA.md.
    await writeFile(
      join(dir, "assets", "late-DEADBEEF.js"),
      "export const late = true;\n",
    );

    const response = await fetch(`${origin}/assets/late-DEADBEEF.js`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("export const late = true;");
  });

  it("keeps the immutable cache header on hashed assets", async () => {
    const { dir, origin } = await startOnTempDir();
    await writeFile(join(dir, "assets", "hashed-CAFEBABE.js"), "export {};\n");

    const response = await fetch(`${origin}/assets/hashed-CAFEBABE.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("content-type")).toBe(
      "application/javascript; charset=utf-8",
    );
  });

  it("still 404s an asset that does not exist", async () => {
    const { origin } = await startOnTempDir();

    const response = await fetch(`${origin}/assets/missing-00000000.js`);

    expect(response.status).toBe(404);
  });
});

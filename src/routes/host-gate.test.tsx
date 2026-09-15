import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { isAikHostname } from "./host-gate";
import { clientLoader as indexHomeClientLoader } from "./index-home";

// F-02-1 fix: the `<Routes>` imperative spike from the previous version of
// this file broke every `clientLoader` in the moved tree — only the
// file-routes/data-router convention (`HydratedRouter`) invokes
// `clientLoader`. AIK is now a normal file-routes subtree under `/__aik`
// (`src/routes.ts`), reached only via a redirect from `routes/index-home.tsx`
// `clientLoader` when the hostname is an AIK vhost (SPEC §2.1 fallback).
// `host-gate.tsx` itself shrinks to the pure hostname predicate below.

function stubHostname(hostname: string) {
  vi.stubGlobal("location", { ...window.location, hostname });
}

describe("isAikHostname", () => {
  it("is true for the configured AIK vhost", () => {
    expect(isAikHostname("aik.zadotec.com.br")).toBe(true);
  });

  it("is false for the Agent Canvas vhost and other hosts", () => {
    expect(isAikHostname("openhands.zadotec.com.br")).toBe(false);
    expect(isAikHostname("localhost")).toBe(false);
  });
});

describe("index-home clientLoader host redirect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to /__aik on an AIK vhost, ahead of any pinned-home redirect", async () => {
    stubHostname("aik.zadotec.com.br");

    const response = indexHomeClientLoader() as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/__aik");
  });

  it("does not redirect on the default Agent Canvas vhost with no pinned home", () => {
    stubHostname("openhands.zadotec.com.br");

    const result = indexHomeClientLoader();

    expect(result).toBeNull();
  });
});

describe("regression: routes.ts data router still runs clientLoader after the move", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Closes F-02-3: proves a route mounted the same way `src/routes.ts`
  // mounts it (a data router, via `createRoutesStub`, which — like
  // `HydratedRouter` — is the framework-mode convention that actually
  // invokes `clientLoader`) runs its loader and lands where the loader
  // says, using the same `index-home.tsx` module `routes.ts` wires at `/`.
  it("runs index-home's clientLoader and redirects an AIK vhost to /__aik", async () => {
    stubHostname("aik.zadotec.com.br");

    const RouterStub = createRoutesStub([
      {
        path: "/",
        loader: indexHomeClientLoader,
        Component: () => <div data-testid="agent-canvas-home" />,
      },
      {
        path: "/__aik",
        Component: () => <div data-testid="aik-landing" />,
      },
    ]);

    render(<RouterStub initialEntries={["/"]} />);

    await waitFor(() =>
      expect(screen.getByTestId("aik-landing")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("agent-canvas-home")).not.toBeInTheDocument();
  });

  it("runs index-home's clientLoader and stays on / for the Agent Canvas vhost", async () => {
    stubHostname("openhands.zadotec.com.br");

    const RouterStub = createRoutesStub([
      {
        path: "/",
        loader: indexHomeClientLoader,
        Component: () => <div data-testid="agent-canvas-home" />,
      },
      {
        path: "/__aik",
        Component: () => <div data-testid="aik-landing" />,
      },
    ]);

    render(<RouterStub initialEntries={["/"]} />);

    await waitFor(() =>
      expect(screen.getByTestId("agent-canvas-home")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("aik-landing")).not.toBeInTheDocument();
  });
});

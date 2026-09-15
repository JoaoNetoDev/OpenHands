import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Routes, Route } from "react-router";
import i18n from "i18next";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import HostGate from "./host-gate";

// `root-layout.tsx` (`MainApp`) pulls in the sidebar, alert banner, command
// menu, and a handful of network-backed hooks that are already covered by
// other suites. This test's job is to prove the SPEC §2.1 risk — that a
// `<Routes>` mounted imperatively inside the data router (via the `*` splat
// route -> `host-gate.tsx`) matches paths and delegates correctly by
// hostname — not to re-verify `MainApp` itself. Stub it to an `<Outlet/>`
// passthrough so the assertions stay focused on routing.
vi.mock("./root-layout", async () => {
  const { Outlet } = await import("react-router");
  return {
    default: () => (
      <div data-testid="agent-canvas-root-layout">
        <Outlet />
      </div>
    ),
  };
});

// `HomeScreen` (the default "/" route inside `AgentCanvasApp`) renders the
// recommended-automations rail, which observes its container via
// `ResizeObserver` — not stubbed globally by `vitest.setup.ts`. Provide a
// no-op so the real, unmocked route tree can mount for this test.
class ResizeObserverStub {
  observe() {}

  unobserve() {}

  disconnect() {}
}
// Assigned directly (not via `vi.stubGlobal`) so `afterEach`'s
// `vi.unstubAllGlobals()` (needed to reset the per-test hostname stub below)
// does not also remove this one between tests. `vitest.setup.ts` replaces
// the global `window` binding with a stub object distinct from
// `globalThis`, so both need the assignment for the bare `ResizeObserver`
// identifier components resolve through `window` to work.
(
  globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
).ResizeObserver = ResizeObserverStub;
(
  window as unknown as { ResizeObserver: typeof ResizeObserverStub }
).ResizeObserver = ResizeObserverStub;

function stubHostname(hostname: string) {
  vi.stubGlobal("location", { ...window.location, hostname });
}

function renderHostGate(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ActiveBackendProvider>
          {/* Mirrors production nesting: `routes.ts` registers `route("*",
              "routes/host-gate.tsx")` inside the app's data router; wrapping
              HostGate in an outer `<Routes><Route path="*" .../></Routes>`
              here reproduces "a `<Routes>` nested inside another router's
              splat route", the exact pattern SPEC §2.1 (F-SPEC-5) flagged as
              unproven. */}
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="*" element={<HostGate />} />
            </Routes>
          </MemoryRouter>
        </ActiveBackendProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("HostGate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts AikRoutes (AIK placeholder) when the hostname is an AIK vhost", () => {
    stubHostname("aik.zadotec.com.br");

    renderHostGate("/");

    expect(screen.getByTestId("aik-layout")).toBeInTheDocument();
    expect(screen.getByTestId("aik-systems-board")).toBeInTheDocument();
  });

  it("resolves :systemId inside the nested AikRoutes <Routes> tree", () => {
    stubHostname("aik.zadotec.com.br");

    renderHostGate("/system-1");

    expect(screen.getByTestId("aik-layout")).toBeInTheDocument();
    expect(screen.getByTestId("aik-phases-board")).toBeInTheDocument();
    expect(screen.queryByTestId("aik-systems-board")).not.toBeInTheDocument();
  });

  it("resolves the nested :systemId/fases/:phaseId route inside AikRoutes", () => {
    stubHostname("aik.zadotec.com.br");

    renderHostGate("/system-1/fases/phase-1");

    expect(screen.getByTestId("aik-layout")).toBeInTheDocument();
    expect(screen.getByTestId("aik-tasks-board")).toBeInTheDocument();
  });

  it("mounts AgentCanvasApp when the hostname is not an AIK vhost", () => {
    stubHostname("openhands.zadotec.com.br");

    renderHostGate("/");

    expect(screen.getByTestId("agent-canvas-root-layout")).toBeInTheDocument();
    expect(screen.queryByTestId("aik-layout")).not.toBeInTheDocument();
  });

  it("regression: an existing Agent Canvas route (/board) still renders via AgentCanvasApp", () => {
    stubHostname("openhands.zadotec.com.br");

    renderHostGate("/board");

    // Default test environment has no active workspace configured, so
    // `BoardListRoute` renders its "no active workspace" state — the
    // point here is that the `/board` path reached `BoardListRoute` at
    // all (proving the moved route tree still matches), not which of its
    // internal states is showing.
    expect(screen.getByTestId("agent-canvas-root-layout")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-board-no-workspace")).toBeInTheDocument();
  });
});

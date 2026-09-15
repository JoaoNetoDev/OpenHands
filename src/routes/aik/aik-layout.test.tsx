import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { renderWithProviders, useParamsMock } from "test-utils";
import AikLayout from "#/routes/aik/aik-layout";
import { useAikBoardStore } from "#/stores/aik-board-store";

// `AikLayout` now wraps its subtree in `ReactRouterNavigationProvider`
// (fix for the E2E-discovered bug: AIK's `useNavigation()` fell back to
// the inert default `navigate: noop` because nothing wired the real
// react-router hooks in for the AIK route tree — see `aik-layout.tsx`'s
// comment). That provider calls react-router's own `useNavigation()`,
// which requires a *data* router (`createMemoryRouter`/`RouterProvider`),
// not just a plain `<MemoryRouter>` — same pattern `src/root.test.tsx`
// uses for the equivalent real-router wrapper at the Agent Canvas root.
function renderAikLayout() {
  const router = createMemoryRouter(
    [{ path: "/__aik/sys-1", Component: AikLayout }],
    { initialEntries: ["/__aik/sys-1"] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

function setSystemParam(systemId: string | undefined, phaseId?: string) {
  useParamsMock.mockReturnValue({
    conversationId: "test-conversation-id",
    ...(systemId ? { systemId } : {}),
    ...(phaseId ? { phaseId } : {}),
  });
}

describe("AikLayout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSystemParam("sys-1");
  });

  // Unmounting *before* switching back to real timers matters: the
  // polling interval is registered against the fake clock, so flipping to
  // real timers first (as a bare `vi.useRealTimers()` in `afterEach` would)
  // orphans it — the component's cleanup then calls the real `clearInterval`
  // against an id the fake clock never recognizes, leaking a live interval
  // into the next test. Each test unmounts explicitly, still under fake
  // timers, before this hook runs.
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // `useAikBoardStore.getState().syncFromFile` is the *same* function
  // reference across tests (the zustand test mock only resets state, not
  // action identities — see `__mocks__/zustand.ts`), and this project's
  // vitest config has neither `restoreMocks` nor `clearMocks` set. So
  // `vi.spyOn` returns the very same spy every time and keeps accumulating
  // call history unless it's cleared right after creation.
  function spyOnSyncFromFile() {
    const spy = vi.spyOn(useAikBoardStore.getState(), "syncFromFile");
    spy.mockClear();
    return spy;
  }

  it("renders the breadcrumb and outlet slot", () => {
    const { unmount } = renderAikLayout();

    expect(screen.getByTestId("aik-layout")).toBeInTheDocument();
    expect(screen.getByTestId("aik-breadcrumb")).toBeInTheDocument();

    unmount();
  });

  it("starts polling (syncFromFile) on mount when systemId is present", () => {
    const syncFromFileSpy = spyOnSyncFromFile();

    const { unmount } = renderAikLayout();

    expect(syncFromFileSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4000);
    expect(syncFromFileSpy).toHaveBeenCalledTimes(1);
    expect(syncFromFileSpy).toHaveBeenCalledWith("sys-1");

    vi.advanceTimersByTime(4000);
    expect(syncFromFileSpy).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("stops polling on unmount", () => {
    const syncFromFileSpy = spyOnSyncFromFile();

    const { unmount } = renderAikLayout();

    vi.advanceTimersByTime(4000);
    expect(syncFromFileSpy).toHaveBeenCalledTimes(1);

    unmount();

    vi.advanceTimersByTime(20000);
    expect(syncFromFileSpy).toHaveBeenCalledTimes(1);
  });

  it("does not start polling when there is no systemId", () => {
    setSystemParam(undefined);
    const syncFromFileSpy = spyOnSyncFromFile();

    const { unmount } = renderAikLayout();

    vi.advanceTimersByTime(10000);
    expect(syncFromFileSpy).not.toHaveBeenCalled();

    unmount();
  });
});

import { test, expect, type Page } from "@playwright/test";

/**
 * Every route (including `/__aik/*`) is wrapped by `src/root.tsx`, which
 * gates on a configured backend before rendering `<Outlet/>` at all — a
 * fresh browser profile with no `openhands-backends` in `localStorage`
 * shows the "Add a backend" onboarding screen instead of any AIK screen,
 * confirmed against the real `dev:mock` server before writing this seed.
 * Same shape/values as `tests/e2e/mock-llm/utils/mock-llm-helpers.ts`'s
 * `seedLocalStorage`, minus the real-backend-only analytics PATCH (this
 * config's backend is MSW-mocked in-browser, not a live agent-server).
 */
async function seedLocalBackend(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("openhands-onboarded", "1");
    window.localStorage.setItem("analytics-consent", "false");
    window.localStorage.setItem("openhands-telemetry-consent", "denied");
    window.localStorage.setItem("openhands-telemetry-first-use", "true");
    window.localStorage.setItem(
      "openhands-backends",
      JSON.stringify([
        {
          id: "default-local",
          name: "Local",
          host: window.location.origin,
          apiKey: "mock-api-key",
          kind: "local",
        },
      ]),
    );
    window.localStorage.setItem(
      "openhands-active-backend",
      JSON.stringify({ backendId: "default-local", orgId: null }),
    );
  });
}

/**
 * SPRINT-11 (SPEC §7 "E2E"): CA-02 — a deep link to a task board loaded
 * *directly* (no prior client-side navigation inside the app) must render
 * the correct AIK screen. This is the one thing a Vitest/Testing Library
 * render can never prove: those tests always mount the router with an
 * already-hydrated React tree, they never exercise a cold `page.goto()`
 * against the real dev server the way a browser hitting the URL bar does.
 *
 * SPEC §2.1: the `<Routes>`-inside-splat spike was rejected (see
 * `src/routes/host-gate.tsx`'s comment) in favor of registering AIK as a
 * normal file-routes subtree under the reserved `/__aik` prefix
 * (`src/routes.ts`). So the URL this test hits is the fallback shape,
 * `/__aik/<systemId>/fases/<phaseId>`, not the hostname-rewritten
 * `aik.zadotec.com.br/<systemId>/fases/<phaseId>` from SPEC §2.1's
 * original (rejected) design — CA-02's routing guarantee is about the
 * URL->component mapping, which is identical either way; only the
 * *prefix* changed between the spike and its accepted fallback.
 *
 * No system/phase/task is seeded for these ids: `useAikBoardStore` starts
 * empty on every fresh page load (no `persist` middleware), so a cold
 * `page.goto()` can never carry pre-existing store state anyway — the
 * only thing a deep link can prove ahead of any data is that the route
 * itself resolves to the right component tree on a hard load, which is
 * exactly what CA-02 is about (F-TECH-2 regression: the router matching a
 * splat + nested dynamic segments on first paint, not just after a
 * client-side push).
 */
test.describe("AIK deep link (CA-02)", () => {
  test("loading /__aik/<systemId>/fases/<phaseId> directly renders AikTasksBoard", async ({
    page,
  }) => {
    await seedLocalBackend(page);
    const systemId = "11111111-1111-4111-8111-111111111111";
    const phaseId = "22222222-2222-4222-8222-222222222222";

    const response = await page.goto(`/__aik/${systemId}/fases/${phaseId}`);
    expect(response?.ok()).toBe(true);

    // The layout shell (breadcrumb + outlet + conversation panel) and the
    // tasks board itself both mounted on the very first paint of this
    // navigation — no intermediate "not found"/404 flash from a client
    // redirect, which is the failure mode CA-02 guards against.
    // F-11-3: first paint of an AIK route in this environment can take
    // ~6.7s isolated (worse under parallel execution) — not a functional
    // bug, so only these post-goto assertions get a wider timeout instead
    // of touching the suite-wide default in playwright.config.ts.
    await expect(page.getByTestId("aik-layout")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("aik-tasks-board")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByTestId("aik-tasks-board-not-found"),
    ).not.toBeVisible();

    // All 4 fixed columns render (RF-06), proving `AikTasksBoard` — not
    // some fallback/blank screen — is what actually mounted.
    for (const columnId of ["backlog", "in_progress", "in_review", "done"]) {
      await expect(
        page.getByTestId(`aik-tasks-column-${columnId}`),
      ).toBeVisible();
    }
  });

  test("loading /__aik directly (root, no navigation) renders AikSystemsBoard", async ({
    page,
  }) => {
    // Companion case for CA-01/CA-02: the *root* of the AIK subtree also
    // has to resolve on a cold load, not only the two-level-deep task
    // board URL above.
    await seedLocalBackend(page);
    const response = await page.goto("/__aik");
    expect(response?.ok()).toBe(true);

    await expect(page.getByTestId("aik-systems-board")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByTestId("aik-systems-board-create-button"),
    ).toBeVisible();
  });

  test("reloading (F5) on a deep task-board URL still renders the same screen", async ({
    page,
  }) => {
    // A second, harder variant of CA-02: navigate once, then force a full
    // reload (not `page.goBack`/client push) on the same URL — this is
    // the scenario the SPEC's `<Routes>` spike actually failed under
    // (`clientLoader` never ran outside the data router), so it's worth
    // asserting explicitly rather than trusting the first `goto` alone.
    await seedLocalBackend(page);
    const systemId = "33333333-3333-4333-8333-333333333333";
    const phaseId = "44444444-4444-4444-8444-444444444444";
    await page.goto(`/__aik/${systemId}/fases/${phaseId}`);
    await expect(page.getByTestId("aik-tasks-board")).toBeVisible({
      timeout: 15000,
    });

    const response = await page.reload();
    expect(response?.ok()).toBe(true);
    await expect(page.getByTestId("aik-tasks-board")).toBeVisible({
      timeout: 15000,
    });
  });
});

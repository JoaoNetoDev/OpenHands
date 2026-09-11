import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExtensionsPageLayout } from "#/components/features/skills/extensions-page-layout";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";

function renderLayout(ui: Parameters<typeof ExtensionsPageLayout>[0]) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ActiveBackendProvider>
        <MemoryRouter>
          <ExtensionsPageLayout {...ui} />
        </MemoryRouter>
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

describe("ExtensionsPageLayout", () => {
  it("renders the extensions navigation alongside the provided children", () => {
    renderLayout({ children: <div data-testid="page-body" /> });

    expect(screen.getByTestId("extensions-navbar-desktop")).toBeInTheDocument();
    expect(screen.getByTestId("page-body")).toBeInTheDocument();
  });

  // Regression: on mobile the page-level header (title + actions + search
  // toolbar) must live OUTSIDE the scrolling <main> so it can stay pinned to
  // the top while the list of skills/mcp/plugins/apps cards scrolls beneath.
  // Embedding it inside <main> is the bug that caused those routes to lose
  // their title bar + filter toolbar on a phone.
  it("renders the optional header prop as a sibling of the scrolling main, not inside it", () => {
    renderLayout({
      header: <div data-testid="page-header" />,
      children: <div data-testid="page-body" />,
    });

    const headerWrapper = screen.getByTestId("page-header").parentElement;
    const main = screen.getByTestId("page-body").parentElement;
    expect(headerWrapper).not.toBeNull();
    expect(main).not.toBeNull();
    expect(headerWrapper).not.toBe(main);
    // The sticky wrapper must declare sticky positioning so the header pins
    // to the top of its scrolling ancestor (the <main>). On mobile the
    // desktop extensions sidebar is hidden, so without `sticky top-0` the
    // header scrolls away with the content.
    expect(headerWrapper!.className).toMatch(/\bsticky\b/);
    expect(headerWrapper!.className).toMatch(/\btop-0\b/);
  });
});

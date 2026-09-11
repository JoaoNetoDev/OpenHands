import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsLayout } from "#/components/features/settings/settings-layout";
import { OSS_NAV_ITEMS } from "#/constants/settings-nav";
import { SettingsNavRenderedItem } from "#/hooks/use-settings-nav-items";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";

const navigationItems: SettingsNavRenderedItem[] = OSS_NAV_ITEMS.map(
  (item) => ({
    type: "item",
    item,
  }),
);

type SettingsLayoutArgs = Omit<
  Parameters<typeof SettingsLayout>[0],
  "navigationItems"
>;

function renderLayout(args: SettingsLayoutArgs) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ActiveBackendProvider>
        <MemoryRouter>
          <SettingsLayout navigationItems={navigationItems} {...args} />
        </MemoryRouter>
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

describe("SettingsLayout", () => {
  it("renders the desktop sidebar alongside the provided child content", () => {
    renderLayout({ children: <div data-testid="page-body" /> });

    expect(screen.getByTestId("settings-navbar-desktop")).toBeInTheDocument();
    expect(screen.getByTestId("page-body")).toBeInTheDocument();
  });

  // Regression: on mobile the page-level header must live OUTSIDE the
  // scrolling <main> so it can stay pinned to the top while the form below
  // scrolls. Embedding it inside <main> is the bug that caused every
  // /settings/* route title to scroll off-screen on a phone.
  it("renders the optional header prop as a sibling of the scrolling main, not inside it", () => {
    renderLayout({
      header: <div data-testid="page-header" />,
      children: <div data-testid="page-body" />,
    });

    const header = screen.getByTestId("page-header").parentElement;
    const main = screen.getByTestId("page-body").parentElement;
    expect(header).not.toBeNull();
    expect(main).not.toBeNull();
    expect(header).not.toBe(main);
    // The sticky wrapper must declare sticky positioning so the header pins
    // to the top of its scrolling ancestor (the <main>). On mobile the
    // desktop sidebar is hidden, so without `sticky top-0` the header
    // scrolls away with the content.
    expect(header!.className).toMatch(/\bsticky\b/);
    expect(header!.className).toMatch(/\btop-0\b/);
  });
});

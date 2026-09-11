import { SettingsDesktopSidebar } from "./settings-desktop-sidebar";
import { SettingsNavRenderedItem } from "#/hooks/use-settings-nav-items";
import { settingsLayoutMainScrollClassName } from "#/utils/settings-like-page-layout-classes";

interface SettingsLayoutProps {
  children: React.ReactNode;
  navigationItems: SettingsNavRenderedItem[];
  /** Page-level header (title + subtitle). On mobile it pins to the top of
   *  the scrolling <main>; on desktop the sidebar gives context, so the
   *  unsticky wrapper fades into normal flow. */
  header?: React.ReactNode;
}

/**
 * Mirrors the extensions layout (Skills / MCP): aside and main are siblings,
 * and only the main column scrolls so the left nav stays pinned like
 * ExtensionsNavigation. On mobile the left nav is hidden, so callers should
 * pass the page-level `header` here to keep the title visible while content
 * scrolls beneath.
 */
export function SettingsLayout({
  children,
  navigationItems,
  header,
}: SettingsLayoutProps) {
  return (
    <div className="flex h-full flex-col md:pt-8">
      <div className="flex min-h-0 flex-1 gap-10 md:items-start">
        <SettingsDesktopSidebar navigationItems={navigationItems} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {header ? (
            <div className="sticky top-0 z-10 bg-base md:static">{header}</div>
          ) : null}
          <main className={settingsLayoutMainScrollClassName}>
            <div className="mx-auto w-full min-w-0 max-w-[800px]">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

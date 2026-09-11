import React from "react";
import { cn } from "#/utils/utils";
import { settingsLikeMainScrollClassName } from "#/utils/settings-like-page-layout-classes";
import { ExtensionsNavigation } from "./extensions-navigation";

interface ExtensionsPageLayoutProps {
  /** Page-level header (title + actions + toolbar). On mobile it pins to the
   *  top of the scrolling <main>; on desktop the ExtensionsNavigation rail
   *  is already `md:sticky`, so the unsticky wrapper fades into normal flow. */
  header?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared layout for the four extension routes (`/skills`, `/mcp`,
 * `/plugins`, `/apps`). On desktop the {@link ExtensionsNavigation} rail is
 * `md:sticky md:top-8` and gives the user constant context. On mobile that
 * rail is hidden, so the page-level header is the only signal of "where am
 * I?" — it has to stay pinned to the top instead of scrolling away with the
 * list of cards.
 */
export function ExtensionsPageLayout({
  header,
  children,
}: ExtensionsPageLayoutProps) {
  return (
    <div
      data-testid="extensions-page-layout"
      className="flex h-full gap-4 md:gap-6 md:pl-8 lg:gap-10 lg:pl-10"
    >
      <ExtensionsNavigation />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header ? (
          <div className="sticky top-0 z-10 bg-base md:static">{header}</div>
        ) : null}
        <main className={cn(settingsLikeMainScrollClassName, "h-full")}>
          {children}
        </main>
      </div>
    </div>
  );
}

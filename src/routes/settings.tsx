import { useMemo, useState } from "react";
import {
  Outlet,
  redirect,
  useLocation,
  useMatches,
  type ClientLoaderFunctionArgs,
} from "react-router";
import { useTranslation } from "react-i18next";
import OptionService from "#/api/option-service/option-service.api";
import { queryClient } from "#/query-client-config";
import { SettingsLayout } from "#/components/features/settings";
import { WebClientConfig } from "#/api/option-service/option.types";
import { QUERY_KEYS, CONFIG_CACHE_OPTIONS } from "#/hooks/query/query-keys";
import { Typography } from "#/ui/typography";
import { useBreakpoint } from "#/hooks/use-breakpoint";
import { useSettingsNavItems } from "#/hooks/use-settings-nav-items";
import { OSS_NAV_ITEMS } from "#/constants/settings-nav";
import {
  getFirstAvailablePath,
  isSettingsPageHidden,
} from "#/utils/settings-utils";
import { SettingsSectionHeaderProvider } from "#/contexts/settings-section-header-context";

// `Route.ClientLoaderArgs` used to come from `./+types/settings`, generated
// by react-router typegen from this file's entry in `routes.ts`. SPRINT-02
// moved that entry into `agent-canvas-app.tsx`'s imperative `<Routes>` tree
// (TECH §2.1), so `routes.ts` no longer declares this route and the
// generated module no longer exists. This clientLoader is not invoked by
// `<Routes>` mounted imperatively (only the file-routes data router runs
// `clientLoader`s) — it is effectively dead code post-move, kept as-is
// (content unchanged) except for this type import, which is swapped for
// the underlying react-router type so the file still typechecks.
export const clientLoader = async ({ request }: ClientLoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { pathname } = url;

  const config = await queryClient.fetchQuery<WebClientConfig>({
    queryKey: QUERY_KEYS.WEB_CLIENT_CONFIG,
    queryFn: OptionService.getConfig,
    ...CONFIG_CACHE_OPTIONS,
  });

  const featureFlags = config?.feature_flags;

  if (isSettingsPageHidden(pathname, featureFlags)) {
    const fallbackPath = getFirstAvailablePath(featureFlags);
    if (fallbackPath && fallbackPath !== pathname) {
      return redirect(fallbackPath);
    }
  }

  return null;
};

function SettingsScreen() {
  const { t } = useTranslation("openhands");
  const location = useLocation();
  const matches = useMatches();
  const navItems = useSettingsNavItems();
  const isMobile = useBreakpoint(768);
  const [hideSectionHeader, setHideSectionHeader] = useState(false);

  const { currentSectionTitle, currentSectionSubtitle } = useMemo(() => {
    // Resolve from the full list, not the listed subset: locked-to-Cloud
    // unlists most pages but they stay reachable via deep links (OHE-3168).
    const currentItem = OSS_NAV_ITEMS.find(
      (item) => item.to === location.pathname,
    );
    if (currentItem) {
      return {
        currentSectionTitle: currentItem.text,
        currentSectionSubtitle: currentItem.subtitle,
      };
    }
    const firstItem = navItems.find((item) => item.type === "item");
    if (firstItem?.type === "item") {
      return {
        currentSectionTitle: firstItem.item.text,
        currentSectionSubtitle: firstItem.item.subtitle,
      };
    }
    return {
      currentSectionTitle: "SETTINGS$TITLE",
      currentSectionSubtitle: null as string | null,
    };
  }, [navItems, location.pathname]);

  const routeHandle = matches.find((m) => m.pathname === location.pathname)
    ?.handle as { hideTitle?: boolean } | undefined;
  const isMobileHub = isMobile && location.pathname === "/settings";
  const shouldHideTitle =
    routeHandle?.hideTitle === true || isMobileHub || hideSectionHeader;

  return (
    <main data-testid="settings-screen" className="min-h-0">
      <SettingsSectionHeaderProvider
        setHideSectionHeader={setHideSectionHeader}
      >
        <SettingsLayout
          navigationItems={navItems}
          header={
            !shouldHideTitle ? (
              <div className="space-y-1">
                <Typography.H2>{t(currentSectionTitle)}</Typography.H2>
                {currentSectionSubtitle ? (
                  <p
                    data-testid="settings-page-subtitle"
                    className="text-sm leading-5 text-tertiary-light"
                  >
                    {t(currentSectionSubtitle)}
                  </p>
                ) : null}
              </div>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-6 pb-8">
            <Outlet />
          </div>
        </SettingsLayout>
      </SettingsSectionHeaderProvider>
    </main>
  );
}

export default SettingsScreen;

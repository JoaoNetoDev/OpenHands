import { redirect } from "react-router";
import { readPinnedHomeRoute } from "#/hooks/use-pinned-home-route";
import { isAikHostname } from "./host-gate";

/**
 * With a home pin set for the active backend + org, `/` redirects to the
 * pinned page. `readPinnedHomeRoute` only returns routes that currently
 * resolve (never `/` itself), so a stale pin falls back to the default
 * home with no error and no redirect loop; the built-in home stays
 * reachable unmodified at /conversations.
 *
 * On an AIK vhost (SPEC §2.1 fallback), `/` redirects to `/__aik` instead
 * — checked first, ahead of the pinned-home redirect, so AIK hostnames
 * never fall through to the Agent Canvas home.
 */
export const clientLoader = () => {
  if (isAikHostname(window.location.hostname)) return redirect("/__aik");
  const pinnedRoute = readPinnedHomeRoute();
  if (pinnedRoute) return redirect(pinnedRoute);
  return null;
};

export { default } from "./home";

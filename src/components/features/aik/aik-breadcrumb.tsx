import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { NavigationLink } from "#/components/shared/navigation-link";

export interface AikBreadcrumbProps {
  systemId?: string;
  phaseId?: string;
}

interface BreadcrumbSegment {
  key: string;
  label: string;
  to: string;
}

/**
 * Breadcrumb navigation for the AIK routes (SPEC §2.6): `sistema › fase`,
 * each segment a real navigable link, omitting segments that aren't
 * available yet (e.g. still on the systems board). Uses `NavigationLink`
 * (not react-router's `Link`) to match the app's navigation-context
 * pattern, so it renders correctly without a `<Router>` wrapper.
 */
export function AikBreadcrumb({ systemId, phaseId }: AikBreadcrumbProps) {
  const { t } = useTranslation("openhands");

  const segments: BreadcrumbSegment[] = [
    {
      key: "systems",
      label: t(I18nKey.AIK$BREADCRUMB_SYSTEMS),
      to: "/__aik",
    },
  ];

  if (systemId) {
    segments.push({
      key: "system",
      label: systemId,
      to: `/__aik/${systemId}`,
    });
  }

  if (systemId && phaseId) {
    segments.push({
      key: "phase",
      label: phaseId,
      to: `/__aik/${systemId}/fases/${phaseId}`,
    });
  }

  return (
    <nav
      aria-label={t(I18nKey.AIK$BREADCRUMB_SYSTEMS)}
      data-testid="aik-breadcrumb"
    >
      <ol className="flex items-center gap-1 text-sm text-white">
        {segments.map((segment, index) => (
          <li key={segment.key} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden="true">/</span>}
            <NavigationLink
              to={segment.to}
              data-testid={`aik-breadcrumb-${segment.key}`}
              className="hover:underline"
            >
              {segment.label}
            </NavigationLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}

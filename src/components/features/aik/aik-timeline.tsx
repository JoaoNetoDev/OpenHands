import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { AikTimelineEntry } from "#/types/aik";

export interface AikTimelineProps {
  entries: AikTimelineEntry[];
}

const KIND_LABEL_KEY: Record<AikTimelineEntry["kind"], I18nKey> = {
  comment: I18nKey.AIK$TIMELINE_KIND_COMMENT,
  status_change: I18nKey.AIK$TIMELINE_KIND_STATUS_CHANGE,
  run_started: I18nKey.AIK$TIMELINE_KIND_RUN_STARTED,
  run_stopped: I18nKey.AIK$TIMELINE_KIND_RUN_STOPPED,
  review_feedback: I18nKey.AIK$TIMELINE_KIND_REVIEW_FEEDBACK,
};

/**
 * Read-only timeline (SPEC §2.6): renders `entries` in chronological order
 * (`at` ascending), one item per entry, labelled by `kind`. Never uses
 * `dangerouslySetInnerHTML` — all text fields render as literal text via
 * JSX children, so hostile/HTML-bearing content (RNF-05/CA-36) is shown
 * verbatim rather than executed. Recording entries is out of scope
 * (SPRINT-06); this component only displays what it's given.
 */
export function AikTimeline({ entries }: AikTimelineProps) {
  const { t } = useTranslation("openhands");

  if (entries.length === 0) {
    return (
      <p data-testid="aik-timeline-empty" className="text-xs text-muted">
        {t(I18nKey.AIK$TIMELINE_EMPTY)}
      </p>
    );
  }

  const sorted = [...entries].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  return (
    <ol data-testid="aik-timeline" className="flex flex-col gap-2">
      {sorted.map((entry) => (
        <li
          key={entry.id}
          data-testid={`aik-timeline-entry-${entry.id}`}
          className="flex flex-col gap-0.5 text-sm text-white"
        >
          <span
            data-testid={`aik-timeline-entry-kind-${entry.id}`}
            className="text-xs uppercase text-muted"
          >
            {t(KIND_LABEL_KEY[entry.kind])}
          </span>
          {entry.text && (
            <span data-testid={`aik-timeline-entry-text-${entry.id}`}>
              {entry.text}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

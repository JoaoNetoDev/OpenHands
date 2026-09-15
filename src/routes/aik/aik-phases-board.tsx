// Rewritten by SPRINT-09 (Kanban de fases de um sistema, RF-05, RF-08,
// RF-09, RF-11, RF-12). Stub previously left by SPRINT-02.
import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { I18nKey } from "#/i18n/declaration";
import { useAikBoardStore } from "#/stores/aik-board-store";
import { useNavigation } from "#/context/navigation-context";
import { AikBreadcrumb } from "#/components/features/aik/aik-breadcrumb";
import { DeletePhaseConfirmDialog } from "#/components/features/aik/delete-phase-confirm-dialog";
import type { AikColumnId, AikErrorType, AikPhase } from "#/types/aik";

const AIK_PHASE_COLUMNS: AikColumnId[] = [
  "backlog",
  "in_progress",
  "in_review",
  "done",
];

const COLUMN_LABEL_KEYS: Record<AikColumnId, I18nKey> = {
  backlog: I18nKey.AIK$PHASES_COLUMN_BACKLOG,
  in_progress: I18nKey.KANBAN$COLUMN_IN_PROGRESS,
  in_review: I18nKey.AIK$PHASES_COLUMN_IN_REVIEW,
  done: I18nKey.KANBAN$COLUMN_DONE,
};

const ERROR_MESSAGE_KEYS: Record<AikErrorType, I18nKey> = {
  backend_down: I18nKey.AIK$PHASES_ERROR_BACKEND_DOWN,
  workspace_unreachable: I18nKey.AIK$PHASES_ERROR_WORKSPACE_UNREACHABLE,
  cloud_unsupported: I18nKey.AIK$PHASES_ERROR_GENERIC,
  conflict: I18nKey.AIK$PHASES_ERROR_GENERIC,
  parse_error: I18nKey.AIK$PHASES_ERROR_GENERIC,
};

const EMPTY_PHASES: AikPhase[] = [];

/**
 * Kanban of a system's phases (SPEC §2.6: `AikPhasesBoard` — no props,
 * resolves `systemId` from `useParams`). The 4 columns are fixed
 * (`backlog|in_progress|in_review|done`) and a phase's column is always
 * *derived* by the store from its child tasks (RF-09) — this screen only
 * reads `phasesBySystemId[systemId]`, it never writes a phase's
 * `columnId`.
 *
 * A phase card intentionally registers no drag sensor (no `useSortable`/
 * `useDraggable`): CA-08 requires the card to simply not be a draggable
 * item, not a draggable item that visually refuses the drag. Clicking a
 * card navigates to the phase's task board instead.
 */
export function AikPhasesBoard(): JSX.Element {
  const { systemId } = useParams<{ systemId: string }>();
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const [deletePhaseId, setDeletePhaseId] = useState<string | null>(null);

  const phases = useAikBoardStore((state) =>
    systemId
      ? (state.phasesBySystemId[systemId] ?? EMPTY_PHASES)
      : EMPTY_PHASES,
  );
  const error = useAikBoardStore((state) =>
    systemId ? state.errorBySystemId[systemId] : undefined,
  );
  const system = useAikBoardStore((state) =>
    state.systems.find((s) => s.id === systemId),
  );

  if (!systemId) {
    return <div data-testid="aik-phases-board" />;
  }

  const openPhase = (phaseId: string) => {
    navigate(`/__aik/${systemId}/fases/${phaseId}`);
  };

  return (
    <div data-testid="aik-phases-board" className="flex flex-col gap-4">
      <AikBreadcrumb systemId={systemId} />

      {error ? (
        <div
          data-testid="aik-phases-board-error"
          data-error-type={error.errorType}
          className="text-sm text-danger"
        >
          {t(ERROR_MESSAGE_KEYS[error.errorType], {
            name: system?.name ?? systemId,
          })}
        </div>
      ) : (
        <div className="flex gap-3">
          {AIK_PHASE_COLUMNS.map((columnId) => {
            const columnPhases = phases
              .filter((phase) => phase.columnId === columnId)
              .sort((a, b) => a.order - b.order);

            return (
              <div
                key={columnId}
                data-testid={`aik-phases-column-${columnId}`}
                className="flex flex-col gap-2 rounded-xl border border-[var(--oh-border)] bg-base-secondary p-3 min-h-40 w-full"
              >
                <h3 className="text-sm font-semibold text-white">
                  {t(COLUMN_LABEL_KEYS[columnId])}
                </h3>
                {columnPhases.length === 0 ? (
                  <p
                    data-testid={`aik-phases-column-empty-${columnId}`}
                    className="text-xs text-muted"
                  >
                    {t(I18nKey.AIK$PHASES_COLUMN_EMPTY)}
                  </p>
                ) : (
                  columnPhases.map((phase) => (
                    <div
                      key={phase.id}
                      data-testid={`aik-phase-card-${phase.id}`}
                      role="button"
                      tabIndex={0}
                      className="flex items-center justify-between gap-2 rounded-xl shadow-md p-3 cursor-pointer bg-base-tertiary border border-[var(--oh-border)]"
                      onClick={() => openPhase(phase.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          openPhase(phase.id);
                        }
                      }}
                    >
                      <p className="text-sm font-medium text-white">
                        {phase.title}
                      </p>
                      <button
                        type="button"
                        data-testid={`aik-phase-delete-${phase.id}`}
                        aria-label={t(I18nKey.AIK$PHASE_DELETE_BUTTON)}
                        className="text-xs text-danger underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeletePhaseId(phase.id);
                        }}
                      >
                        {t(I18nKey.AIK$PHASE_DELETE_BUTTON)}
                      </button>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {deletePhaseId && (
        <DeletePhaseConfirmDialog
          systemId={systemId}
          phaseId={deletePhaseId}
          onClose={() => setDeletePhaseId(null)}
        />
      )}
    </div>
  );
}

export default AikPhasesBoard;

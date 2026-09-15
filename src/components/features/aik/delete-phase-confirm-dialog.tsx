import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { useAikBoardStore } from "#/stores/aik-board-store";
import type { AikSystem, AikTask } from "#/types/aik";

const EMPTY_TASKS: AikTask[] = [];

interface DeletePhaseConfirmDialogProps {
  systemId: string;
  phaseId: string;
  onClose: () => void;
  onDeleted?: () => void;
}

/**
 * Confirms deletion of a phase, showing how many child tasks will be
 * removed with it (SPEC §4 / CA-09). Blocks the confirm button when any
 * child task has a live run — i.e. `system.activeAgentTaskId` currently
 * points at that task — since deleting the phase out from under a running
 * agent would orphan the conversation; the user needs to `stopAgent` first
 * (same edge case documented for phase deletion in SPEC §4).
 */
export function DeletePhaseConfirmDialog({
  systemId,
  phaseId,
  onClose,
  onDeleted,
}: DeletePhaseConfirmDialogProps) {
  const { t } = useTranslation("openhands");
  const tasks = useAikBoardStore(
    (state) => state.tasksBySystemId[systemId] ?? EMPTY_TASKS,
  );
  const system = useAikBoardStore((state) =>
    state.systems.find((s: AikSystem) => s.id === systemId),
  );
  const deletePhase = useAikBoardStore((state) => state.deletePhase);

  const childTasks = tasks.filter((task) => task.phaseId === phaseId);
  const hasLiveRun = childTasks.some(
    (task) => system?.activeAgentTaskId === task.id,
  );

  const handleConfirm = () => {
    if (hasLiveRun) return;
    deletePhase(phaseId);
    onDeleted?.();
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        data-testid="delete-phase-confirm-dialog"
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-sm"
      >
        <p className="text-sm text-white">
          {t(I18nKey.AIK$DELETE_PHASE_CONFIRM_MESSAGE)}
        </p>
        {childTasks.length > 0 && (
          <p
            data-testid="delete-phase-descendant-count"
            data-count={childTasks.length}
            className="text-sm text-muted"
          >
            {t(I18nKey.AIK$DELETE_PHASE_CONFIRM_DESCENDANTS, {
              count: childTasks.length,
            })}
          </p>
        )}
        {hasLiveRun && (
          <p
            data-testid="delete-phase-blocked-message"
            className="text-sm text-danger"
          >
            {t(I18nKey.AIK$DELETE_PHASE_BLOCKED_RUN)}
          </p>
        )}
        <div className="w-full flex justify-end gap-2">
          <BrandButton
            testId="cancel-button"
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            {t(I18nKey.BUTTON$CANCEL)}
          </BrandButton>
          <BrandButton
            testId="confirm-delete-button"
            type="button"
            variant="danger"
            isDisabled={hasLiveRun}
            onClick={handleConfirm}
          >
            {t(I18nKey.BUTTON$DELETE)}
          </BrandButton>
        </div>
      </div>
    </ModalBackdrop>
  );
}

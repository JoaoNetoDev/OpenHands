import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { useAikBoardStore } from "#/stores/aik-board-store";
import type { AikPhase, AikSystem, AikTask } from "#/types/aik";

const EMPTY_PHASES: AikPhase[] = [];
const EMPTY_TASKS: AikTask[] = [];

interface DeleteSystemConfirmDialogProps {
  system: AikSystem;
  onClose: () => void;
  onDeleted?: () => void;
}

/**
 * Confirms deletion of a system, showing the total count of descendant
 * phases + tasks (`phasesBySystemId[id].length + tasksBySystemId[id].length`,
 * CA-30 / SPEC §5) before removing the system, its phases and its tasks
 * from the store — same UX pattern as `delete-task-confirm-dialog.tsx`.
 */
export function DeleteSystemConfirmDialog({
  system,
  onClose,
  onDeleted,
}: DeleteSystemConfirmDialogProps) {
  const { t } = useTranslation("openhands");
  const phases = useAikBoardStore(
    (state) => state.phasesBySystemId[system.id] ?? EMPTY_PHASES,
  );
  const tasks = useAikBoardStore(
    (state) => state.tasksBySystemId[system.id] ?? EMPTY_TASKS,
  );
  const deleteSystem = useAikBoardStore((state) => state.deleteSystem);
  const descendantCount = phases.length + tasks.length;

  const handleConfirm = () => {
    deleteSystem(system.id);
    onDeleted?.();
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        data-testid="delete-system-confirm-dialog"
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-sm"
      >
        <h2 className="text-sm font-semibold text-white">
          {t(I18nKey.AIK$DELETE_SYSTEM_CONFIRM_TITLE)}
        </h2>
        <p className="text-sm text-white">
          {t(I18nKey.AIK$DELETE_SYSTEM_CONFIRM_MESSAGE)}
        </p>
        {descendantCount > 0 && (
          <p
            data-testid="delete-system-descendant-count"
            data-count={descendantCount}
            className="text-sm text-muted"
          >
            {t(I18nKey.AIK$DELETE_SYSTEM_CONFIRM_DESCENDANTS, {
              count: descendantCount,
            })}
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
            testId="confirm-delete-system-button"
            type="button"
            variant="danger"
            onClick={handleConfirm}
          >
            {t(I18nKey.AIK$DELETE_SYSTEM_CONFIRM_BUTTON)}
          </BrandButton>
        </div>
      </div>
    </ModalBackdrop>
  );
}

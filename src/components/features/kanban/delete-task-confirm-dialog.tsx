import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { collectDescendantIds } from "#/utils/kanban-tree";
import type { KanbanTask } from "#/types/kanban";

// Stable reference so the Zustand selector below doesn't return a fresh
// array on every call when the workspace has no tasks yet — returning a new
// `[]` literal each time defeats `useSyncExternalStore`'s reference equality
// check and causes an infinite render loop ("getSnapshot should be cached").
const EMPTY_TASKS: KanbanTask[] = [];

interface DeleteTaskConfirmDialogProps {
  workspaceId: string;
  taskId: string;
  onClose: () => void;
  onDeleted?: () => void;
}

/**
 * Confirms deletion of a task, showing how many descendants (children,
 * grandchildren, ...) will be removed along with it (RF-06 / CA-05). The
 * cascade text only appears when there is at least one descendant.
 */
export function DeleteTaskConfirmDialog({
  workspaceId,
  taskId,
  onClose,
  onDeleted,
}: DeleteTaskConfirmDialogProps) {
  const { t } = useTranslation("openhands");
  const tasks = useKanbanBoardStore(
    (state) => state.tasksByWorkspaceId[workspaceId] ?? EMPTY_TASKS,
  );
  const deleteTask = useKanbanBoardStore((state) => state.deleteTask);
  const descendantCount = collectDescendantIds(tasks, taskId).size;

  const handleConfirm = () => {
    deleteTask(workspaceId, taskId);
    onDeleted?.();
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        data-testid="delete-task-confirm-dialog"
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-sm"
      >
        <p className="text-sm text-white">
          {t(I18nKey.KANBAN$DELETE_CONFIRM_MESSAGE)}
        </p>
        {descendantCount > 0 && (
          <p
            data-testid="delete-task-descendant-count"
            data-count={descendantCount}
            className="text-sm text-muted"
          >
            {t(I18nKey.KANBAN$DELETE_CONFIRM_DESCENDANTS, {
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
            testId="confirm-delete-button"
            type="button"
            variant="danger"
            onClick={handleConfirm}
          >
            {t(I18nKey.BUTTON$DELETE)}
          </BrandButton>
        </div>
      </div>
    </ModalBackdrop>
  );
}

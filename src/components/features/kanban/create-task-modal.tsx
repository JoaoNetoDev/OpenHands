import { useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";

interface CreateTaskModalProps {
  workspaceId: string;
  /** `null` creates a level-1 task; otherwise a subtask of that parent. */
  parentId: string | null;
  onClose: () => void;
}

/**
 * Minimal creation form: required title + optional description. Calls
 * `createTask` on submit (SPEC §2.4).
 */
export function CreateTaskModal({
  workspaceId,
  parentId,
  onClose,
}: CreateTaskModalProps) {
  const { t } = useTranslation("openhands");
  const createTask = useKanbanBoardStore((state) => state.createTask);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const trimmedTitle = title.trim();
  const isValid = Boolean(trimmedTitle);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid) return;
    createTask(workspaceId, {
      title: trimmedTitle,
      description: description.trim() || undefined,
      parentId,
    });
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <form
        data-testid="create-task-modal"
        onSubmit={handleSubmit}
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-sm"
      >
        <h2 className="text-sm font-semibold text-white">
          {t(I18nKey.KANBAN$CREATE_TASK_TITLE)}
        </h2>
        <label className="flex flex-col gap-1 text-sm text-white">
          {t(I18nKey.KANBAN$TASK_TITLE_LABEL)}
          <input
            data-testid="kanban-task-title-input"
            className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-white">
          {t(I18nKey.KANBAN$TASK_DESCRIPTION_LABEL)}
          <textarea
            data-testid="kanban-task-description-input"
            className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
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
            testId="create-task-submit"
            type="submit"
            variant="primary"
            isDisabled={!isValid}
          >
            {t(I18nKey.BUTTON$CREATE)}
          </BrandButton>
        </div>
      </form>
    </ModalBackdrop>
  );
}

import React from "react";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanTask } from "#/types/kanban";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { getSafeUploadFileName } from "#/api/workspace-upload-path";
import { toBase64 } from "#/api/kanban-sintering.api";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { BrandButton } from "#/components/features/settings/brand-button";

const MAX_ATTACHMENT_BYTES = 256 * 1024;
// Rejects control characters in a sanitized file name (SPEC §2.4).
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f]/;

interface CardAttachmentsProps {
  workspaceId: string;
  task: KanbanTask;
}

/**
 * File picker + list for a task's attachments (SPEC §2.4). Validates size
 * (256 KB max) and file name (sanitized via `getSafeUploadFileName`,
 * rejecting control characters) *before* reading/accepting a file — a
 * rejected file never reaches `updateTask` and surfaces a clear error
 * toast instead.
 */
export function CardAttachments({ workspaceId, task }: CardAttachmentsProps) {
  const { t } = useTranslation("openhands");
  const updateTask = useKanbanBoardStore((state) => state.updateTask);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const attachments = task.attachments ?? [];

  const handleAddClick = () => {
    inputRef.current?.click();
  };

  const handleRemove = (attachmentId: string) => {
    updateTask(workspaceId, task.id, {
      attachments: attachments.filter((a) => a.id !== attachmentId),
    });
  };

  const handleFileSelect = async (files: FileList) => {
    const accepted = [...attachments];

    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        displayErrorToast(
          t(I18nKey.KANBAN$ATTACHMENT_TOO_LARGE, { name: file.name }),
        );

        continue;
      }

      let safeName: string;
      try {
        safeName = getSafeUploadFileName(file.name);
      } catch {
        displayErrorToast(
          t(I18nKey.KANBAN$ATTACHMENT_INVALID_NAME, { name: file.name }),
        );

        continue;
      }

      if (CONTROL_CHAR_RE.test(safeName)) {
        displayErrorToast(
          t(I18nKey.KANBAN$ATTACHMENT_INVALID_NAME, { name: file.name }),
        );

        continue;
      }

      const bytes = await file.arrayBuffer();

      const contentBase64 = await toBase64(bytes);

      accepted.push({
        id: uuidv4(),
        fileName: safeName,
        sizeBytes: file.size,
        contentBase64,
      });
    }

    if (accepted.length !== attachments.length) {
      updateTask(workspaceId, task.id, { attachments: accepted });
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    if (files && files.length > 0) {
      void handleFileSelect(files);
    }
    // Reset so selecting the same file again re-triggers onChange.
    // eslint-disable-next-line no-param-reassign
    event.target.value = "";
  };

  return (
    <div data-testid="card-attachments" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">
          {t(I18nKey.KANBAN$ATTACHMENTS_LABEL)}
        </h3>
        <BrandButton
          testId="card-attachments-add"
          type="button"
          variant="secondary"
          onClick={handleAddClick}
        >
          {t(I18nKey.KANBAN$ATTACHMENTS_ADD_BUTTON)}
        </BrandButton>
        <input
          ref={inputRef}
          data-testid="card-attachments-input"
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
      </div>
      {attachments.length === 0 ? (
        <p className="text-xs text-gray-400">
          {t(I18nKey.KANBAN$ATTACHMENTS_EMPTY)}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center justify-between gap-2 text-xs text-white"
            >
              <span data-testid={`card-attachment-name-${attachment.id}`}>
                {attachment.fileName}
              </span>
              <button
                type="button"
                data-testid={`card-attachment-remove-${attachment.id}`}
                aria-label={t(I18nKey.KANBAN$ATTACHMENT_REMOVE_BUTTON)}
                onClick={() => handleRemove(attachment.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

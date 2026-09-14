import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanTask } from "#/types/kanban";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { BrandButton } from "#/components/features/settings/brand-button";

interface ApproveRejectButtonsProps {
  workspaceId: string;
  task: KanbanTask;
}

/**
 * Human validation actions for a card sitting in the "pending_validation"
 * column (SPEC §2.7, CA-09). Renders nothing for any other column.
 *
 * "Reprovar" requires a non-empty reason before it can be confirmed — the
 * reason field is only revealed after clicking "Reprovar", mirroring the
 * confirm-dialog pattern used elsewhere in the kanban feature
 * (`delete-task-confirm-dialog.tsx`).
 */
export function ApproveRejectButtons({
  workspaceId,
  task,
}: ApproveRejectButtonsProps) {
  const { t } = useTranslation("openhands");
  const updateTask = useKanbanBoardStore((state) => state.updateTask);
  const [isRejecting, setIsRejecting] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [showError, setShowError] = React.useState(false);

  if (task.columnId !== "pending_validation") return null;

  const handleApprove = () => {
    updateTask(workspaceId, task.id, { columnId: "done" });
  };

  const handleStartReject = () => {
    setIsRejecting(true);
  };

  const handleCancelReject = () => {
    setIsRejecting(false);
    setReason("");
    setShowError(false);
  };

  const handleConfirmReject = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setShowError(true);
      return;
    }
    updateTask(workspaceId, task.id, {
      columnId: "todo",
      rejectionReason: trimmed,
    });
    setIsRejecting(false);
    setReason("");
    setShowError(false);
  };

  return (
    <div
      data-testid="kanban-approve-reject-buttons"
      className="flex flex-col gap-2"
    >
      {!isRejecting && (
        <div className="flex items-center gap-2">
          <BrandButton
            testId="kanban-approve-button"
            type="button"
            variant="primary"
            onClick={handleApprove}
          >
            {t(I18nKey.KANBAN$APPROVE_BUTTON)}
          </BrandButton>
          <BrandButton
            testId="kanban-reject-button"
            type="button"
            variant="danger"
            onClick={handleStartReject}
          >
            {t(I18nKey.KANBAN$REJECT_BUTTON)}
          </BrandButton>
        </div>
      )}

      {isRejecting && (
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm text-white">
            {t(I18nKey.KANBAN$REJECTION_REASON_LABEL)}
            <textarea
              data-testid="kanban-rejection-reason-input"
              className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
              value={reason}
              placeholder={t(I18nKey.KANBAN$REJECTION_REASON_PLACEHOLDER)}
              onChange={(e) => {
                setReason(e.target.value);
                if (showError) setShowError(false);
              }}
              required
            />
          </label>
          {showError && (
            <p
              data-testid="kanban-rejection-reason-error"
              className="text-sm text-danger"
            >
              {t(I18nKey.KANBAN$REJECTION_REASON_REQUIRED_ERROR)}
            </p>
          )}
          <div className="flex items-center gap-2">
            <BrandButton
              testId="kanban-confirm-reject-button"
              type="button"
              variant="danger"
              onClick={handleConfirmReject}
            >
              {t(I18nKey.KANBAN$CONFIRM_REJECT_BUTTON)}
            </BrandButton>
            <BrandButton
              testId="kanban-cancel-reject-button"
              type="button"
              variant="secondary"
              onClick={handleCancelReject}
            >
              {t(I18nKey.KANBAN$CANCEL_REJECT_BUTTON)}
            </BrandButton>
          </div>
        </div>
      )}
    </div>
  );
}

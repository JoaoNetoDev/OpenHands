import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanTask } from "#/types/kanban";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { getActiveBackend } from "#/api/backend-registry/active-store";
import { sinterizeTask } from "#/api/kanban-sintering.api";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import { formatRelativeTime } from "#/utils/format-relative-time";
import { BrandButton } from "#/components/features/settings/brand-button";
import { StyledTooltip } from "#/components/shared/buttons/styled-tooltip";
import { LoadingSpinner } from "#/components/shared/loading-spinner";

interface SinterizeButtonProps {
  workspaceId: string;
  workspacePath: string | undefined;
  task: KanbanTask;
}

/**
 * "Sinterizar" action (SPEC §2.5): writes the task's `.md` context file and
 * attachments to the workspace via `sinterizeTask`. Disabled — with an
 * explanatory tooltip — when the active backend is Cloud (RNF-04, the
 * sintering flow only works against a local workspace) or when no
 * workspace path could be resolved for the task's workspace.
 */
export function SinterizeButton({
  workspaceId,
  workspacePath,
  task,
}: SinterizeButtonProps) {
  const { t, i18n } = useTranslation("openhands");
  const updateTask = useKanbanBoardStore((state) => state.updateTask);
  const [isPending, setIsPending] = React.useState(false);

  const isCloud = getActiveBackend().backend.kind === "cloud";
  const isDisabled = isCloud || !workspacePath;

  const handleClick = async () => {
    if (!workspacePath) return;
    setIsPending(true);
    const result = await sinterizeTask(workspacePath, task);
    setIsPending(false);
    if (result.ok) {
      updateTask(workspaceId, task.id, {
        lastSinteredAt: new Date().toISOString(),
      });
      displaySuccessToast(t(I18nKey.KANBAN$SINTERIZE_SUCCESS));
    } else {
      displayErrorToast(result.error);
    }
  };

  const tooltipContent = isCloud
    ? t(I18nKey.KANBAN$SINTERIZE_CLOUD_UNAVAILABLE)
    : !workspacePath
      ? t(I18nKey.KANBAN$SINTERIZE_NO_WORKSPACE)
      : "";

  const button = (
    <BrandButton
      testId="kanban-sinterize-button"
      type="button"
      variant="secondary"
      isDisabled={isDisabled || isPending}
      aria-busy={isPending}
      onClick={() => void handleClick()}
      startContent={isPending ? <LoadingSpinner size="small" /> : undefined}
    >
      {task.lastSinteredAt
        ? t(I18nKey.KANBAN$RESINTERIZE_BUTTON)
        : t(I18nKey.KANBAN$SINTERIZE_BUTTON)}
    </BrandButton>
  );

  return (
    <div className="flex items-center gap-2">
      {tooltipContent ? (
        <StyledTooltip content={tooltipContent}>{button}</StyledTooltip>
      ) : (
        button
      )}
      {task.lastSinteredAt && (
        <span
          data-testid="kanban-sinterize-last-sintered"
          className="text-xs text-gray-400"
        >
          {t(I18nKey.KANBAN$SINTERIZED_AT, {
            time: formatRelativeTime(task.lastSinteredAt, i18n.language, t),
          })}
        </span>
      )}
    </div>
  );
}

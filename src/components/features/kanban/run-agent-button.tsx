import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanTask } from "#/types/kanban";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { startFeatdevelopConversation } from "#/api/kanban-pipeline.api";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { BrandButton } from "#/components/features/settings/brand-button";
import { NavigationLink } from "#/components/shared/navigation-link";
import { LoadingSpinner } from "#/components/shared/loading-spinner";

interface RunAgentButtonProps {
  workspaceId: string;
  workspacePath: string | undefined;
  task: KanbanTask;
}

/**
 * "Rodar com agente" action (SPEC §2.5): starts a new conversation running
 * the `/featdevelop` skill for this card's `featureSlug`, in the resolved
 * workspace. Enabled only when both `task.featureSlug` and `workspacePath`
 * are defined (RF-03).
 *
 * Every click starts a brand-new conversation (RF-06) — `linkedConversationId`
 * is overwritten with the freshly returned id each time, it never merges or
 * reuses a previous conversation. Failure shows an error toast and leaves
 * `linkedConversationId` untouched, so the button stays available for retry.
 */
export function RunAgentButton({
  workspaceId,
  workspacePath,
  task,
}: RunAgentButtonProps) {
  const { t } = useTranslation("openhands");
  const updateTask = useKanbanBoardStore((state) => state.updateTask);
  const [isPending, setIsPending] = React.useState(false);

  const isDisabled = !task.featureSlug || !workspacePath;

  const handleClick = async () => {
    if (!task.featureSlug || !workspacePath) return;
    setIsPending(true);
    const result = await startFeatdevelopConversation(workspacePath, task);
    setIsPending(false);
    if (result.ok) {
      updateTask(workspaceId, task.id, {
        linkedConversationId: result.conversationId,
      });
    } else {
      displayErrorToast(result.error);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <BrandButton
        testId="kanban-run-agent-button"
        type="button"
        variant="primary"
        isDisabled={isDisabled || isPending}
        aria-busy={isPending}
        onClick={() => void handleClick()}
        startContent={isPending ? <LoadingSpinner size="small" /> : undefined}
      >
        {t(I18nKey.KANBAN$RUN_AGENT)}
      </BrandButton>
      {task.linkedConversationId && (
        <NavigationLink
          to={`/conversations/${task.linkedConversationId}`}
          className="text-sm text-primary hover:underline"
          data-testid="kanban-open-conversation-link"
        >
          {t(I18nKey.KANBAN$OPEN_CONVERSATION)}
        </NavigationLink>
      )}
    </div>
  );
}

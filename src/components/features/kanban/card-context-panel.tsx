import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanTask } from "#/types/kanban";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { RichTextInput } from "#/components/features/settings/system-settings/rich-text-input";

interface CardContextPanelProps {
  workspaceId: string;
  task: KanbanTask;
}

/**
 * Two rich-text fields on the task drawer — user-authored context and
 * agent-authored context (SPEC §2.3) — each persisted independently via
 * `updateTask` on change, reusing `RichTextInput` (sanitization/caret
 * handling already solved there) without modification.
 */
export function CardContextPanel({ workspaceId, task }: CardContextPanelProps) {
  const { t } = useTranslation("openhands");
  const updateTask = useKanbanBoardStore((state) => state.updateTask);

  const handleUserContextChange = (html: string) => {
    updateTask(workspaceId, task.id, { userContextHtml: html });
  };

  const handleAgentContextChange = (html: string) => {
    updateTask(workspaceId, task.id, { agentContextHtml: html });
  };

  return (
    <div data-testid="card-context-panel" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm text-white">
        {t(I18nKey.KANBAN$USER_CONTEXT_LABEL)}
        <RichTextInput
          testId="card-user-context"
          label={t(I18nKey.KANBAN$USER_CONTEXT_LABEL)}
          defaultValueHtml={task.userContextHtml ?? ""}
          onChange={handleUserContextChange}
        />
      </div>
      <div className="flex flex-col gap-1 text-sm text-white">
        {t(I18nKey.KANBAN$AGENT_CONTEXT_LABEL)}
        <RichTextInput
          testId="card-agent-context"
          label={t(I18nKey.KANBAN$AGENT_CONTEXT_LABEL)}
          defaultValueHtml={task.agentContextHtml ?? ""}
          onChange={handleAgentContextChange}
        />
      </div>
    </div>
  );
}

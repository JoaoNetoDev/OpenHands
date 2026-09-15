import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { AikTask } from "#/types/aik";
import { useAikBoardStore } from "#/stores/aik-board-store";
import { BrandButton } from "#/components/features/settings/brand-button";

export interface AikTaskCardProps {
  task: AikTask;
  onOpen: (task: AikTask) => void;
}

const PRIORITY_LABEL_KEY: Record<AikTask["priority"], I18nKey> = {
  p0: I18nKey.AIK$TASK_PRIORITY_P0,
  p1: I18nKey.AIK$TASK_PRIORITY_P1,
  p2: I18nKey.AIK$TASK_PRIORITY_P2,
  p3: I18nKey.AIK$TASK_PRIORITY_P3,
};

/**
 * Sortable card for `AikTasksBoard` (SPEC §2.6). Mirrors the drag pattern
 * of `KanbanCard` (`kanban-card.tsx`): Enter opens the task, every other
 * key (notably Space/arrows) is forwarded to `@dnd-kit`'s `KeyboardSensor`
 * so keyboard-driven column transitions keep working (RNF-06/CA-37).
 *
 * The Executar/Parar button is intentionally a separate interactive
 * element (its own `onClick`/`onKeyDown` stop propagation) so disabling it
 * (CA-11: blocked by dependency, or another task's run is live) never
 * disables the drag handle itself — only the button.
 */
export function AikTaskCard({ task, onOpen }: AikTaskCardProps) {
  const { t } = useTranslation("openhands");
  const system = useAikBoardStore((state) =>
    state.systems.find((s) => s.id === task.systemId),
  );
  const blockingTask = useAikBoardStore((state) =>
    task.blockedByTaskId
      ? (state.tasksBySystemId[task.systemId] ?? []).find(
          (t) => t.id === task.blockedByTaskId,
        )
      : undefined,
  );
  const startAgent = useAikBoardStore((state) => state.startAgent);
  const stopAgent = useAikBoardStore((state) => state.stopAgent);

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleOpen = () => onOpen(task);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      handleOpen();
      return;
    }
    listeners?.onKeyDown?.(event);
  };

  const isRunning = Boolean(
    task.linkedConversationId && system?.activeAgentTaskId === task.id,
  );
  const isBlockedByDependency = Boolean(
    blockingTask && blockingTask.columnId !== "done",
  );
  const isBlockedByOtherRun = Boolean(
    system?.activeAgentTaskId && system.activeAgentTaskId !== task.id,
  );
  const canRun =
    task.executorType === "agent" &&
    Boolean(task.agentBriefing) &&
    !isBlockedByDependency &&
    !isBlockedByOtherRun;

  const blockReason = isBlockedByOtherRun
    ? t(I18nKey.AIK$TASK_RUN_BLOCKED_OTHER_RUN)
    : isBlockedByDependency
      ? t(I18nKey.AIK$TASK_RUN_BLOCKED_DEPENDENCY)
      : undefined;

  const handleRunClick = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    if (isRunning) {
      void stopAgent(task.id);
    } else {
      void startAgent(task.id);
    }
  };

  const handleRunKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`aik-task-card-${task.id}`}
      className="flex flex-col gap-2 rounded-xl shadow-md p-3 cursor-pointer bg-base-secondary border border-[var(--oh-border)]"
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-white">{task.title}</p>
        <span
          data-testid={`aik-task-card-priority-${task.id}`}
          className="text-xs uppercase text-muted"
        >
          {t(PRIORITY_LABEL_KEY[task.priority])}
        </span>
      </div>

      {isBlockedByDependency && (
        <p
          data-testid={`aik-task-card-blocked-${task.id}`}
          className="text-xs text-warning"
        >
          {t(I18nKey.AIK$TASK_BLOCKED_INDICATOR)}
        </p>
      )}

      {isRunning && (
        <p
          data-testid={`aik-task-card-running-${task.id}`}
          className="text-xs text-success"
        >
          {t(I18nKey.AIK$TASK_RUN_INDICATOR)}
        </p>
      )}

      {task.lastRunFilesChanged && task.lastRunFilesChanged.length > 0 && (
        <ul
          data-testid={`aik-task-card-files-changed-${task.id}`}
          className="flex flex-col gap-0.5 text-xs text-muted"
        >
          {task.lastRunFilesChanged.map((file) => (
            <li key={file} data-testid={`aik-task-card-file-${task.id}`}>
              {file}
            </li>
          ))}
        </ul>
      )}

      <div
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleRunKeyDown}
      >
        <BrandButton
          testId={`aik-task-card-run-${task.id}`}
          type="button"
          variant={isRunning ? "danger" : "primary"}
          isDisabled={!isRunning && !canRun}
          onClick={handleRunClick}
        >
          {isRunning
            ? t(I18nKey.AIK$TASK_STOP_BUTTON)
            : t(I18nKey.AIK$TASK_RUN_BUTTON)}
        </BrandButton>
        {!isRunning && blockReason && (
          <p
            data-testid={`aik-task-card-run-blocked-reason-${task.id}`}
            className="text-xs text-warning"
          >
            {blockReason}
          </p>
        )}
      </div>
    </div>
  );
}

export default AikTaskCard;

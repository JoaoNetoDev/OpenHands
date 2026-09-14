import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanTask } from "#/types/kanban";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";

interface KanbanCardProps {
  workspaceId: string;
  task: KanbanTask;
  onClick?: (task: KanbanTask) => void;
}

/**
 * Sortable card rendered inside a `KanbanColumn`. Shows the task title and,
 * when it has children, an "X of Y" completed-subtasks indicator (RF-08),
 * where "completed" means the child's `columnId === "done"`.
 */
export function KanbanCard({ workspaceId, task, onClick }: KanbanCardProps) {
  const { t } = useTranslation("openhands");
  const getChildren = useKanbanBoardStore((state) => state.getChildren);
  const children = getChildren(workspaceId, task.id);
  const completedChildren = children.filter((c) => c.columnId === "done");

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`kanban-card-${task.id}`}
      className="p-3 cursor-pointer bg-base-secondary border border-[var(--oh-border)]"
      onClick={() => onClick?.(task)}
    >
      <p className="text-sm font-medium text-white">{task.title}</p>
      {children.length > 0 && (
        <p
          data-testid={`kanban-card-progress-${task.id}`}
          data-completed={completedChildren.length}
          data-total={children.length}
          className="mt-1 text-xs text-muted"
        >
          {t(I18nKey.KANBAN$SUBTASK_PROGRESS, {
            completed: completedChildren.length,
            total: children.length,
          })}
        </p>
      )}
    </Card>
  );
}

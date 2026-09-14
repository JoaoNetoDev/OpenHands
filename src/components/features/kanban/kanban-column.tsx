import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanColumnId, KanbanTask } from "#/types/kanban";
import { KanbanCard } from "./kanban-card";

interface KanbanColumnProps {
  workspaceId: string;
  columnId: KanbanColumnId;
  /** Display label for this column, resolved by the caller via `getColumnsForTask` (SPEC §2.7) — the column no longer owns a fixed id-to-label map, since a board can mix the 3-column generic preset and the 6-column featdevelop preset across cards. */
  label: string;
  tasks: KanbanTask[];
  onCardClick?: (task: KanbanTask) => void;
}

/**
 * Droppable column of a kanban board level. `tasks` is expected to already
 * be scoped (to the workspace, level and `columnId`) and sorted by `order`.
 */
export function KanbanColumn({
  workspaceId,
  columnId,
  label,
  tasks,
  onCardClick,
}: KanbanColumnProps) {
  const { t } = useTranslation("openhands");
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const sortedTasks = [...tasks].sort((a, b) => a.order - b.order);

  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-column-${columnId}`}
      className={`flex flex-col gap-2 rounded-xl border border-[var(--oh-border)] p-3 min-h-40 w-full ${
        isOver ? "bg-[var(--oh-interactive-hover)]" : "bg-base-secondary"
      }`}
    >
      <h3 className="text-sm font-semibold text-white">{label}</h3>
      <SortableContext
        items={sortedTasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          {sortedTasks.length === 0 ? (
            <p
              data-testid={`kanban-column-empty-${columnId}`}
              className="text-xs text-muted"
            >
              {t(I18nKey.KANBAN$COLUMN_EMPTY)}
            </p>
          ) : (
            sortedTasks.map((task) => (
              <KanbanCard
                key={task.id}
                workspaceId={workspaceId}
                task={task}
                onClick={onCardClick}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

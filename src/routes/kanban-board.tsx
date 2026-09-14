import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useSystemSettings } from "#/hooks/use-system-settings";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanColumnId, KanbanTask } from "#/types/kanban";
import { KanbanColumn } from "#/components/features/kanban/kanban-column";
import { getColumnsForTask } from "#/components/features/kanban/kanban-column-presets";
import { CreateTaskModal } from "#/components/features/kanban/create-task-modal";
import { KanbanTaskDrawer } from "#/components/features/kanban/kanban-task-drawer";
import { BrandButton } from "#/components/features/settings/brand-button";

// Stable reference so the Zustand selector below doesn't return a fresh
// array on every call when the workspace has no tasks yet — a fresh `[]`
// literal each render defeats `useSyncExternalStore`'s reference equality
// check and causes an infinite render loop ("getSnapshot should be cached").
const EMPTY_TASKS: KanbanTask[] = [];

/**
 * `/board` route: renders the level-1 kanban board for the active
 * workspace (SPEC §2.4). The active workspace is resolved from
 * `useSystemSettings().settings.defaultWorkspaceId` (TECH §1) — when it is
 * absent, the board shows the "no active workspace" state (SPEC §4)
 * instead of the regular "no tasks yet" empty state (RF-10 / CA-01).
 */
export default function KanbanBoardRoute() {
  const { t } = useTranslation("openhands");
  const { settings } = useSystemSettings();
  const workspaceId = settings.defaultWorkspaceId;

  const allTasks = useKanbanBoardStore((state) =>
    workspaceId
      ? (state.tasksByWorkspaceId[workspaceId] ?? EMPTY_TASKS)
      : EMPTY_TASKS,
  );
  const moveTask = useKanbanBoardStore((state) => state.moveTask);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [openTask, setOpenTask] = useState<KanbanTask | null>(null);
  // Require a small pointer-move distance before a drag activates, so a
  // plain click (no movement) still opens the card's drawer instead of
  // being consumed as a zero-distance drag (RNF-02 keyboard support kept
  // via `KeyboardSensor`).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const level1Tasks = allTasks.filter((task) => task.parentId === null);
  const hasTasks = level1Tasks.length > 0;

  // A board can mix level-1 cards with different column presets (some with
  // `featureSlug`, some without — SPEC §2.7 / TECH §2.3). The column set is
  // therefore no longer a single fixed constant: it's the union of each
  // visible card's own preset, deduplicated by `id` and keeping first-seen
  // order so the featdevelop columns and the generic columns each render
  // once, in a stable order, even when both presets are present at once.
  const columnsById = new Map<KanbanColumnId, string>();
  level1Tasks.forEach((task) => {
    getColumnsForTask(task).forEach((column) => {
      if (!columnsById.has(column.id)) columnsById.set(column.id, column.label);
    });
  });
  const columns = Array.from(columnsById, ([id, label]) => ({ id, label }));

  if (!workspaceId) {
    return (
      <div
        data-testid="kanban-board-no-workspace"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <h1 className="text-lg font-semibold text-white">
          {t(I18nKey.KANBAN$NO_WORKSPACE_TITLE)}
        </h1>
        <p className="text-sm text-muted max-w-md">
          {t(I18nKey.KANBAN$NO_WORKSPACE_DESCRIPTION)}
        </p>
      </div>
    );
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const toColumnId = over.id as KanbanColumnId;
    const destSiblings = level1Tasks.filter(
      (task) => task.columnId === toColumnId && task.id !== active.id,
    );
    moveTask(workspaceId, active.id as string, toColumnId, destSiblings.length);
  };

  return (
    <div
      data-testid="kanban-board-screen"
      className="flex flex-1 flex-col gap-4 p-4 overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-white">
          {t(I18nKey.KANBAN$BOARD_TITLE)}
        </h1>
        <BrandButton
          testId="kanban-board-add-task"
          type="button"
          variant="primary"
          onClick={() => setCreateModalOpen(true)}
        >
          {t(I18nKey.KANBAN$ADD_TASK_BUTTON)}
        </BrandButton>
      </div>

      {hasTasks ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div
            data-testid="kanban-board-columns"
            className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            {columns.map(({ id: columnId, label }) => (
              <KanbanColumn
                key={columnId}
                workspaceId={workspaceId}
                columnId={columnId}
                label={label}
                tasks={level1Tasks.filter((task) => task.columnId === columnId)}
                onCardClick={setOpenTask}
              />
            ))}
          </div>
        </DndContext>
      ) : (
        <div
          data-testid="kanban-board-empty-state"
          className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
        >
          <p className="text-sm text-muted">
            {t(I18nKey.KANBAN$EMPTY_STATE_TITLE)}
          </p>
          <BrandButton
            testId="kanban-board-empty-state-cta"
            type="button"
            variant="primary"
            onClick={() => setCreateModalOpen(true)}
          >
            {t(I18nKey.KANBAN$ADD_TASK_BUTTON)}
          </BrandButton>
        </div>
      )}

      {createModalOpen && (
        <CreateTaskModal
          workspaceId={workspaceId}
          parentId={null}
          onClose={() => setCreateModalOpen(false)}
        />
      )}
      {openTask && (
        <KanbanTaskDrawer
          workspaceId={workspaceId}
          task={openTask}
          onClose={() => setOpenTask(null)}
        />
      )}
    </div>
  );
}

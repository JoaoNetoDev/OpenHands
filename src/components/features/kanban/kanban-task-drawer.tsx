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
import type { KanbanColumnId, KanbanTask } from "#/types/kanban";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { KanbanColumn } from "./kanban-column";
import { CreateTaskModal } from "./create-task-modal";
import { DeleteTaskConfirmDialog } from "./delete-task-confirm-dialog";

const COLUMNS: KanbanColumnId[] = ["todo", "in_progress", "done"];

// Stable reference so the Zustand selector below doesn't return a fresh
// array on every call when a task has no children yet — a fresh `[]`
// literal each render defeats `useSyncExternalStore`'s reference equality
// check and causes an infinite render loop ("getSnapshot should be cached").
const EMPTY_TASKS: KanbanTask[] = [];

interface KanbanTaskDrawerProps {
  workspaceId: string;
  task: KanbanTask;
  onClose: () => void;
}

/**
 * Drawer opened from a `KanbanCard` click. Shows the clicked task's own
 * details (editable title/description, delete action) plus a 3-column
 * board of its children (SPEC §2.4), reusing `KanbanColumn`/`KanbanCard`
 * recursively — clicking a child card opens another `KanbanTaskDrawer`
 * nested on top of this one, one level down. Level 3 tasks don't offer
 * "add subtask" since a level-4 task doesn't exist (RF-04).
 */
export function KanbanTaskDrawer({
  workspaceId,
  task,
  onClose,
}: KanbanTaskDrawerProps) {
  const { t } = useTranslation("openhands");
  const children = useKanbanBoardStore(
    (state) => state.tasksByWorkspaceId[workspaceId] ?? EMPTY_TASKS,
  ).filter((c) => c.parentId === task.id);
  const updateTask = useKanbanBoardStore((state) => state.updateTask);
  const moveTask = useKanbanBoardStore((state) => state.moveTask);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [openChildTask, setOpenChildTask] = useState<KanbanTask | null>(null);
  // Same click-vs-drag disambiguation as `kanban-board.tsx` (see comment
  // there) — a plain click on a child card must open its drawer, not be
  // swallowed as a zero-distance drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const canHaveChildren = task.level < 3;

  const handleFieldBlur = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitle(task.title);
      return;
    }
    if (
      trimmedTitle === task.title &&
      description === (task.description ?? "")
    ) {
      return;
    }
    updateTask(workspaceId, task.id, {
      title: trimmedTitle,
      description: description.trim() || undefined,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const toColumnId = over.id as KanbanColumnId;
    const destSiblings = children.filter(
      (c) => c.columnId === toColumnId && c.id !== active.id,
    );
    moveTask(workspaceId, active.id as string, toColumnId, destSiblings.length);
  };

  return (
    <ModalBackdrop
      onClose={onClose}
      aria-label={t(I18nKey.KANBAN$EDIT_TASK_TITLE)}
    >
      <div
        data-testid={`kanban-task-drawer-${task.id}`}
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">
            {t(I18nKey.KANBAN$EDIT_TASK_TITLE)}
          </h2>
          <BrandButton
            testId="kanban-drawer-close"
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            {t(I18nKey.KANBAN$CLOSE_DRAWER)}
          </BrandButton>
        </div>

        <label className="flex flex-col gap-1 text-sm text-white">
          {t(I18nKey.KANBAN$TASK_TITLE_FIELD_LABEL)}
          <input
            data-testid="kanban-drawer-title-input"
            className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleFieldBlur}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-white">
          {t(I18nKey.KANBAN$TASK_DESCRIPTION_FIELD_LABEL)}
          <textarea
            data-testid="kanban-drawer-description-input"
            className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleFieldBlur}
          />
        </label>

        <div className="flex justify-end">
          <BrandButton
            testId="kanban-drawer-delete-task"
            type="button"
            variant="danger"
            onClick={() => setDeleteDialogOpen(true)}
          >
            {t(I18nKey.KANBAN$DELETE_TASK_BUTTON)}
          </BrandButton>
        </div>

        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">
            {t(I18nKey.KANBAN$DRAWER_TITLE, { title: task.title })}
          </h3>
          {canHaveChildren && (
            <BrandButton
              testId="kanban-drawer-add-subtask"
              type="button"
              variant="primary"
              onClick={() => setCreateModalOpen(true)}
            >
              {t(I18nKey.KANBAN$ADD_SUBTASK_BUTTON)}
            </BrandButton>
          )}
        </div>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {COLUMNS.map((columnId) => (
              <KanbanColumn
                key={columnId}
                workspaceId={workspaceId}
                columnId={columnId}
                tasks={children.filter((c) => c.columnId === columnId)}
                onCardClick={setOpenChildTask}
              />
            ))}
          </div>
        </DndContext>
      </div>

      {createModalOpen && (
        <CreateTaskModal
          workspaceId={workspaceId}
          parentId={task.id}
          onClose={() => setCreateModalOpen(false)}
        />
      )}
      {deleteDialogOpen && (
        <DeleteTaskConfirmDialog
          workspaceId={workspaceId}
          taskId={task.id}
          onClose={() => setDeleteDialogOpen(false)}
          onDeleted={onClose}
        />
      )}
      {openChildTask && (
        <KanbanTaskDrawer
          workspaceId={workspaceId}
          task={openChildTask}
          onClose={() => setOpenChildTask(null)}
        />
      )}
    </ModalBackdrop>
  );
}

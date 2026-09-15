import { useState, type JSX } from "react";
import { useParams } from "react-router";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useAikBoardStore } from "#/stores/aik-board-store";
import type { AikColumnId, AikTask } from "#/types/aik";
import { AikTaskCard } from "#/components/features/aik/aik-task-card";
import { AikTimeline } from "#/components/features/aik/aik-timeline";

const COLUMN_IDS: AikColumnId[] = [
  "backlog",
  "in_progress",
  "in_review",
  "done",
];

const COLUMN_LABEL_KEY: Record<AikColumnId, I18nKey> = {
  backlog: I18nKey.AIK$TASKS_COLUMN_BACKLOG,
  in_progress: I18nKey.AIK$TASKS_COLUMN_IN_PROGRESS,
  in_review: I18nKey.AIK$TASKS_COLUMN_IN_REVIEW,
  done: I18nKey.AIK$TASKS_COLUMN_DONE,
};

// Stable reference — an inline `[]` literal returned from a Zustand
// selector produces a fresh array identity on every call, which breaks
// `useSyncExternalStore`'s reference-equality check and causes an infinite
// render loop (same rationale as `kanban-board.tsx:27`).
const EMPTY_TASKS: AikTask[] = [];

interface AikTasksColumnProps {
  columnId: AikColumnId;
  tasks: AikTask[];
  onOpen: (task: AikTask) => void;
}

function AikTasksColumn({ columnId, tasks, onOpen }: AikTasksColumnProps) {
  const { t } = useTranslation("openhands");
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const sortedTasks = [...tasks].sort((a, b) => a.order - b.order);

  return (
    <div
      ref={setNodeRef}
      data-testid={`aik-tasks-column-${columnId}`}
      className={`flex flex-col gap-2 rounded-xl border border-[var(--oh-border)] p-3 min-h-40 w-full ${
        isOver ? "bg-[var(--oh-interactive-hover)]" : "bg-base-secondary"
      }`}
    >
      <h3 className="text-sm font-semibold text-white">
        {t(COLUMN_LABEL_KEY[columnId])}
      </h3>
      <SortableContext
        items={sortedTasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          {sortedTasks.length === 0 ? (
            <p
              data-testid={`aik-tasks-column-empty-${columnId}`}
              className="text-xs text-muted"
            >
              {t(I18nKey.AIK$TASKS_COLUMN_EMPTY)}
            </p>
          ) : (
            sortedTasks.map((task) => (
              <AikTaskCard key={task.id} task={task} onOpen={onOpen} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

/**
 * `/:systemId/fases/:phaseId` route (SPEC §2.6): kanban of a single
 * phase's tasks, 4 fixed columns (`backlog`/`in_progress`/`in_review`/
 * `done`). Drag persists via `moveTask` (SPRINT-06's store already owns
 * reindexing/derivation) and is reachable by keyboard through
 * `KeyboardSensor` (RNF-06/CA-37), same setup as `kanban-board.tsx:73-78`.
 */
export function AikTasksBoard(): JSX.Element {
  const { t } = useTranslation("openhands");
  const { systemId, phaseId } = useParams<{
    systemId: string;
    phaseId: string;
  }>();

  const tasks = useAikBoardStore((state) =>
    systemId ? (state.tasksBySystemId[systemId] ?? EMPTY_TASKS) : EMPTY_TASKS,
  );
  const moveTask = useAikBoardStore((state) => state.moveTask);
  const approveTask = useAikBoardStore((state) => state.approveTask);
  const returnTask = useAikBoardStore((state) => state.returnTask);

  const [openTask, setOpenTask] = useState<AikTask | null>(null);
  const [feedback, setFeedback] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (!systemId || !phaseId) {
    return (
      <div data-testid="aik-tasks-board-not-found">
        <p className="text-sm text-muted">
          {t(I18nKey.AIK$TASKS_BOARD_NOT_FOUND)}
        </p>
      </div>
    );
  }

  const phaseTasks = tasks.filter((task) => task.phaseId === phaseId);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const toColumnId = over.id as AikColumnId;
    const destSiblings = phaseTasks.filter(
      (task) => task.columnId === toColumnId && task.id !== active.id,
    );
    moveTask(active.id as string, toColumnId, destSiblings.length);
  };

  const handleApprove = () => {
    if (!openTask) return;
    approveTask(openTask.id);
    setOpenTask(null);
  };

  const handleReturn = () => {
    if (!openTask || !feedback.trim()) return;
    returnTask(openTask.id, feedback);
    setFeedback("");
    setOpenTask(null);
  };

  return (
    <div
      data-testid="aik-tasks-board"
      className="flex flex-1 flex-col gap-4 p-4 overflow-y-auto"
    >
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div
          data-testid="aik-tasks-board-columns"
          className="grid grid-cols-1 sm:grid-cols-4 gap-3"
        >
          {COLUMN_IDS.map((columnId) => (
            <AikTasksColumn
              key={columnId}
              columnId={columnId}
              tasks={phaseTasks.filter((task) => task.columnId === columnId)}
              onOpen={setOpenTask}
            />
          ))}
        </div>
      </DndContext>

      {openTask && (
        <div
          data-testid={`aik-task-drawer-${openTask.id}`}
          className="flex flex-col gap-3 rounded-xl border border-[var(--oh-border)] bg-base-secondary p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">
              {openTask.title}
            </h2>
            <button
              type="button"
              data-testid={`aik-task-drawer-close-${openTask.id}`}
              onClick={() => setOpenTask(null)}
              className="text-xs text-muted"
            >
              {t(I18nKey.AIK$TASKS_DRAWER_CLOSE)}
            </button>
          </div>
          {openTask.description && (
            <p className="text-sm text-white">{openTask.description}</p>
          )}
          <AikTimeline entries={openTask.timeline} />
          {openTask.columnId === "in_review" && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                data-testid={`aik-task-drawer-approve-${openTask.id}`}
                onClick={handleApprove}
                className="text-sm text-success"
              >
                {t(I18nKey.AIK$TASKS_APPROVE_BUTTON)}
              </button>
              <label
                htmlFor={`aik-task-drawer-feedback-${openTask.id}`}
                className="text-xs text-muted"
              >
                {t(I18nKey.AIK$TASKS_RETURN_FEEDBACK_LABEL)}
              </label>
              <textarea
                id={`aik-task-drawer-feedback-${openTask.id}`}
                data-testid={`aik-task-drawer-feedback-${openTask.id}`}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                className="rounded border border-[var(--oh-border)] bg-base p-2 text-sm text-white"
              />
              <button
                type="button"
                data-testid={`aik-task-drawer-return-${openTask.id}`}
                onClick={handleReturn}
                disabled={!feedback.trim()}
                className="text-sm text-warning disabled:opacity-50"
              >
                {t(I18nKey.AIK$TASKS_RETURN_BUTTON)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AikTasksBoard;

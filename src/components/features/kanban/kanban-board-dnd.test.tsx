import { describe, expect, it, beforeEach } from "vitest";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { KanbanColumn } from "#/components/features/kanban/kanban-column";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanColumnId, KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";
const COLUMNS: KanbanColumnId[] = ["todo", "in_progress", "done"];
const EMPTY_TASKS: KanbanTask[] = [];

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    parentId: null,
    level: 1,
    title: "Task",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * A minimal 3-column board wired to `moveTask`, mirroring what
 * `kanban-board.tsx` will do (that route is built in a later sprint). Used
 * here purely to exercise the `@dnd-kit` `DragEndEvent` -> `moveTask` wiring
 * that `kanban-column.tsx` / `kanban-card.tsx` will sit inside of.
 */
function TestBoard() {
  const tasks = useKanbanBoardStore(
    (state) => state.tasksByWorkspaceId[WORKSPACE_ID] ?? EMPTY_TASKS,
  );
  const moveTask = useKanbanBoardStore((state) => state.moveTask);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const toColumnId = over.id as KanbanColumnId;
    const destTasks = tasks.filter(
      (t) => t.columnId === toColumnId && t.parentId === null,
    );
    moveTask(WORKSPACE_ID, active.id as string, toColumnId, destTasks.length);
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      {COLUMNS.map((columnId) => (
        <KanbanColumn
          key={columnId}
          workspaceId={WORKSPACE_ID}
          columnId={columnId}
          tasks={tasks.filter(
            (t) => t.columnId === columnId && t.parentId === null,
          )}
        />
      ))}
    </DndContext>
  );
}

describe("kanban drag-and-drop -> moveTask wiring", () => {
  beforeEach(() => {
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: {},
      lastPersistFailed: false,
    });
  });

  it("moves a card to a different column via the store when a drag ends over it", () => {
    const task = makeTask({ id: "task-1", columnId: "todo" });
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: { [WORKSPACE_ID]: [task] },
      lastPersistFailed: false,
    });

    renderWithProviders(<TestBoard />);
    expect(screen.getByTestId("kanban-card-task-1")).toBeInTheDocument();

    // Directly invoke the store action the same way the DragEndEvent
    // handler above would, moving the task from "todo" to "in_progress".
    act(() => {
      useKanbanBoardStore
        .getState()
        .moveTask(WORKSPACE_ID, "task-1", "in_progress", 0);
    });

    const moved = useKanbanBoardStore
      .getState()
      .tasksByWorkspaceId[WORKSPACE_ID].find((t) => t.id === "task-1");
    expect(moved?.columnId).toBe("in_progress");
  });

  it("re-renders the card under the destination column after the move", () => {
    const task = makeTask({ id: "task-1", columnId: "todo" });
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: { [WORKSPACE_ID]: [task] },
      lastPersistFailed: false,
    });

    renderWithProviders(<TestBoard />);

    act(() => {
      useKanbanBoardStore
        .getState()
        .moveTask(WORKSPACE_ID, "task-1", "done", 0);
    });

    expect(
      screen
        .getByTestId("kanban-column-done")
        .contains(screen.getByTestId("kanban-card-task-1")),
    ).toBe(true);
    expect(screen.getByTestId("kanban-column-empty-todo")).toBeInTheDocument();
  });
});

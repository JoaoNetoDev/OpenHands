import { describe, expect, it, beforeEach } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { I18nKey } from "#/i18n/declaration";
import { KanbanColumn } from "#/components/features/kanban/kanban-column";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    parentId: null,
    level: 1,
    title: "Task 1",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("KanbanColumn", () => {
  beforeEach(() => {
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: {},
      lastPersistFailed: false,
    });
  });

  it("shows the empty state when there are no tasks", () => {
    renderWithProviders(
      <DndContext>
        <KanbanColumn
          workspaceId={WORKSPACE_ID}
          columnId="todo"
          label={I18nKey.KANBAN$COLUMN_TODO}
          tasks={[]}
        />
      </DndContext>,
    );

    expect(screen.getByTestId("kanban-column-empty-todo")).toHaveTextContent(
      I18nKey.KANBAN$COLUMN_EMPTY,
    );
  });

  it("renders one card per task when the column has cards", () => {
    const tasks = [
      makeTask({ id: "task-1", title: "Task 1", order: 0 }),
      makeTask({ id: "task-2", title: "Task 2", order: 1 }),
    ];

    renderWithProviders(
      <DndContext>
        <KanbanColumn
          workspaceId={WORKSPACE_ID}
          columnId="todo"
          label={I18nKey.KANBAN$COLUMN_TODO}
          tasks={tasks}
        />
      </DndContext>,
    );

    expect(screen.queryByTestId("kanban-column-empty-todo")).toBeNull();
    expect(screen.getByTestId("kanban-card-task-1")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-card-task-2")).toBeInTheDocument();
  });
});

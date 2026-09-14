import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { CreateTaskModal } from "#/components/features/kanban/create-task-modal";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";

const WORKSPACE_ID = "workspace-1";

describe("CreateTaskModal", () => {
  beforeEach(() => {
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: {},
      lastPersistFailed: false,
    });
  });

  it("disables submit until a title is entered", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CreateTaskModal
        workspaceId={WORKSPACE_ID}
        parentId={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("create-task-submit")).toBeDisabled();
    await user.type(screen.getByTestId("kanban-task-title-input"), "New task");
    expect(screen.getByTestId("create-task-submit")).toBeEnabled();
  });

  it("creates a level 1 task on submit", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <CreateTaskModal
        workspaceId={WORKSPACE_ID}
        parentId={null}
        onClose={onClose}
      />,
    );

    await user.type(screen.getByTestId("kanban-task-title-input"), "New task");
    await user.click(screen.getByTestId("create-task-submit"));

    const tasks =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("New task");
    expect(tasks[0].level).toBe(1);
    expect(tasks[0].columnId).toBe("todo");
    expect(onClose).toHaveBeenCalled();
  });
});

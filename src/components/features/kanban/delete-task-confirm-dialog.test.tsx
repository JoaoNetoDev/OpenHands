import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { I18nKey } from "#/i18n/declaration";
import { DeleteTaskConfirmDialog } from "#/components/features/kanban/delete-task-confirm-dialog";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Task",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("DeleteTaskConfirmDialog", () => {
  beforeEach(() => {
    useKanbanBoardStore.setState({
      tasksByBoardId: {},
      lastPersistFailed: false,
    });
  });

  it("shows the correct descendant count for 2 children + 1 grandchild", () => {
    const root = makeTask({ id: "root" });
    const child1 = makeTask({ id: "child-1", parentId: "root", level: 2 });
    const child2 = makeTask({ id: "child-2", parentId: "root", level: 2 });
    const grandchild = makeTask({
      id: "grandchild-1",
      parentId: "child-1",
      level: 3,
    });

    useKanbanBoardStore.setState({
      tasksByBoardId: {
        [WORKSPACE_ID]: [root, child1, child2, grandchild],
      },
      lastPersistFailed: false,
    });

    renderWithProviders(
      <DeleteTaskConfirmDialog
        workspaceId={WORKSPACE_ID}
        taskId="root"
        onClose={vi.fn()}
      />,
    );

    const descendants = screen.getByTestId("delete-task-descendant-count");
    expect(descendants).toHaveTextContent(
      I18nKey.KANBAN$DELETE_CONFIRM_DESCENDANTS,
    );
    // Underlying count computed via collectDescendantIds must be 3
    // (child-1, child-2, grandchild-1).
    expect(descendants).toHaveAttribute("data-count", "3");
  });

  it("does not show the cascade message when the task has no descendants", () => {
    const root = makeTask({ id: "root" });
    useKanbanBoardStore.setState({
      tasksByBoardId: { [WORKSPACE_ID]: [root] },
      lastPersistFailed: false,
    });

    renderWithProviders(
      <DeleteTaskConfirmDialog
        workspaceId={WORKSPACE_ID}
        taskId="root"
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("delete-task-descendant-count")).toBeNull();
  });

  it("removes the task and its descendants on confirm", async () => {
    const user = userEvent.setup();
    const root = makeTask({ id: "root" });
    const child1 = makeTask({ id: "child-1", parentId: "root", level: 2 });

    useKanbanBoardStore.setState({
      tasksByBoardId: { [WORKSPACE_ID]: [root, child1] },
      lastPersistFailed: false,
    });

    const onClose = vi.fn();
    renderWithProviders(
      <DeleteTaskConfirmDialog
        workspaceId={WORKSPACE_ID}
        taskId="root"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByTestId("confirm-delete-button"));

    expect(
      useKanbanBoardStore.getState().tasksByBoardId[WORKSPACE_ID],
    ).toHaveLength(0);
    expect(onClose).toHaveBeenCalled();
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { ApproveRejectButtons } from "#/components/features/kanban/approve-reject-buttons";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Task 1",
    columnId: "pending_validation",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function getTask(): KanbanTask {
  return useKanbanBoardStore
    .getState()
    .tasksByBoardId[WORKSPACE_ID].find((t) => t.id === "task-1")!;
}

describe("ApproveRejectButtons", () => {
  beforeEach(() => {
    useKanbanBoardStore.setState({
      tasksByBoardId: { [WORKSPACE_ID]: [makeTask()] },
      lastPersistFailed: false,
    });
  });

  it("CA-09: renders nothing when the task is not in pending_validation", () => {
    const task = makeTask({ columnId: "todo" });
    renderWithProviders(
      <ApproveRejectButtons workspaceId={WORKSPACE_ID} task={task} />,
    );
    expect(
      screen.queryByTestId("kanban-approve-reject-buttons"),
    ).not.toBeInTheDocument();
  });

  it("CA-09: shows Aprovar/Reprovar buttons when the task is in pending_validation", () => {
    const task = makeTask();
    renderWithProviders(
      <ApproveRejectButtons workspaceId={WORKSPACE_ID} task={task} />,
    );
    expect(screen.getByTestId("kanban-approve-button")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-reject-button")).toBeInTheDocument();
  });

  it("CA-09: Aprovar moves the task to done", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    renderWithProviders(
      <ApproveRejectButtons workspaceId={WORKSPACE_ID} task={task} />,
    );

    await user.click(screen.getByTestId("kanban-approve-button"));

    expect(getTask().columnId).toBe("done");
  });

  it("CA-09: Reprovar without a reason does not submit and shows a validation error", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    renderWithProviders(
      <ApproveRejectButtons workspaceId={WORKSPACE_ID} task={task} />,
    );

    await user.click(screen.getByTestId("kanban-reject-button"));
    await user.click(screen.getByTestId("kanban-confirm-reject-button"));

    expect(
      screen.getByTestId("kanban-rejection-reason-error"),
    ).toBeInTheDocument();
    expect(getTask().columnId).toBe("pending_validation");
    expect(getTask().rejectionReason).toBeUndefined();
  });

  it("CA-09: Reprovar with a reason records rejectionReason and moves the task to todo", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    renderWithProviders(
      <ApproveRejectButtons workspaceId={WORKSPACE_ID} task={task} />,
    );

    await user.click(screen.getByTestId("kanban-reject-button"));
    await user.type(
      screen.getByTestId("kanban-rejection-reason-input"),
      "  faltou tratar o erro X  ",
    );
    await user.click(screen.getByTestId("kanban-confirm-reject-button"));

    expect(getTask().columnId).toBe("todo");
    expect(getTask().rejectionReason).toBe("faltou tratar o erro X");
    expect(
      screen.queryByTestId("kanban-rejection-reason-input"),
    ).not.toBeInTheDocument();
  });

  it("Cancelar closes the reason field without submitting", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    renderWithProviders(
      <ApproveRejectButtons workspaceId={WORKSPACE_ID} task={task} />,
    );

    await user.click(screen.getByTestId("kanban-reject-button"));
    await user.type(
      screen.getByTestId("kanban-rejection-reason-input"),
      "algo",
    );
    await user.click(screen.getByTestId("kanban-cancel-reject-button"));

    expect(
      screen.queryByTestId("kanban-rejection-reason-input"),
    ).not.toBeInTheDocument();
    expect(getTask().columnId).toBe("pending_validation");
    expect(getTask().rejectionReason).toBeUndefined();
  });
});

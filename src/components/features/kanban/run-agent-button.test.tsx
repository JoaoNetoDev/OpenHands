import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { RunAgentButton } from "#/components/features/kanban/run-agent-button";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";
const WORKSPACE_PATH = "/home/user/workspace";

const startFeatdevelopConversationMock = vi.fn();

vi.mock("#/api/kanban-pipeline.api", () => ({
  startFeatdevelopConversation: (...args: unknown[]) =>
    startFeatdevelopConversationMock(...args),
}));

const displayErrorToastMock = vi.fn();
vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: (...args: unknown[]) => displayErrorToastMock(...args),
}));

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    parentId: null,
    level: 1,
    title: "Task 1",
    columnId: "featdevelop_todo",
    order: 0,
    createdAt: new Date().toISOString(),
    featureSlug: "my-feature",
    ...overrides,
  };
}

describe("RunAgentButton", () => {
  beforeEach(() => {
    startFeatdevelopConversationMock.mockReset();
    displayErrorToastMock.mockReset();
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: { [WORKSPACE_ID]: [makeTask()] },
      lastPersistFailed: false,
    });
  });

  it("is disabled when there is no featureSlug", () => {
    const task = makeTask({ featureSlug: undefined });
    renderWithProviders(
      <RunAgentButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={task}
      />,
    );
    expect(screen.getByTestId("kanban-run-agent-button")).toBeDisabled();
  });

  it("is disabled when there is no workspacePath", () => {
    const task = makeTask();
    renderWithProviders(
      <RunAgentButton
        workspaceId={WORKSPACE_ID}
        workspacePath={undefined}
        task={task}
      />,
    );
    expect(screen.getByTestId("kanban-run-agent-button")).toBeDisabled();
  });

  it("creates two distinct conversations across two clicks and stores the latest id", async () => {
    const user = userEvent.setup();
    startFeatdevelopConversationMock
      .mockResolvedValueOnce({ ok: true, conversationId: "conv-1" })
      .mockResolvedValueOnce({ ok: true, conversationId: "conv-2" });
    const task = makeTask();

    const { rerender } = renderWithProviders(
      <RunAgentButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={task}
      />,
    );

    await user.click(screen.getByTestId("kanban-run-agent-button"));
    await waitFor(() => {
      const tasks =
        useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
      expect(tasks[0].linkedConversationId).toBe("conv-1");
    });

    const updatedTask =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID][0];
    rerender(
      <RunAgentButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={updatedTask}
      />,
    );

    await user.click(screen.getByTestId("kanban-run-agent-button"));
    await waitFor(() => {
      const tasks =
        useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
      expect(tasks[0].linkedConversationId).toBe("conv-2");
    });

    expect(startFeatdevelopConversationMock).toHaveBeenCalledTimes(2);
  });

  it("shows an 'open conversation' link pointing to /conversations/<id> once linked", () => {
    const task = makeTask({ linkedConversationId: "conv-abc" });
    renderWithProviders(
      <RunAgentButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={task}
      />,
    );
    const link = screen.getByTestId("kanban-open-conversation-link");
    expect(link).toHaveAttribute("href", "/conversations/conv-abc");
  });

  it("shows an error toast and does not set linkedConversationId on failure", async () => {
    const user = userEvent.setup();
    startFeatdevelopConversationMock.mockResolvedValue({
      ok: false,
      error: "Falha ao iniciar conversa",
    });
    const task = makeTask();
    renderWithProviders(
      <RunAgentButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={task}
      />,
    );

    await user.click(screen.getByTestId("kanban-run-agent-button"));

    await waitFor(() => {
      expect(displayErrorToastMock).toHaveBeenCalledWith(
        "Falha ao iniciar conversa",
      );
    });
    const tasks =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
    expect(tasks[0].linkedConversationId).toBeUndefined();
  });
});

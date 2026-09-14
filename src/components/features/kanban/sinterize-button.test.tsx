import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { SinterizeButton } from "#/components/features/kanban/sinterize-button";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";
const WORKSPACE_PATH = "/home/user/workspace";

const sinterizeTaskMock = vi.fn();
const displaySuccessToastMock = vi.fn();
const displayErrorToastMock = vi.fn();
let backendKind: "local" | "cloud" = "local";

vi.mock("#/api/kanban-sintering.api", () => ({
  sinterizeTask: (...args: unknown[]) => sinterizeTaskMock(...args),
}));

vi.mock("#/api/backend-registry/active-store", () => ({
  getActiveBackend: () => ({ backend: { kind: backendKind } }),
}));

vi.mock("#/utils/custom-toast-handlers", () => ({
  displaySuccessToast: (...args: unknown[]) => displaySuccessToastMock(...args),
  displayErrorToast: (...args: unknown[]) => displayErrorToastMock(...args),
}));

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Task to sinterize",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SinterizeButton", () => {
  beforeEach(() => {
    backendKind = "local";
    sinterizeTaskMock.mockReset();
    displaySuccessToastMock.mockReset();
    displayErrorToastMock.mockReset();
    useKanbanBoardStore.setState({
      tasksByBoardId: {
        [WORKSPACE_ID]: [makeTask()],
      },
      lastPersistFailed: false,
    });
  });

  // CA-03: backend Cloud -> botão desabilitado com tooltip.
  it("disables the button with a tooltip when the active backend is cloud", () => {
    backendKind = "cloud";
    const task = makeTask();
    renderWithProviders(
      <SinterizeButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={task}
      />,
    );

    const button = screen.getByTestId("kanban-sinterize-button");
    expect(button).toBeDisabled();
  });

  // CA-03: backend local -> botão habilitado.
  it("enables the button when the active backend is local and a workspace path is resolved", () => {
    const task = makeTask();
    renderWithProviders(
      <SinterizeButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={task}
      />,
    );

    const button = screen.getByTestId("kanban-sinterize-button");
    expect(button).not.toBeDisabled();
  });

  it("disables the button when no workspace path is resolved", () => {
    const task = makeTask();
    renderWithProviders(
      <SinterizeButton
        workspaceId={WORKSPACE_ID}
        workspacePath={undefined}
        task={task}
      />,
    );

    const button = screen.getByTestId("kanban-sinterize-button");
    expect(button).toBeDisabled();
  });

  // CA-07: sucesso -> toast de sucesso, lastSinteredAt atualizado.
  it("updates lastSinteredAt and shows a success toast when sinterizeTask succeeds", async () => {
    const user = userEvent.setup();
    sinterizeTaskMock.mockResolvedValue({ ok: true });
    const task = makeTask();
    renderWithProviders(
      <SinterizeButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={task}
      />,
    );

    await user.click(screen.getByTestId("kanban-sinterize-button"));

    await waitFor(() => {
      expect(sinterizeTaskMock).toHaveBeenCalledWith(WORKSPACE_PATH, task);
    });
    await waitFor(() => {
      const tasks = useKanbanBoardStore.getState().tasksByBoardId[WORKSPACE_ID];
      expect(tasks[0].lastSinteredAt).toBeDefined();
    });
    expect(displaySuccessToastMock).toHaveBeenCalled();
    expect(displayErrorToastMock).not.toHaveBeenCalled();
  });

  // CA-06: erro -> toast com result.error, lastSinteredAt NÃO atualizado.
  it("shows an error toast and does not update lastSinteredAt when sinterizeTask fails", async () => {
    const user = userEvent.setup();
    sinterizeTaskMock.mockResolvedValue({
      ok: false,
      error: "Falha ao gravar o arquivo .md",
    });
    const task = makeTask();
    renderWithProviders(
      <SinterizeButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={task}
      />,
    );

    await user.click(screen.getByTestId("kanban-sinterize-button"));

    await waitFor(() => {
      expect(displayErrorToastMock).toHaveBeenCalledWith(
        "Falha ao gravar o arquivo .md",
      );
    });
    const tasks = useKanbanBoardStore.getState().tasksByBoardId[WORKSPACE_ID];
    expect(tasks[0].lastSinteredAt).toBeUndefined();
    expect(displaySuccessToastMock).not.toHaveBeenCalled();
  });

  // CA-07: indicador visual quando lastSinteredAt presente.
  it("shows a relative-time indicator and the resinterize label when lastSinteredAt is set", () => {
    const task = makeTask({ lastSinteredAt: new Date().toISOString() });
    renderWithProviders(
      <SinterizeButton
        workspaceId={WORKSPACE_ID}
        workspacePath={WORKSPACE_PATH}
        task={task}
      />,
    );

    expect(
      screen.getByTestId("kanban-sinterize-last-sintered"),
    ).toBeInTheDocument();
  });
});

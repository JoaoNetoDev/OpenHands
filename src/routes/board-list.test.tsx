import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { I18nKey } from "#/i18n/declaration";
import BoardListRoute from "#/routes/board-list";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { SYSTEM_SETTINGS_STORAGE_KEY } from "#/utils/system-settings-storage";

const WORKSPACE_ID = "workspace-1";

function setActiveWorkspace(workspaceId: string | undefined) {
  if (workspaceId === undefined) {
    window.localStorage.removeItem(SYSTEM_SETTINGS_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    SYSTEM_SETTINGS_STORAGE_KEY,
    JSON.stringify({ defaultWorkspaceId: workspaceId }),
  );
}

describe("BoardListRoute", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useKanbanBoardStore.setState({
      boardsByWorkspaceId: {},
      tasksByBoardId: {},
      lastPersistFailed: false,
    });
  });

  it('shows the "no active workspace" state when there is no default workspace', () => {
    setActiveWorkspace(undefined);
    renderWithProviders(<BoardListRoute />);

    expect(screen.getByTestId("kanban-board-no-workspace")).toHaveTextContent(
      I18nKey.KANBAN$NO_WORKSPACE_TITLE,
    );
    expect(screen.queryByTestId("board-list")).toBeNull();
  });

  // Casos de borda (SPEC §4): workspace sem nenhum quadro ainda mostra
  // estado vazio com CTA "Criar quadro".
  it("shows the empty state with a create CTA when the workspace has no boards", () => {
    setActiveWorkspace(WORKSPACE_ID);
    renderWithProviders(<BoardListRoute />);

    expect(screen.getByTestId("board-list-empty-state")).toHaveTextContent(
      I18nKey.KANBAN_BOARD_LIST$EMPTY_TITLE,
    );
    expect(
      screen.getByTestId("board-list-empty-state-cta"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("board-list")).toBeNull();
  });

  it("creates a board from the empty state and lists it", async () => {
    const user = userEvent.setup();
    setActiveWorkspace(WORKSPACE_ID);
    renderWithProviders(<BoardListRoute />);

    await user.click(screen.getByTestId("board-list-empty-state-cta"));
    await user.type(
      screen.getByTestId("board-form-name-input"),
      "Sprint board",
    );
    await user.click(screen.getByTestId("board-form-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("board-list")).toBeInTheDocument();
    });
    expect(screen.getByText("Sprint board")).toBeInTheDocument();

    const boards =
      useKanbanBoardStore.getState().boardsByWorkspaceId[WORKSPACE_ID];
    expect(boards).toHaveLength(1);
    expect(boards[0].name).toBe("Sprint board");
  });

  it("renames a board", async () => {
    const user = userEvent.setup();
    setActiveWorkspace(WORKSPACE_ID);
    const board = useKanbanBoardStore
      .getState()
      .createBoard(WORKSPACE_ID, "Original name")!;
    renderWithProviders(<BoardListRoute />);

    await user.click(screen.getByTestId(`board-list-rename-${board.id}`));
    const input = screen.getByTestId("board-form-name-input");
    await user.clear(input);
    await user.type(input, "Renamed board");
    await user.click(screen.getByTestId("board-form-submit"));

    await waitFor(() => {
      expect(screen.getByText("Renamed board")).toBeInTheDocument();
    });
  });

  // CA-04 (RF-05, RF-06): excluir um quadro com tarefas mostra confirmação
  // com a contagem total de tarefas antes de remover.
  it("deletes a board after confirming, showing how many tasks will be removed", async () => {
    const user = userEvent.setup();
    setActiveWorkspace(WORKSPACE_ID);
    const board = useKanbanBoardStore
      .getState()
      .createBoard(WORKSPACE_ID, "To delete")!;
    useKanbanBoardStore
      .getState()
      .createTask(board.id, { title: "Task 1", parentId: null });
    useKanbanBoardStore
      .getState()
      .createTask(board.id, { title: "Task 2", parentId: null });

    renderWithProviders(<BoardListRoute />);

    await user.click(screen.getByTestId(`board-list-delete-${board.id}`));
    expect(
      screen.getByTestId("delete-board-confirm-dialog"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("delete-board-task-count")).toHaveAttribute(
      "data-count",
      "2",
    );

    await user.click(screen.getByTestId("confirm-delete-board-button"));

    await waitFor(() => {
      expect(
        useKanbanBoardStore.getState().boardsByWorkspaceId[WORKSPACE_ID],
      ).toHaveLength(0);
    });
    expect(
      useKanbanBoardStore.getState().tasksByBoardId[board.id],
    ).toBeUndefined();
  });

  it("shows the task count for each board in the list", () => {
    setActiveWorkspace(WORKSPACE_ID);
    const board = useKanbanBoardStore
      .getState()
      .createBoard(WORKSPACE_ID, "Board with tasks")!;
    useKanbanBoardStore
      .getState()
      .createTask(board.id, { title: "Task 1", parentId: null });

    renderWithProviders(<BoardListRoute />);

    expect(
      screen.getByTestId(`board-list-task-count-${board.id}`),
    ).toBeInTheDocument();
  });

  // CA-04: dois quadros no mesmo workspace aparecem como itens separados,
  // cada um navegando para seu próprio /board/:boardId.
  it("lists multiple boards of the same workspace as separate items, each navigating to its own board", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    setActiveWorkspace(WORKSPACE_ID);
    const boardA = useKanbanBoardStore
      .getState()
      .createBoard(WORKSPACE_ID, "Board A")!;
    const boardB = useKanbanBoardStore
      .getState()
      .createBoard(WORKSPACE_ID, "Board B")!;

    renderWithProviders(<BoardListRoute />, { navigation: { navigate } });

    await user.click(screen.getByTestId(`board-list-open-${boardA.id}`));
    expect(navigate).toHaveBeenCalledWith(`/board/${boardA.id}`);

    await user.click(screen.getByTestId(`board-list-open-${boardB.id}`));
    expect(navigate).toHaveBeenCalledWith(`/board/${boardB.id}`);
  });
});

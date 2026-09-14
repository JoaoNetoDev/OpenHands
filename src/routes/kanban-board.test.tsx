import { describe, expect, it, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { I18nKey } from "#/i18n/declaration";
import KanbanBoardRoute from "#/routes/kanban-board";
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

describe("KanbanBoardRoute", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: {},
      lastPersistFailed: false,
    });
  });

  // CA-01 (RF-01, RF-10): /board sem tarefas mostra estado vazio com CTA.
  it("shows the empty state with a create CTA when the workspace has no level-1 tasks", () => {
    setActiveWorkspace(WORKSPACE_ID);
    renderWithProviders(<KanbanBoardRoute />);

    expect(screen.getByTestId("kanban-board-empty-state")).toHaveTextContent(
      I18nKey.KANBAN$EMPTY_STATE_TITLE,
    );
    expect(
      screen.getByTestId("kanban-board-empty-state-cta"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("kanban-board-columns")).toBeNull();
  });

  it('shows the "no active workspace" state when there is no default workspace', () => {
    setActiveWorkspace(undefined);
    renderWithProviders(<KanbanBoardRoute />);

    expect(screen.getByTestId("kanban-board-no-workspace")).toHaveTextContent(
      I18nKey.KANBAN$NO_WORKSPACE_TITLE,
    );
    expect(screen.queryByTestId("kanban-board-empty-state")).toBeNull();
    expect(screen.queryByTestId("kanban-board-columns")).toBeNull();
  });

  it("clicking the empty-state CTA opens the create task modal", async () => {
    const user = userEvent.setup();
    setActiveWorkspace(WORKSPACE_ID);
    renderWithProviders(<KanbanBoardRoute />);

    await user.click(screen.getByTestId("kanban-board-empty-state-cta"));
    expect(screen.getByTestId("create-task-modal")).toBeInTheDocument();
  });

  it("renders the level-1 columns once a task exists", () => {
    setActiveWorkspace(WORKSPACE_ID);
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: {
        [WORKSPACE_ID]: [
          {
            id: "task-1",
            parentId: null,
            level: 1,
            title: "Level 1 task",
            columnId: "todo",
            order: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      },
      lastPersistFailed: false,
    });

    renderWithProviders(<KanbanBoardRoute />);

    expect(screen.getByTestId("kanban-board-columns")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-card-task-1")).toBeInTheDocument();
    expect(screen.queryByTestId("kanban-board-empty-state")).toBeNull();
  });

  // CA-03 (RF-04): criar subtarefa dentro de um card de nível 1 gera
  // level: 2 / parentId correto; card de nível 3 não oferece "adicionar
  // subtarefa".
  it("creates a level-2 subtask with the correct parentId from a level-1 card's drawer", async () => {
    const user = userEvent.setup();
    setActiveWorkspace(WORKSPACE_ID);
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: {
        [WORKSPACE_ID]: [
          {
            id: "parent-1",
            parentId: null,
            level: 1,
            title: "Parent task",
            columnId: "todo",
            order: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      },
      lastPersistFailed: false,
    });

    renderWithProviders(<KanbanBoardRoute />);
    await user.click(screen.getByTestId("kanban-card-parent-1"));
    expect(
      screen.getByTestId("kanban-task-drawer-parent-1"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("kanban-drawer-add-subtask"));
    await user.type(screen.getByTestId("kanban-task-title-input"), "Subtask 1");
    await user.click(screen.getByTestId("create-task-submit"));

    const tasks =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
    const subtask = tasks.find((t) => t.title === "Subtask 1");
    expect(subtask).toBeDefined();
    expect(subtask?.level).toBe(2);
    expect(subtask?.parentId).toBe("parent-1");
  });

  it("does not offer 'add subtask' on a level-3 task's drawer", async () => {
    const user = userEvent.setup();
    setActiveWorkspace(WORKSPACE_ID);
    const now = new Date().toISOString();
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: {
        [WORKSPACE_ID]: [
          {
            id: "level-1",
            parentId: null,
            level: 1,
            title: "Level 1",
            columnId: "todo",
            order: 0,
            createdAt: now,
          },
          {
            id: "level-2",
            parentId: "level-1",
            level: 2,
            title: "Level 2",
            columnId: "todo",
            order: 0,
            createdAt: now,
          },
          {
            id: "level-3",
            parentId: "level-2",
            level: 3,
            title: "Level 3",
            columnId: "todo",
            order: 0,
            createdAt: now,
          },
        ],
      },
      lastPersistFailed: false,
    });

    renderWithProviders(<KanbanBoardRoute />);
    await user.click(screen.getByTestId("kanban-card-level-1"));
    await user.click(screen.getByTestId("kanban-card-level-2"));

    expect(
      screen.getByTestId("kanban-task-drawer-level-2"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("kanban-card-level-3")).toBeInTheDocument();
    expect(screen.queryByTestId("kanban-task-drawer-level-3")).toBeNull();

    await user.click(screen.getByTestId("kanban-card-level-3"));
    const level3Drawer = screen.getByTestId("kanban-task-drawer-level-3");
    expect(level3Drawer).toBeInTheDocument();
    expect(
      within(level3Drawer).queryByTestId("kanban-drawer-add-subtask"),
    ).toBeNull();
  });

  // CA-04 (RF-05): editar título/descrição reflete imediatamente e após
  // reload (a store já é persistida via zustand/persist; aqui validamos
  // que o valor atualizado sobrevive a uma remontagem da árvore, o que é o
  // equivalente de integração a um "reload" nesse ambiente de teste).
  it("editing a task's title/description reflects immediately and after remounting the route", async () => {
    const user = userEvent.setup();
    setActiveWorkspace(WORKSPACE_ID);
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: {
        [WORKSPACE_ID]: [
          {
            id: "task-1",
            parentId: null,
            level: 1,
            title: "Original title",
            columnId: "todo",
            order: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      },
      lastPersistFailed: false,
    });

    const { unmount } = renderWithProviders(<KanbanBoardRoute />);
    await user.click(screen.getByTestId("kanban-card-task-1"));

    const titleInput = screen.getByTestId("kanban-drawer-title-input");
    await user.clear(titleInput);
    await user.type(titleInput, "Updated title");
    const descriptionInput = screen.getByTestId(
      "kanban-drawer-description-input",
    );
    await user.type(descriptionInput, "Updated description");
    descriptionInput.blur();

    await waitFor(() => {
      const tasks =
        useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
      expect(tasks.find((t) => t.id === "task-1")?.title).toBe("Updated title");
    });
    expect(
      useKanbanBoardStore
        .getState()
        .tasksByWorkspaceId[WORKSPACE_ID].find((t) => t.id === "task-1")
        ?.description,
    ).toBe("Updated description");

    unmount();
    renderWithProviders(<KanbanBoardRoute />);
    expect(screen.getByTestId("kanban-card-task-1")).toHaveTextContent(
      "Updated title",
    );
  });
});

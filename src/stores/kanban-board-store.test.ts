import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "#/i18n";
import { I18nKey } from "#/i18n/declaration";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { displayErrorToast } from "#/utils/custom-toast-handlers";

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: vi.fn(),
}));

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

function resetStore() {
  useKanbanBoardStore.setState({
    tasksByWorkspaceId: {},
    lastPersistFailed: false,
  });
}

describe("useKanbanBoardStore", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  afterEach(() => {
    localStorage.clear();
    resetStore();
    vi.restoreAllMocks();
  });

  it("creates a level 1 -> level 2 -> level 3 task chain", () => {
    const { createTask, getChildren } = useKanbanBoardStore.getState();

    createTask(WORKSPACE_A, { title: "Root", parentId: null });
    const level1 =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A][0];
    expect(level1.level).toBe(1);

    createTask(WORKSPACE_A, { title: "Child", parentId: level1.id });
    const level2 = useKanbanBoardStore
      .getState()
      .tasksByWorkspaceId[WORKSPACE_A].find((t) => t.parentId === level1.id)!;
    expect(level2.level).toBe(2);

    createTask(WORKSPACE_A, { title: "Grandchild", parentId: level2.id });
    const level3 = useKanbanBoardStore
      .getState()
      .tasksByWorkspaceId[WORKSPACE_A].find((t) => t.parentId === level2.id)!;
    expect(level3.level).toBe(3);

    expect(getChildren(WORKSPACE_A, level1.id).length).toBe(1);
    expect(getChildren(WORKSPACE_A, level2.id).length).toBe(1);
  });

  it("does not allow creating a child of a level 3 task (no-op)", () => {
    const { createTask } = useKanbanBoardStore.getState();
    createTask(WORKSPACE_A, { title: "L1", parentId: null });
    const l1 =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A][0];
    createTask(WORKSPACE_A, { title: "L2", parentId: l1.id });
    const l2 = useKanbanBoardStore
      .getState()
      .tasksByWorkspaceId[WORKSPACE_A].find((t) => t.parentId === l1.id)!;
    createTask(WORKSPACE_A, { title: "L3", parentId: l2.id });
    const l3 = useKanbanBoardStore
      .getState()
      .tasksByWorkspaceId[WORKSPACE_A].find((t) => t.parentId === l2.id)!;

    const result = useKanbanBoardStore
      .getState()
      .createTask(WORKSPACE_A, { title: "L4 attempt", parentId: l3.id });

    expect(result).toBe(false);
    expect(
      useKanbanBoardStore
        .getState()
        .tasksByWorkspaceId[WORKSPACE_A].filter((t) => t.parentId === l3.id)
        .length,
    ).toBe(0);
  });

  it("updates a task's title and description", () => {
    const { createTask, updateTask } = useKanbanBoardStore.getState();
    createTask(WORKSPACE_A, { title: "Original", parentId: null });
    const task =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A][0];

    updateTask(WORKSPACE_A, task.id, {
      title: "Updated",
      description: "New description",
    });

    const updated = useKanbanBoardStore
      .getState()
      .tasksByWorkspaceId[WORKSPACE_A].find((t) => t.id === task.id)!;
    expect(updated.title).toBe("Updated");
    expect(updated.description).toBe("New description");
  });

  it("moves a task between columns and reindexes order", () => {
    const { createTask, moveTask } = useKanbanBoardStore.getState();
    createTask(WORKSPACE_A, { title: "A", parentId: null });
    createTask(WORKSPACE_A, { title: "B", parentId: null });
    const [a, b] =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A];

    moveTask(WORKSPACE_A, a.id, "in_progress", 0);

    const tasks =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A];
    const movedA = tasks.find((t) => t.id === a.id)!;
    const remainingB = tasks.find((t) => t.id === b.id)!;
    expect(movedA.columnId).toBe("in_progress");
    expect(movedA.order).toBe(0);
    expect(remainingB.columnId).toBe("todo");
    expect(remainingB.order).toBe(0);
  });

  it("deletes a task and all its descendants in cascade", () => {
    const { createTask, deleteTask } = useKanbanBoardStore.getState();
    createTask(WORKSPACE_A, { title: "Root", parentId: null });
    const root =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A][0];
    createTask(WORKSPACE_A, { title: "Child 1", parentId: root.id });
    createTask(WORKSPACE_A, { title: "Child 2", parentId: root.id });
    const child1 = useKanbanBoardStore
      .getState()
      .tasksByWorkspaceId[WORKSPACE_A].find((t) => t.title === "Child 1")!;
    createTask(WORKSPACE_A, { title: "Grandchild", parentId: child1.id });

    expect(
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A].length,
    ).toBe(4);

    deleteTask(WORKSPACE_A, root.id);

    expect(
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A].length,
    ).toBe(0);
  });

  it("isolates tasks between different workspaceIds", () => {
    const { createTask } = useKanbanBoardStore.getState();
    createTask(WORKSPACE_A, { title: "Task in A", parentId: null });
    createTask(WORKSPACE_B, { title: "Task in B", parentId: null });

    const tasksA =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A];
    const tasksB =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_B];

    expect(tasksA.length).toBe(1);
    expect(tasksB.length).toBe(1);
    expect(tasksA[0].title).toBe("Task in A");
    expect(tasksB[0].title).toBe("Task in B");

    useKanbanBoardStore.getState().deleteTask(WORKSPACE_A, tasksA[0].id);

    expect(
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A].length,
    ).toBe(0);
    expect(
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_B].length,
    ).toBe(1);
  });

  it("preserves in-memory state and signals failure when localStorage.setItem throws", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    const result = useKanbanBoardStore
      .getState()
      .createTask(WORKSPACE_A, { title: "Offline task", parentId: null });

    expect(result).toBe(false);
    expect(useKanbanBoardStore.getState().lastPersistFailed).toBe(true);

    const tasks =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_A];
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe("Offline task");

    expect(displayErrorToast).toHaveBeenCalledTimes(1);
    expect(displayErrorToast).toHaveBeenCalledWith(
      i18n.t(I18nKey.KANBAN$SAVE_ERROR),
    );

    setItemSpy.mockRestore();
  });
});

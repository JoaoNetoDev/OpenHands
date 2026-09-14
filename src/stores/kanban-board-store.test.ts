import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "#/i18n";
import { I18nKey } from "#/i18n/declaration";
import {
  KANBAN_BOARD_STORAGE_KEY,
  useKanbanBoardStore,
} from "#/stores/kanban-board-store";
import { displayErrorToast } from "#/utils/custom-toast-handlers";

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: vi.fn(),
}));

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

function resetStore() {
  useKanbanBoardStore.setState({
    boardsByWorkspaceId: {},
    tasksByBoardId: {},
    lastPersistFailed: false,
  });
}

/** Creates a board in `WORKSPACE_A` and returns its id — most task-level
 * tests operate within a single board, same as the pre-multi-board tests
 * operated within a single workspace. */
function createBoard(workspaceId: string = WORKSPACE_A): string {
  const board = useKanbanBoardStore
    .getState()
    .createBoard(workspaceId, "Board");
  return board!.id;
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

  describe("board actions (CA-04)", () => {
    it("creates a board and lists it under its workspaceId", () => {
      const { createBoard: create, getBoards } = useKanbanBoardStore.getState();
      const board = create(WORKSPACE_A, "Sprint 1");

      expect(board).not.toBeNull();
      expect(board?.workspaceId).toBe(WORKSPACE_A);
      expect(board?.name).toBe("Sprint 1");
      expect(getBoards(WORKSPACE_A)).toHaveLength(1);
      expect(getBoards(WORKSPACE_A)[0].id).toBe(board?.id);
    });

    it("does not create a board with a blank name", () => {
      const { createBoard: create, getBoards } = useKanbanBoardStore.getState();
      const board = create(WORKSPACE_A, "   ");

      expect(board).toBeNull();
      expect(getBoards(WORKSPACE_A)).toHaveLength(0);
    });

    it("renames a board", () => {
      const {
        createBoard: create,
        renameBoard,
        getBoards,
      } = useKanbanBoardStore.getState();
      const board = create(WORKSPACE_A, "Original")!;

      const ok = renameBoard(WORKSPACE_A, board.id, "Renamed");

      expect(ok).toBe(true);
      expect(getBoards(WORKSPACE_A)[0].name).toBe("Renamed");
    });

    it("updates a board's checklist (F-V2S3-1)", () => {
      const {
        createBoard: create,
        updateBoardChecklist,
        getBoards,
      } = useKanbanBoardStore.getState();
      const board = create(WORKSPACE_A, "With checklist")!;
      const checklist = [{ id: "item-1", text: "Definir escopo", done: false }];

      const ok = updateBoardChecklist(WORKSPACE_A, board.id, checklist);

      expect(ok).toBe(true);
      expect(getBoards(WORKSPACE_A)[0].checklist).toEqual(checklist);
    });

    it("does not affect other boards' checklists when updating one board", () => {
      const {
        createBoard: create,
        updateBoardChecklist,
        getBoards,
      } = useKanbanBoardStore.getState();
      const boardA = create(WORKSPACE_A, "A")!;
      const boardB = create(WORKSPACE_A, "B")!;

      updateBoardChecklist(WORKSPACE_A, boardA.id, [
        { id: "item-1", text: "Only A", done: false },
      ]);

      const boards = getBoards(WORKSPACE_A);
      expect(boards.find((b) => b.id === boardA.id)?.checklist).toHaveLength(1);
      expect(
        boards.find((b) => b.id === boardB.id)?.checklist ?? [],
      ).toHaveLength(0);
    });

    it("deletes a board and all of its tasks", () => {
      const {
        createBoard: create,
        deleteBoard,
        getBoards,
        createTask,
      } = useKanbanBoardStore.getState();
      const board = create(WORKSPACE_A, "To delete")!;
      createTask(board.id, { title: "Task in board", parentId: null });

      expect(
        useKanbanBoardStore.getState().tasksByBoardId[board.id],
      ).toHaveLength(1);

      const ok = deleteBoard(WORKSPACE_A, board.id);

      expect(ok).toBe(true);
      expect(getBoards(WORKSPACE_A)).toHaveLength(0);
      expect(
        useKanbanBoardStore.getState().tasksByBoardId[board.id],
      ).toBeUndefined();
    });

    it("keeps two boards in the same workspace fully isolated (CA-04)", () => {
      const {
        createBoard: create,
        createTask,
        getChildren,
      } = useKanbanBoardStore.getState();
      const boardA = create(WORKSPACE_A, "Board A")!;
      const boardB = create(WORKSPACE_A, "Board B")!;

      createTask(boardA.id, { title: "Task in A", parentId: null });
      createTask(boardB.id, { title: "Task in B", parentId: null });

      expect(getChildren(boardA.id, null)).toHaveLength(1);
      expect(getChildren(boardB.id, null)).toHaveLength(1);
      expect(getChildren(boardA.id, null)[0].title).toBe("Task in A");
      expect(getChildren(boardB.id, null)[0].title).toBe("Task in B");

      useKanbanBoardStore
        .getState()
        .deleteTask(boardA.id, getChildren(boardA.id, null)[0].id);

      expect(getChildren(boardA.id, null)).toHaveLength(0);
      expect(getChildren(boardB.id, null)).toHaveLength(1);
    });
  });

  describe("task actions (partitioned by boardId)", () => {
    it("creates a level 1 -> level 2 -> level 3 task chain", () => {
      const boardId = createBoard();
      const { createTask, getChildren } = useKanbanBoardStore.getState();

      createTask(boardId, { title: "Root", parentId: null });
      const level1 = useKanbanBoardStore.getState().tasksByBoardId[boardId][0];
      expect(level1.level).toBe(1);
      expect(level1.boardId).toBe(boardId);

      createTask(boardId, { title: "Child", parentId: level1.id });
      const level2 = useKanbanBoardStore
        .getState()
        .tasksByBoardId[boardId].find((t) => t.parentId === level1.id)!;
      expect(level2.level).toBe(2);

      createTask(boardId, { title: "Grandchild", parentId: level2.id });
      const level3 = useKanbanBoardStore
        .getState()
        .tasksByBoardId[boardId].find((t) => t.parentId === level2.id)!;
      expect(level3.level).toBe(3);

      expect(getChildren(boardId, level1.id).length).toBe(1);
      expect(getChildren(boardId, level2.id).length).toBe(1);
    });

    it("does not allow creating a child of a level 3 task (no-op)", () => {
      const boardId = createBoard();
      const { createTask } = useKanbanBoardStore.getState();
      createTask(boardId, { title: "L1", parentId: null });
      const l1 = useKanbanBoardStore.getState().tasksByBoardId[boardId][0];
      createTask(boardId, { title: "L2", parentId: l1.id });
      const l2 = useKanbanBoardStore
        .getState()
        .tasksByBoardId[boardId].find((t) => t.parentId === l1.id)!;
      createTask(boardId, { title: "L3", parentId: l2.id });
      const l3 = useKanbanBoardStore
        .getState()
        .tasksByBoardId[boardId].find((t) => t.parentId === l2.id)!;

      const result = useKanbanBoardStore
        .getState()
        .createTask(boardId, { title: "L4 attempt", parentId: l3.id });

      expect(result).toBe(false);
      expect(
        useKanbanBoardStore
          .getState()
          .tasksByBoardId[boardId].filter((t) => t.parentId === l3.id).length,
      ).toBe(0);
    });

    it("updates a task's title and description", () => {
      const boardId = createBoard();
      const { createTask, updateTask } = useKanbanBoardStore.getState();
      createTask(boardId, { title: "Original", parentId: null });
      const task = useKanbanBoardStore.getState().tasksByBoardId[boardId][0];

      updateTask(boardId, task.id, {
        title: "Updated",
        description: "New description",
      });

      const updated = useKanbanBoardStore
        .getState()
        .tasksByBoardId[boardId].find((t) => t.id === task.id)!;
      expect(updated.title).toBe("Updated");
      expect(updated.description).toBe("New description");
      expect(updated.updatedAt).toBeDefined();
    });

    it("moves a task between columns and reindexes order", () => {
      const boardId = createBoard();
      const { createTask, moveTask } = useKanbanBoardStore.getState();
      createTask(boardId, { title: "A", parentId: null });
      createTask(boardId, { title: "B", parentId: null });
      const [a, b] = useKanbanBoardStore.getState().tasksByBoardId[boardId];

      moveTask(boardId, a.id, "in_progress", 0);

      const tasks = useKanbanBoardStore.getState().tasksByBoardId[boardId];
      const movedA = tasks.find((t) => t.id === a.id)!;
      const remainingB = tasks.find((t) => t.id === b.id)!;
      expect(movedA.columnId).toBe("in_progress");
      expect(movedA.order).toBe(0);
      expect(remainingB.columnId).toBe("todo");
      expect(remainingB.order).toBe(0);
    });

    it("deletes a task and all its descendants in cascade", () => {
      const boardId = createBoard();
      const { createTask, deleteTask } = useKanbanBoardStore.getState();
      createTask(boardId, { title: "Root", parentId: null });
      const root = useKanbanBoardStore.getState().tasksByBoardId[boardId][0];
      createTask(boardId, { title: "Child 1", parentId: root.id });
      createTask(boardId, { title: "Child 2", parentId: root.id });
      const child1 = useKanbanBoardStore
        .getState()
        .tasksByBoardId[boardId].find((t) => t.title === "Child 1")!;
      createTask(boardId, { title: "Grandchild", parentId: child1.id });

      expect(
        useKanbanBoardStore.getState().tasksByBoardId[boardId].length,
      ).toBe(4);

      deleteTask(boardId, root.id);

      expect(
        useKanbanBoardStore.getState().tasksByBoardId[boardId].length,
      ).toBe(0);
    });

    it("isolates tasks between different boardIds", () => {
      const boardA = createBoard(WORKSPACE_A);
      const boardB = createBoard(WORKSPACE_B);
      const { createTask } = useKanbanBoardStore.getState();
      createTask(boardA, { title: "Task in A", parentId: null });
      createTask(boardB, { title: "Task in B", parentId: null });

      const tasksA = useKanbanBoardStore.getState().tasksByBoardId[boardA];
      const tasksB = useKanbanBoardStore.getState().tasksByBoardId[boardB];

      expect(tasksA.length).toBe(1);
      expect(tasksB.length).toBe(1);
      expect(tasksA[0].title).toBe("Task in A");
      expect(tasksB[0].title).toBe("Task in B");

      useKanbanBoardStore.getState().deleteTask(boardA, tasksA[0].id);

      expect(useKanbanBoardStore.getState().tasksByBoardId[boardA].length).toBe(
        0,
      );
      expect(useKanbanBoardStore.getState().tasksByBoardId[boardB].length).toBe(
        1,
      );
    });

    it("preserves in-memory state and signals failure when localStorage.setItem throws", () => {
      const boardId = createBoard();
      const setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("QuotaExceededError");
        });

      const result = useKanbanBoardStore
        .getState()
        .createTask(boardId, { title: "Offline task", parentId: null });

      expect(result).toBe(false);
      expect(useKanbanBoardStore.getState().lastPersistFailed).toBe(true);

      const tasks = useKanbanBoardStore.getState().tasksByBoardId[boardId];
      expect(tasks.length).toBe(1);
      expect(tasks[0].title).toBe("Offline task");

      expect(displayErrorToast).toHaveBeenCalled();
      expect(displayErrorToast).toHaveBeenCalledWith(
        i18n.t(I18nKey.KANBAN$SAVE_ERROR),
      );

      setItemSpy.mockRestore();
    });
  });

  // CA-05 / RNF-02: migração v1 -> v2 do `persist`. Simula um snapshot
  // legado gravado diretamente em `localStorage` (sem `boardId`/versão) e
  // confirma que a hidratação do store cria um quadro "Padrão" por
  // workspaceId e migra as tarefas sem perda.
  describe("legacy schema migration (v1 -> v2, CA-05 / RNF-02)", () => {
    it("migrates legacy tasksByWorkspaceId into a 'Padrão' board per workspace, with no task lost", async () => {
      const legacyTaskA = {
        id: "legacy-task-a",
        parentId: null,
        level: 1 as const,
        title: "Legacy task A",
        columnId: "todo" as const,
        order: 0,
        createdAt: "2025-01-01T00:00:00.000Z",
      };
      const legacyTaskB = {
        id: "legacy-task-b",
        parentId: null,
        level: 1 as const,
        title: "Legacy task B",
        columnId: "in_progress" as const,
        order: 0,
        createdAt: "2025-01-02T00:00:00.000Z",
      };
      const legacyState = {
        state: {
          tasksByWorkspaceId: {
            [WORKSPACE_A]: [legacyTaskA],
            [WORKSPACE_B]: [legacyTaskB],
          },
        },
        version: 1,
      };
      localStorage.setItem(
        KANBAN_BOARD_STORAGE_KEY,
        JSON.stringify(legacyState),
      );

      await useKanbanBoardStore.persist.rehydrate();

      const state = useKanbanBoardStore.getState();

      const boardsA = state.boardsByWorkspaceId[WORKSPACE_A];
      const boardsB = state.boardsByWorkspaceId[WORKSPACE_B];
      expect(boardsA).toHaveLength(1);
      expect(boardsB).toHaveLength(1);
      expect(boardsA[0].name).toBe(i18n.t(I18nKey.KANBAN$DEFAULT_BOARD_NAME));
      expect(boardsA[0].workspaceId).toBe(WORKSPACE_A);

      const tasksA = state.tasksByBoardId[boardsA[0].id];
      const tasksB = state.tasksByBoardId[boardsB[0].id];
      expect(tasksA).toHaveLength(1);
      expect(tasksB).toHaveLength(1);
      expect(tasksA[0].title).toBe("Legacy task A");
      expect(tasksA[0].boardId).toBe(boardsA[0].id);
      expect(tasksA[0].updatedAt).toBeDefined();
      expect(tasksB[0].title).toBe("Legacy task B");
    });

    it("creates no board for a workspace that had zero legacy tasks", async () => {
      const legacyState = {
        state: {
          tasksByWorkspaceId: {
            [WORKSPACE_A]: [],
          },
        },
        version: 1,
      };
      localStorage.setItem(
        KANBAN_BOARD_STORAGE_KEY,
        JSON.stringify(legacyState),
      );

      await useKanbanBoardStore.persist.rehydrate();

      const state = useKanbanBoardStore.getState();
      expect(state.boardsByWorkspaceId[WORKSPACE_A] ?? []).toHaveLength(0);
    });
  });
});

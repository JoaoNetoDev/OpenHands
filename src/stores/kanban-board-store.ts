import { create, type StoreApi } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import type {
  KanbanBoard,
  KanbanChecklistItem,
  KanbanColumnId,
  KanbanTask,
} from "#/types/kanban";
import { collectDescendantIds, reindexAfterMove } from "#/utils/kanban-tree";
import i18n from "#/i18n";
import { I18nKey } from "#/i18n/declaration";
import { displayErrorToast } from "#/utils/custom-toast-handlers";

export const KANBAN_BOARD_STORAGE_KEY = "openhands-kanban-board";

/** Current `persist` schema version (SPEC §2.4 / TECH §2.4). Bump this and
 * extend `migrate` whenever the persisted shape changes. */
const KANBAN_BOARD_PERSIST_VERSION = 2;

interface KanbanBoardState {
  boardsByWorkspaceId: Record<string, KanbanBoard[]>;
  tasksByBoardId: Record<string, KanbanTask[]>;
  /**
   * `true` when the most recent write attempted a `localStorage` persist
   * and it failed (e.g. quota exceeded). In-memory state is preserved
   * regardless — this flag only signals that persistence is unreliable.
   * `trySet` also fires an error toast whenever a write fails.
   */
  lastPersistFailed: boolean;
}

interface KanbanBoardActions {
  createBoard: (workspaceId: string, name: string) => KanbanBoard | null;
  renameBoard: (workspaceId: string, boardId: string, name: string) => boolean;
  deleteBoard: (workspaceId: string, boardId: string) => boolean;
  getBoards: (workspaceId: string) => KanbanBoard[];

  createTask: (
    boardId: string,
    input: { title: string; description?: string; parentId: string | null },
  ) => boolean;
  updateTask: (
    boardId: string,
    taskId: string,
    patch: Partial<
      Pick<
        KanbanTask,
        | "title"
        | "description"
        | "userContextHtml"
        | "agentContextHtml"
        | "attachments"
        | "lastSinteredAt"
        | "featureSlug"
        | "linkedConversationId"
        | "columnId"
        | "checklist"
      >
    >,
  ) => boolean;
  updateBoardChecklist: (
    workspaceId: string,
    boardId: string,
    checklist: KanbanChecklistItem[],
  ) => boolean;
  deleteTask: (boardId: string, taskId: string) => boolean;
  moveTask: (
    boardId: string,
    taskId: string,
    toColumnId: KanbanColumnId,
    toOrder: number,
  ) => boolean;
  getChildren: (boardId: string, parentId: string | null) => KanbanTask[];
}

type KanbanBoardStore = KanbanBoardState & KanbanBoardActions;

/** Legacy (pre-v2) persisted shape: one task list per `workspaceId`, tasks
 * without `boardId`/`updatedAt`. */
interface LegacyKanbanBoardStateV1 {
  tasksByWorkspaceId?: Record<
    string,
    Omit<KanbanTask, "boardId" | "updatedAt">[]
  >;
}

/**
 * Migrates the pre-v2 persisted shape (one task list per `workspaceId`) to
 * the v2 shape (boards + tasks partitioned by `boardId`). For every
 * `workspaceId` that had at least one task, a single "Padrão" board is
 * created and all of that workspace's tasks are moved under it — no task is
 * dropped (RNF-02 / CA-05).
 */
function migrateLegacyBoardShape(
  legacy: LegacyKanbanBoardStateV1,
): Pick<KanbanBoardState, "boardsByWorkspaceId" | "tasksByBoardId"> {
  const boardsByWorkspaceId: Record<string, KanbanBoard[]> = {};
  const tasksByBoardId: Record<string, KanbanTask[]> = {};
  const now = new Date().toISOString();

  const legacyTasksByWorkspaceId = legacy.tasksByWorkspaceId ?? {};
  Object.entries(legacyTasksByWorkspaceId).forEach(([workspaceId, tasks]) => {
    if (!tasks || tasks.length === 0) return;
    const board: KanbanBoard = {
      id: uuidv4(),
      workspaceId,
      name: i18n.t(I18nKey.KANBAN$DEFAULT_BOARD_NAME),
      createdAt: now,
    };
    boardsByWorkspaceId[workspaceId] = [board];
    tasksByBoardId[board.id] = tasks.map((task) => ({
      ...task,
      boardId: board.id,
      updatedAt: task.createdAt ?? now,
    }));
  });

  return { boardsByWorkspaceId, tasksByBoardId };
}

/** Calls `set()` and swallows any exception (e.g. a storage write error
 * thrown synchronously by the `persist` middleware from within `set()`
 * itself), so callers never need to nest try/catch around flag updates. */
function safeSet(
  set: StoreApi<KanbanBoardStore>["setState"],
  partial: Partial<KanbanBoardStore>,
): void {
  try {
    set(partial);
  } catch {
    // The `persist` middleware already applied the in-memory update before
    // its own storage write threw; nothing more to do here.
  }
}

function trySetTasks(
  set: StoreApi<KanbanBoardStore>["setState"],
  boardId: string,
  nextTasks: KanbanTask[],
): boolean {
  // The `persist` middleware writes to storage synchronously inside this
  // `set()` call (after applying the in-memory update), so a storage error
  // (e.g. `QuotaExceededError`) surfaces as a thrown exception here even
  // though the in-memory state has already been applied by that point.
  try {
    set((state) => ({
      tasksByBoardId: {
        ...state.tasksByBoardId,
        [boardId]: nextTasks,
      },
    }));
  } catch {
    safeSet(set, { lastPersistFailed: true });
    displayErrorToast(i18n.t(I18nKey.KANBAN$SAVE_ERROR));
    return false;
  }

  try {
    const raw = localStorage.getItem(KANBAN_BOARD_STORAGE_KEY);
    const persisted = raw?.includes(boardId) ?? false;
    safeSet(set, { lastPersistFailed: !persisted });
    if (!persisted) {
      displayErrorToast(i18n.t(I18nKey.KANBAN$SAVE_ERROR));
    }
    return persisted;
  } catch {
    safeSet(set, { lastPersistFailed: true });
    displayErrorToast(i18n.t(I18nKey.KANBAN$SAVE_ERROR));
    return false;
  }
}

function trySetBoards(
  set: StoreApi<KanbanBoardStore>["setState"],
  workspaceId: string,
  nextBoards: KanbanBoard[],
): boolean {
  try {
    set((state) => ({
      boardsByWorkspaceId: {
        ...state.boardsByWorkspaceId,
        [workspaceId]: nextBoards,
      },
    }));
  } catch {
    safeSet(set, { lastPersistFailed: true });
    displayErrorToast(i18n.t(I18nKey.KANBAN$SAVE_ERROR));
    return false;
  }

  try {
    const raw = localStorage.getItem(KANBAN_BOARD_STORAGE_KEY);
    const persisted = raw?.includes(workspaceId) ?? false;
    safeSet(set, { lastPersistFailed: !persisted });
    if (!persisted) {
      displayErrorToast(i18n.t(I18nKey.KANBAN$SAVE_ERROR));
    }
    return persisted;
  } catch {
    safeSet(set, { lastPersistFailed: true });
    displayErrorToast(i18n.t(I18nKey.KANBAN$SAVE_ERROR));
    return false;
  }
}

export const useKanbanBoardStore = create<KanbanBoardStore>()(
  persist(
    (set, get) => ({
      boardsByWorkspaceId: {},
      tasksByBoardId: {},
      lastPersistFailed: false,

      createBoard: (workspaceId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const boards = get().boardsByWorkspaceId[workspaceId] ?? [];
        const newBoard: KanbanBoard = {
          id: uuidv4(),
          workspaceId,
          name: trimmed,
          createdAt: new Date().toISOString(),
        };
        // In-memory state is always applied (optimistic), even when the
        // `localStorage` write itself fails — see `trySetBoards`.
        trySetBoards(set, workspaceId, [...boards, newBoard]);
        return newBoard;
      },

      renameBoard: (workspaceId, boardId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return false;
        const boards = get().boardsByWorkspaceId[workspaceId] ?? [];
        return trySetBoards(
          set,
          workspaceId,
          boards.map((b) => (b.id === boardId ? { ...b, name: trimmed } : b)),
        );
      },

      updateBoardChecklist: (workspaceId, boardId, checklist) => {
        const boards = get().boardsByWorkspaceId[workspaceId] ?? [];
        return trySetBoards(
          set,
          workspaceId,
          boards.map((b) => (b.id === boardId ? { ...b, checklist } : b)),
        );
      },

      deleteBoard: (workspaceId, boardId) => {
        const boards = get().boardsByWorkspaceId[workspaceId] ?? [];
        const boardsOk = trySetBoards(
          set,
          workspaceId,
          boards.filter((b) => b.id !== boardId),
        );
        safeSet(set, {
          tasksByBoardId: Object.fromEntries(
            Object.entries(get().tasksByBoardId).filter(
              ([id]) => id !== boardId,
            ),
          ),
        });
        return boardsOk;
      },

      getBoards: (workspaceId) => get().boardsByWorkspaceId[workspaceId] ?? [],

      createTask: (boardId, input) => {
        const tasks = get().tasksByBoardId[boardId] ?? [];
        const parent = input.parentId
          ? tasks.find((t) => t.id === input.parentId)
          : null;
        if (input.parentId && !parent) return false; // parent inexistente: no-op defensivo
        if (parent?.level === 3) return false; // nível 3 não tem filhos
        const level = parent ? ((parent.level + 1) as 1 | 2 | 3) : 1;
        const siblings = tasks.filter(
          (t) =>
            t.parentId === (input.parentId ?? null) && t.columnId === "todo",
        );
        const now = new Date().toISOString();
        const newTask: KanbanTask = {
          id: uuidv4(),
          boardId,
          parentId: input.parentId ?? null,
          level,
          title: input.title,
          description: input.description,
          columnId: "todo",
          order: siblings.length,
          createdAt: now,
          updatedAt: now,
        };
        return trySetTasks(set, boardId, [...tasks, newTask]);
      },

      updateTask: (boardId, taskId, patch) => {
        const tasks = get().tasksByBoardId[boardId] ?? [];
        return trySetTasks(
          set,
          boardId,
          tasks.map((t) =>
            t.id === taskId
              ? { ...t, ...patch, updatedAt: new Date().toISOString() }
              : t,
          ),
        );
      },

      deleteTask: (boardId, taskId) => {
        const tasks = get().tasksByBoardId[boardId] ?? [];
        const toRemove = collectDescendantIds(tasks, taskId);
        toRemove.add(taskId);
        return trySetTasks(
          set,
          boardId,
          tasks.filter((t) => !toRemove.has(t.id)),
        );
      },

      moveTask: (boardId, taskId, toColumnId, toOrder) => {
        const tasks = get().tasksByBoardId[boardId] ?? [];
        return trySetTasks(
          set,
          boardId,
          reindexAfterMove(tasks, taskId, toColumnId, toOrder).map((t) =>
            t.id === taskId ? { ...t, updatedAt: new Date().toISOString() } : t,
          ),
        );
      },

      getChildren: (boardId, parentId) =>
        (get().tasksByBoardId[boardId] ?? []).filter(
          (t) => t.parentId === parentId,
        ),
    }),
    {
      name: KANBAN_BOARD_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: KANBAN_BOARD_PERSIST_VERSION,
      migrate: (persistedState) => {
        const legacy = (persistedState ?? {}) as LegacyKanbanBoardStateV1 &
          Partial<KanbanBoardState>;
        if (legacy.tasksByBoardId || legacy.boardsByWorkspaceId) {
          // Already v2 shape (or later persisted with the same fields) —
          // nothing to migrate.
          return {
            boardsByWorkspaceId: legacy.boardsByWorkspaceId ?? {},
            tasksByBoardId: legacy.tasksByBoardId ?? {},
          };
        }
        return migrateLegacyBoardShape(legacy);
      },
      partialize: (
        state,
      ): Pick<KanbanBoardState, "boardsByWorkspaceId" | "tasksByBoardId"> => ({
        boardsByWorkspaceId: state.boardsByWorkspaceId,
        tasksByBoardId: state.tasksByBoardId,
      }),
    },
  ),
);

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
import {
  mergeBoardFiles,
  readBoardFile,
  writeBoardFile,
  type KanbanBoardFile,
} from "#/api/kanban-board-file.api";

export const KANBAN_BOARD_STORAGE_KEY = "openhands-kanban-board";

/** Write-behind debounce delay (TECH §2.6): a mutation schedules a
 * `board.json` write this many ms in the future, resetting the timer on
 * every subsequent mutation to the same workspace, so a burst of edits
 * results in a single write instead of one per keystroke/drag. */
const BOARD_FILE_WRITE_DEBOUNCE_MS = 800;

/** One pending write timer per `workspaceId`, module-level (outside the
 * store) so it survives across `set()` calls and is shared by every
 * mutating action. */
const pendingWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Builds the `board.json` envelope for a single workspace from the
 * in-memory store state — only the boards that belong to `workspaceId` and
 * their tasks, never the whole cross-workspace state. */
function buildBoardFileForWorkspace(
  state: Pick<KanbanBoardState, "boardsByWorkspaceId" | "tasksByBoardId">,
  workspaceId: string,
): KanbanBoardFile {
  const boards = state.boardsByWorkspaceId[workspaceId] ?? [];
  const tasksByBoardId: Record<string, KanbanTask[]> = {};
  boards.forEach((board) => {
    tasksByBoardId[board.id] = state.tasksByBoardId[board.id] ?? [];
  });
  return {
    version: 1,
    boards,
    tasksByBoardId,
    updatedAt: new Date().toISOString(),
  };
}

function findWorkspaceIdForBoard(
  state: Pick<KanbanBoardState, "boardsByWorkspaceId">,
  boardId: string,
): string | null {
  const entry = Object.entries(state.boardsByWorkspaceId).find(([, boards]) =>
    boards.some((b) => b.id === boardId),
  );
  return entry ? entry[0] : null;
}

/**
 * Schedules a debounced write-behind of `board.json` for `workspaceId`
 * (TECH §2.6). A no-op when `syncFromFile` was never called for this
 * workspace in this session (`workspacePathsByWorkspaceId` has no entry) —
 * matches v1 behavior (localStorage-only) until the caller has explicitly
 * opted a workspace into file persistence.
 *
 * `writeBoardFile` itself re-reads the current on-disk file and merges
 * task-by-task before writing (read-modify-write, see
 * `kanban-board-file.api.ts`) — this function only decides *when* to call
 * it, not how the merge happens.
 */
function debouncedWriteBoardFile(
  getState: () => KanbanBoardStore,
  workspaceId: string,
): void {
  const workspacePath = getState().workspacePathsByWorkspaceId[workspaceId];
  if (!workspacePath) return;

  const existingTimer = pendingWriteTimers.get(workspaceId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    pendingWriteTimers.delete(workspaceId);
    const state = getState();
    const file = buildBoardFileForWorkspace(state, workspaceId);
    writeBoardFile(workspacePath, workspaceId, file)
      .then((result) => {
        if (!result.ok) {
          displayErrorToast(i18n.t(I18nKey.KANBAN$BOARD_FILE_SAVE_ERROR));
        }
      })
      .catch(() => {
        displayErrorToast(i18n.t(I18nKey.KANBAN$BOARD_FILE_SAVE_ERROR));
      });
  }, BOARD_FILE_WRITE_DEBOUNCE_MS);
  pendingWriteTimers.set(workspaceId, timer);
}

/** Test-only: clears any pending debounced writes and the module-level
 * timer map, so tests don't leak timers/state across cases. */
export function __resetKanbanBoardFileWritesForTests(): void {
  pendingWriteTimers.forEach((timer) => clearTimeout(timer));
  pendingWriteTimers.clear();
}

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
  /**
   * `workspacePath` registered by the most recent `syncFromFile` call for
   * each `workspaceId` (TECH §2.6). Ephemeral, runtime-only — deliberately
   * excluded from `partialize` below, never persisted to `localStorage`.
   * A workspace with no entry here has never opted into file persistence
   * in this session, so mutations only write to `localStorage` (v1
   * behavior), matching the Cloud-backend fallback.
   */
  workspacePathsByWorkspaceId: Record<string, string>;
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
        | "rejectionReason"
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

  /**
   * Reads `board.json` for `workspaceId` (no-op with `{ ok: false,
   * error: "cloud_unsupported" }` behavior on Cloud, handled inside
   * `readBoardFile`), merges it against the in-memory state task-by-task
   * (`mergeBoardFiles`, most recent `updatedAt` wins per task) instead of
   * overwriting, and registers `workspacePath` so subsequent mutations
   * start writing this workspace's `board.json` in the background
   * (TECH §2.6). Safe to call repeatedly (e.g. on every route entry).
   */
  syncFromFile: (workspaceId: string, workspacePath: string) => Promise<void>;
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
      workspacePathsByWorkspaceId: {},

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
        debouncedWriteBoardFile(get, workspaceId);
        return newBoard;
      },

      renameBoard: (workspaceId, boardId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return false;
        const boards = get().boardsByWorkspaceId[workspaceId] ?? [];
        const ok = trySetBoards(
          set,
          workspaceId,
          boards.map((b) => (b.id === boardId ? { ...b, name: trimmed } : b)),
        );
        debouncedWriteBoardFile(get, workspaceId);
        return ok;
      },

      updateBoardChecklist: (workspaceId, boardId, checklist) => {
        const boards = get().boardsByWorkspaceId[workspaceId] ?? [];
        const ok = trySetBoards(
          set,
          workspaceId,
          boards.map((b) => (b.id === boardId ? { ...b, checklist } : b)),
        );
        debouncedWriteBoardFile(get, workspaceId);
        return ok;
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
        debouncedWriteBoardFile(get, workspaceId);
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
        const ok = trySetTasks(set, boardId, [...tasks, newTask]);
        const workspaceId = findWorkspaceIdForBoard(get(), boardId);
        if (workspaceId) debouncedWriteBoardFile(get, workspaceId);
        return ok;
      },

      updateTask: (boardId, taskId, patch) => {
        const tasks = get().tasksByBoardId[boardId] ?? [];
        const ok = trySetTasks(
          set,
          boardId,
          tasks.map((t) =>
            t.id === taskId
              ? { ...t, ...patch, updatedAt: new Date().toISOString() }
              : t,
          ),
        );
        const workspaceId = findWorkspaceIdForBoard(get(), boardId);
        if (workspaceId) debouncedWriteBoardFile(get, workspaceId);
        return ok;
      },

      deleteTask: (boardId, taskId) => {
        const tasks = get().tasksByBoardId[boardId] ?? [];
        const toRemove = collectDescendantIds(tasks, taskId);
        toRemove.add(taskId);
        const ok = trySetTasks(
          set,
          boardId,
          tasks.filter((t) => !toRemove.has(t.id)),
        );
        const workspaceId = findWorkspaceIdForBoard(get(), boardId);
        if (workspaceId) debouncedWriteBoardFile(get, workspaceId);
        return ok;
      },

      moveTask: (boardId, taskId, toColumnId, toOrder) => {
        const tasks = get().tasksByBoardId[boardId] ?? [];
        const ok = trySetTasks(
          set,
          boardId,
          reindexAfterMove(tasks, taskId, toColumnId, toOrder).map((t) =>
            t.id === taskId ? { ...t, updatedAt: new Date().toISOString() } : t,
          ),
        );
        const workspaceId = findWorkspaceIdForBoard(get(), boardId);
        if (workspaceId) debouncedWriteBoardFile(get, workspaceId);
        return ok;
      },

      getChildren: (boardId, parentId) =>
        (get().tasksByBoardId[boardId] ?? []).filter(
          (t) => t.parentId === parentId,
        ),

      syncFromFile: async (workspaceId, workspacePath) => {
        safeSet(set, {
          workspacePathsByWorkspaceId: {
            ...get().workspacePathsByWorkspaceId,
            [workspaceId]: workspacePath,
          },
        });

        const result = await readBoardFile(workspacePath, workspaceId);
        if (!result.ok) {
          // cloud_unsupported / not_found / invalid_schema — stay on
          // localStorage-only for this workspace (same as v1).
          return;
        }

        const state = get();
        const memoryFile = buildBoardFileForWorkspace(state, workspaceId);
        const merged = mergeBoardFiles(result.data, memoryFile);

        const oldBoardIds = new Set(
          (state.boardsByWorkspaceId[workspaceId] ?? []).map((b) => b.id),
        );
        const newBoardIds = new Set(merged.boards.map((b) => b.id));
        const nextTasksByBoardId: Record<string, KanbanTask[]> = {
          ...state.tasksByBoardId,
        };
        oldBoardIds.forEach((id) => {
          if (!newBoardIds.has(id)) delete nextTasksByBoardId[id];
        });
        Object.assign(nextTasksByBoardId, merged.tasksByBoardId);

        safeSet(set, {
          boardsByWorkspaceId: {
            ...get().boardsByWorkspaceId,
            [workspaceId]: merged.boards,
          },
          tasksByBoardId: nextTasksByBoardId,
        });
      },
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

import { create, type StoreApi } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import type { KanbanColumnId, KanbanTask } from "#/types/kanban";
import { collectDescendantIds, reindexAfterMove } from "#/utils/kanban-tree";
import i18n from "#/i18n";
import { I18nKey } from "#/i18n/declaration";
import { displayErrorToast } from "#/utils/custom-toast-handlers";

export const KANBAN_BOARD_STORAGE_KEY = "openhands-kanban-board";

interface KanbanBoardState {
  tasksByWorkspaceId: Record<string, KanbanTask[]>;
  /**
   * `true` when the most recent write attempted a `localStorage` persist
   * and it failed (e.g. quota exceeded). In-memory state is preserved
   * regardless — this flag only signals that persistence is unreliable.
   * `trySet` also fires an error toast whenever a write fails.
   */
  lastPersistFailed: boolean;
}

interface KanbanBoardActions {
  createTask: (
    workspaceId: string,
    input: { title: string; description?: string; parentId: string | null },
  ) => boolean;
  updateTask: (
    workspaceId: string,
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
      >
    >,
  ) => boolean;
  deleteTask: (workspaceId: string, taskId: string) => boolean;
  moveTask: (
    workspaceId: string,
    taskId: string,
    toColumnId: KanbanColumnId,
    toOrder: number,
  ) => boolean;
  getChildren: (workspaceId: string, parentId: string | null) => KanbanTask[];
}

type KanbanBoardStore = KanbanBoardState & KanbanBoardActions;

/**
 * Applies `set()` optimistically (in-memory state always updates), then
 * tries to confirm the write landed in `localStorage` by reading the key
 * back. If it didn't (or reading/writing throws, e.g. `QuotaExceededError`),
 * marks `lastPersistFailed: true` but keeps the in-memory state as applied.
 * Returns `true` if the write is confirmed persisted, `false` otherwise.
 */
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

function trySet(
  set: StoreApi<KanbanBoardStore>["setState"],
  workspaceId: string,
  nextTasks: KanbanTask[],
): boolean {
  // The `persist` middleware writes to storage synchronously inside this
  // `set()` call (after applying the in-memory update), so a storage error
  // (e.g. `QuotaExceededError`) surfaces as a thrown exception here even
  // though the in-memory state has already been applied by that point.
  try {
    set((state) => ({
      tasksByWorkspaceId: {
        ...state.tasksByWorkspaceId,
        [workspaceId]: nextTasks,
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
      tasksByWorkspaceId: {},
      lastPersistFailed: false,

      createTask: (workspaceId, input) => {
        const tasks = get().tasksByWorkspaceId[workspaceId] ?? [];
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
        const newTask: KanbanTask = {
          id: uuidv4(),
          parentId: input.parentId ?? null,
          level,
          title: input.title,
          description: input.description,
          columnId: "todo",
          order: siblings.length,
          createdAt: new Date().toISOString(),
        };
        return trySet(set, workspaceId, [...tasks, newTask]);
      },

      updateTask: (workspaceId, taskId, patch) => {
        const tasks = get().tasksByWorkspaceId[workspaceId] ?? [];
        return trySet(
          set,
          workspaceId,
          tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
        );
      },

      deleteTask: (workspaceId, taskId) => {
        const tasks = get().tasksByWorkspaceId[workspaceId] ?? [];
        const toRemove = collectDescendantIds(tasks, taskId);
        toRemove.add(taskId);
        return trySet(
          set,
          workspaceId,
          tasks.filter((t) => !toRemove.has(t.id)),
        );
      },

      moveTask: (workspaceId, taskId, toColumnId, toOrder) => {
        const tasks = get().tasksByWorkspaceId[workspaceId] ?? [];
        return trySet(
          set,
          workspaceId,
          reindexAfterMove(tasks, taskId, toColumnId, toOrder),
        );
      },

      getChildren: (workspaceId, parentId) =>
        (get().tasksByWorkspaceId[workspaceId] ?? []).filter(
          (t) => t.parentId === parentId,
        ),
    }),
    {
      name: KANBAN_BOARD_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): Pick<KanbanBoardState, "tasksByWorkspaceId"> => ({
        tasksByWorkspaceId: state.tasksByWorkspaceId,
      }),
    },
  ),
);

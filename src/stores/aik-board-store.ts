import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type {
  AikColumnId,
  AikErrorType,
  AikPhase,
  AikSystem,
  AikSystemColumnId,
  AikSystemFile,
  AikTask,
  AikTimelineEntry,
  AikWorkspaceRef,
} from "#/types/aik";
import { wouldCreateCycle } from "#/utils/aik-dependency-graph";
import {
  readAikSystemFile,
  mergeAikSystemFiles,
} from "#/api/aik-board-file.api";
import { startAikAgentTask } from "#/api/aik-pipeline.api";
import { pauseConversation } from "#/hooks/mutation/conversation-mutation-utils";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";

/** Polling interval for `startPolling` (TECH §2.3): covers RF-27's 5s
 * budget (M6) with margin. */
const AIK_POLL_INTERVAL_MS = 4000;

/**
 * Recomputes sequential `order` (0..n-1) for the siblings (same `phaseId`)
 * of the moved task in both the origin column and the destination column,
 * after moving `taskId` to `toColumnId` at position `toOrder`. Adapted from
 * `reindexAfterMove` (`src/utils/kanban-tree.ts:33`), trading `parentId`
 * for `phaseId` — an AIK task never has children, so
 * `collectDescendantIds` has no equivalent here (TECH §2.3).
 */
function reindexTasksAfterMove(
  tasks: AikTask[],
  taskId: string,
  toColumnId: AikColumnId,
  toOrder: number,
): AikTask[] {
  const moving = tasks.find((t) => t.id === taskId);
  if (!moving) return tasks;

  const { phaseId } = moving;
  const fromColumnId = moving.columnId;

  const destSiblings = tasks
    .filter(
      (t) =>
        t.id !== taskId && t.phaseId === phaseId && t.columnId === toColumnId,
    )
    .sort((a, b) => a.order - b.order);

  const clampedOrder = Math.max(0, Math.min(toOrder, destSiblings.length));
  destSiblings.splice(clampedOrder, 0, { ...moving, columnId: toColumnId });

  const destOrderById = new Map<string, number>();
  destSiblings.forEach((t, index) => destOrderById.set(t.id, index));

  const originSiblings =
    fromColumnId === toColumnId
      ? []
      : tasks
          .filter(
            (t) =>
              t.id !== taskId &&
              t.phaseId === phaseId &&
              t.columnId === fromColumnId,
          )
          .sort((a, b) => a.order - b.order);

  const originOrderById = new Map<string, number>();
  originSiblings.forEach((t, index) => originOrderById.set(t.id, index));

  return tasks.map((t) => {
    if (destOrderById.has(t.id)) {
      const order = destOrderById.get(t.id)!;
      return t.id === taskId
        ? { ...t, columnId: toColumnId, order }
        : { ...t, order };
    }
    if (originOrderById.has(t.id)) {
      return { ...t, order: originOrderById.get(t.id)! };
    }
    return t;
  });
}

/**
 * RF-09 (a)-(e): derives a phase's `columnId` from its child tasks,
 * priority-ordered:
 * (a) every task `done` -> `done`
 * (b) no tasks at all -> `backlog`
 * (c) any task `in_review` -> `in_review`
 * (d) any task `in_progress` -> `in_progress`
 * (e) otherwise (mix of `backlog`/`done`, no `in_progress`/`in_review`) -> `backlog`
 */
function deriveAikPhaseColumnId(tasks: AikTask[]): AikColumnId {
  if (tasks.length === 0) return "backlog"; // (b)
  if (tasks.every((t) => t.columnId === "done")) return "done"; // (a)
  if (tasks.some((t) => t.columnId === "in_review")) return "in_review"; // (c)
  if (tasks.some((t) => t.columnId === "in_progress")) return "in_progress"; // (d)
  return "backlog"; // (e)
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeTimelineEntry(
  partial: Omit<AikTimelineEntry, "id" | "at">,
): AikTimelineEntry {
  return { id: uuidv4(), at: nowIso(), ...partial };
}

interface AikBoardState {
  systems: AikSystem[];
  phasesBySystemId: Record<string, AikPhase[]>;
  tasksBySystemId: Record<string, AikTask[]>;
  errorBySystemId: Record<
    string,
    { errorType: AikErrorType; detail: string } | undefined
  >;
}

interface AikBoardActions {
  createSystem(input: {
    name: string;
    backendId: string;
    workspaceRef: AikWorkspaceRef;
  }): AikSystem;
  renameSystem(systemId: string, name: string): void;
  moveSystem(systemId: string, toColumnId: AikSystemColumnId): void;
  deleteSystem(systemId: string): void;

  createPhase(systemId: string, title: string): AikPhase;
  renamePhase(phaseId: string, title: string): void;
  deletePhase(phaseId: string): void;

  createTask(
    phaseId: string,
    input: { title: string } & Partial<
      Omit<
        AikTask,
        "id" | "phaseId" | "systemId" | "timeline" | "createdAt" | "updatedAt"
      >
    >,
  ): AikTask;
  updateTask(taskId: string, patch: Partial<AikTask>): void;
  moveTask(taskId: string, toColumnId: AikColumnId, toOrder: number): void;
  deleteTask(taskId: string): void;

  startAgent(
    taskId: string,
  ): Promise<
    { ok: true; conversationId: string } | { ok: false; error: string }
  >;
  stopAgent(taskId: string): Promise<void>;
  approveTask(taskId: string): void;
  returnTask(taskId: string, feedback: string): void;
  addComment(taskId: string, text: string): void;

  syncFromFile(systemId: string): Promise<void>;
  startPolling(systemId: string): () => void;
}

type AikBoardStore = AikBoardState & AikBoardActions;

/** Finds the phase for `phaseId`, searching every system's phase list —
 * `phaseId` alone doesn't carry `systemId`, so this is a linear scan; the
 * caller usually already has the task (which does carry `systemId`) and
 * should prefer that path when available. */
function findPhaseAndSystemId(
  phasesBySystemId: Record<string, AikPhase[]>,
  phaseId: string,
): { phase: AikPhase; systemId: string } | null {
  for (const [systemId, phases] of Object.entries(phasesBySystemId)) {
    const phase = phases.find((p) => p.id === phaseId);
    if (phase) return { phase, systemId };
  }
  return null;
}

/** Recomputes and applies the derived `columnId` (RF-09) of the phase that
 * owns `phaseId`, for the given `systemId`, using its current tasks. Pure
 * state->state transform, meant to be called from inside a `set()` updater
 * alongside a task mutation so the recalculation is always a synchronous
 * side effect of the same call (never a separate action the caller must
 * remember to trigger). */
function recalcPhaseColumnInState(
  state: AikBoardState,
  systemId: string,
  phaseId: string,
): Pick<AikBoardState, "phasesBySystemId"> {
  const tasks = (state.tasksBySystemId[systemId] ?? []).filter(
    (t) => t.phaseId === phaseId,
  );
  const nextColumnId = deriveAikPhaseColumnId(tasks);
  const phases = state.phasesBySystemId[systemId] ?? [];
  return {
    phasesBySystemId: {
      ...state.phasesBySystemId,
      [systemId]: phases.map((p) =>
        p.id === phaseId && p.columnId !== nextColumnId
          ? { ...p, columnId: nextColumnId, updatedAt: nowIso() }
          : p,
      ),
    },
  };
}

export const useAikBoardStore = create<AikBoardStore>()((set, get) => ({
  systems: [],
  phasesBySystemId: {},
  tasksBySystemId: {},
  errorBySystemId: {},

  createSystem: (input) => {
    const now = nowIso();
    const system: AikSystem = {
      id: uuidv4(),
      name: input.name,
      backendId: input.backendId,
      workspaceRef: input.workspaceRef,
      columnId: "ativo",
      activeAgentTaskId: null,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({
      systems: [...state.systems, system],
      phasesBySystemId: { ...state.phasesBySystemId, [system.id]: [] },
      tasksBySystemId: { ...state.tasksBySystemId, [system.id]: [] },
    }));
    return system;
  },

  renameSystem: (systemId, name) => {
    set((state) => ({
      systems: state.systems.map((s) =>
        s.id === systemId ? { ...s, name, updatedAt: nowIso() } : s,
      ),
    }));
  },

  moveSystem: (systemId, toColumnId) => {
    set((state) => ({
      systems: state.systems.map((s) =>
        s.id === systemId
          ? { ...s, columnId: toColumnId, updatedAt: nowIso() }
          : s,
      ),
    }));
  },

  deleteSystem: (systemId) => {
    set((state) => {
      const { [systemId]: _removedPhases, ...phasesBySystemId } =
        state.phasesBySystemId;
      const { [systemId]: _removedTasks, ...tasksBySystemId } =
        state.tasksBySystemId;
      const { [systemId]: _removedError, ...errorBySystemId } =
        state.errorBySystemId;
      return {
        systems: state.systems.filter((s) => s.id !== systemId),
        phasesBySystemId,
        tasksBySystemId,
        errorBySystemId,
      };
    });
  },

  createPhase: (systemId, title) => {
    const now = nowIso();
    const phase: AikPhase = {
      id: uuidv4(),
      systemId,
      title,
      columnId: "backlog", // (b): no tasks yet
      order: (get().phasesBySystemId[systemId] ?? []).length,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({
      phasesBySystemId: {
        ...state.phasesBySystemId,
        [systemId]: [...(state.phasesBySystemId[systemId] ?? []), phase],
      },
    }));
    return phase;
  },

  renamePhase: (phaseId, title) => {
    set((state) => {
      const found = findPhaseAndSystemId(state.phasesBySystemId, phaseId);
      if (!found) return state;
      const { systemId } = found;
      return {
        phasesBySystemId: {
          ...state.phasesBySystemId,
          [systemId]: state.phasesBySystemId[systemId].map((p) =>
            p.id === phaseId ? { ...p, title, updatedAt: nowIso() } : p,
          ),
        },
      };
    });
  },

  deletePhase: (phaseId) => {
    set((state) => {
      const found = findPhaseAndSystemId(state.phasesBySystemId, phaseId);
      if (!found) return state;
      const { systemId } = found;
      return {
        phasesBySystemId: {
          ...state.phasesBySystemId,
          [systemId]: state.phasesBySystemId[systemId].filter(
            (p) => p.id !== phaseId,
          ),
        },
        tasksBySystemId: {
          ...state.tasksBySystemId,
          [systemId]: (state.tasksBySystemId[systemId] ?? []).filter(
            (t) => t.phaseId !== phaseId,
          ),
        },
      };
    });
  },

  createTask: (phaseId, input) => {
    const found = findPhaseAndSystemId(get().phasesBySystemId, phaseId);
    if (!found) {
      throw new Error(`aik-board-store: unknown phaseId "${phaseId}"`);
    }
    const { systemId } = found;
    const now = nowIso();

    if (
      input.blockedByTaskId &&
      wouldCreateCycle(
        get().tasksBySystemId[systemId] ?? [],
        // The new task doesn't have an id yet; use a placeholder that
        // cannot collide with an existing task id and cannot be reached
        // from itself, since cycle detection only needs to know whether
        // `blockedByTaskId` is reachable FROM the candidate — a brand new
        // task can never already be an ancestor of anything.
        "__new_task__",
        input.blockedByTaskId,
      )
    ) {
      throw new Error(
        "aik-board-store: blockedByTaskId would create a dependency cycle",
      );
    }

    const siblings = (get().tasksBySystemId[systemId] ?? []).filter(
      (t) =>
        t.phaseId === phaseId && t.columnId === (input.columnId ?? "backlog"),
    );

    const task: AikTask = {
      id: uuidv4(),
      phaseId,
      systemId,
      title: input.title,
      description: input.description,
      executorType: input.executorType ?? "human",
      agentBriefing: input.agentBriefing,
      agentSkill: input.agentSkill,
      priority: input.priority ?? "p2",
      columnId: input.columnId ?? "backlog",
      order: input.order ?? siblings.length,
      blockedByTaskId: input.blockedByTaskId,
      checklist: input.checklist,
      linkedConversationId: input.linkedConversationId,
      lastRunFilesChanged: input.lastRunFilesChanged,
      timeline: [],
      createdAt: now,
      updatedAt: now,
    };

    set((state) => {
      const nextTasksBySystemId = {
        ...state.tasksBySystemId,
        [systemId]: [...(state.tasksBySystemId[systemId] ?? []), task],
      };
      const nextState = { ...state, tasksBySystemId: nextTasksBySystemId };
      const { phasesBySystemId } = recalcPhaseColumnInState(
        nextState,
        systemId,
        phaseId,
      );
      return { tasksBySystemId: nextTasksBySystemId, phasesBySystemId };
    });

    return task;
  },

  updateTask: (taskId, patch) => {
    set((state) => {
      for (const [systemId, tasks] of Object.entries(state.tasksBySystemId)) {
        const existing = tasks.find((t) => t.id === taskId);
        if (!existing) continue;

        if (
          patch.blockedByTaskId &&
          wouldCreateCycle(tasks, taskId, patch.blockedByTaskId)
        ) {
          throw new Error(
            "aik-board-store: blockedByTaskId would create a dependency cycle",
          );
        }

        const nextTasks = tasks.map((t) =>
          t.id === taskId ? { ...t, ...patch, updatedAt: nowIso() } : t,
        );
        const nextTasksBySystemId = {
          ...state.tasksBySystemId,
          [systemId]: nextTasks,
        };
        const nextState = { ...state, tasksBySystemId: nextTasksBySystemId };
        const { phasesBySystemId } = recalcPhaseColumnInState(
          nextState,
          systemId,
          existing.phaseId,
        );
        return { tasksBySystemId: nextTasksBySystemId, phasesBySystemId };
      }
      return state;
    });
  },

  moveTask: (taskId, toColumnId, toOrder) => {
    set((state) => {
      for (const [systemId, tasks] of Object.entries(state.tasksBySystemId)) {
        const existing = tasks.find((t) => t.id === taskId);
        if (!existing) continue;

        const nextTasks = reindexTasksAfterMove(
          tasks,
          taskId,
          toColumnId,
          toOrder,
        ).map((t) => (t.id === taskId ? { ...t, updatedAt: nowIso() } : t));
        const nextTasksBySystemId = {
          ...state.tasksBySystemId,
          [systemId]: nextTasks,
        };
        const nextState = { ...state, tasksBySystemId: nextTasksBySystemId };
        const { phasesBySystemId } = recalcPhaseColumnInState(
          nextState,
          systemId,
          existing.phaseId,
        );
        return { tasksBySystemId: nextTasksBySystemId, phasesBySystemId };
      }
      return state;
    });
  },

  deleteTask: (taskId) => {
    set((state) => {
      for (const [systemId, tasks] of Object.entries(state.tasksBySystemId)) {
        const existing = tasks.find((t) => t.id === taskId);
        if (!existing) continue;

        const nextTasks = tasks.filter((t) => t.id !== taskId);
        const nextTasksBySystemId = {
          ...state.tasksBySystemId,
          [systemId]: nextTasks,
        };
        const nextState = { ...state, tasksBySystemId: nextTasksBySystemId };
        const { phasesBySystemId } = recalcPhaseColumnInState(
          nextState,
          systemId,
          existing.phaseId,
        );
        return { tasksBySystemId: nextTasksBySystemId, phasesBySystemId };
      }
      return state;
    });
  },

  startAgent: async (taskId) => {
    const state = get();
    let found: { systemId: string; task: AikTask } | null = null;
    for (const [systemId, tasks] of Object.entries(state.tasksBySystemId)) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        found = { systemId, task };
        break;
      }
    }
    if (!found) return { ok: false, error: "task_not_found" };

    const { systemId, task } = found;
    const system = state.systems.find((s) => s.id === systemId);
    if (!system) return { ok: false, error: "system_not_found" };

    // Local-only failure, no round-trip (CA-11): another task in the same
    // system already has a live run.
    if (system.activeAgentTaskId && system.activeAgentTaskId !== taskId) {
      return { ok: false, error: "already_running" };
    }

    const phase = (state.phasesBySystemId[systemId] ?? []).find(
      (p) => p.id === task.phaseId,
    );
    if (!phase) return { ok: false, error: "phase_not_found" };

    const result = await startAikAgentTask(system, phase, task);
    if (!result.ok) return result;

    set((s) => {
      const tasks = s.tasksBySystemId[systemId] ?? [];
      const nextTasks = tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              linkedConversationId: result.conversationId,
              columnId: "in_progress" as AikColumnId,
              updatedAt: nowIso(),
              timeline: [
                ...t.timeline,
                makeTimelineEntry({ kind: "run_started" }),
              ],
            }
          : t,
      );
      const nextTasksBySystemId = {
        ...s.tasksBySystemId,
        [systemId]: nextTasks,
      };
      const nextState = { ...s, tasksBySystemId: nextTasksBySystemId };
      const { phasesBySystemId } = recalcPhaseColumnInState(
        nextState,
        systemId,
        task.phaseId,
      );
      return {
        tasksBySystemId: nextTasksBySystemId,
        phasesBySystemId,
        systems: s.systems.map((sys) =>
          sys.id === systemId
            ? { ...sys, activeAgentTaskId: taskId, updatedAt: nowIso() }
            : sys,
        ),
      };
    });

    return result;
  },

  stopAgent: async (taskId) => {
    const state = get();
    let found: { systemId: string; task: AikTask } | null = null;
    for (const [systemId, tasks] of Object.entries(state.tasksBySystemId)) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        found = { systemId, task };
        break;
      }
    }
    if (!found) return;
    const { systemId, task } = found;

    if (task.linkedConversationId) {
      try {
        await pauseConversation(task.linkedConversationId);
      } catch {
        // Best-effort abort — the task still returns to backlog below even
        // if the runtime call itself fails (matches "never throws" pattern
        // used across this store's async actions).
      }
    }

    set((s) => {
      const tasks = s.tasksBySystemId[systemId] ?? [];
      const withEntry = tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              timeline: [
                ...t.timeline,
                makeTimelineEntry({ kind: "run_stopped" }),
              ],
            }
          : t,
      );
      const nextTasks = reindexTasksAfterMove(
        withEntry,
        taskId,
        "backlog",
        -1,
      ).map((t) => (t.id === taskId ? { ...t, updatedAt: nowIso() } : t));
      const nextTasksBySystemId = {
        ...s.tasksBySystemId,
        [systemId]: nextTasks,
      };
      const nextState = { ...s, tasksBySystemId: nextTasksBySystemId };
      const { phasesBySystemId } = recalcPhaseColumnInState(
        nextState,
        systemId,
        task.phaseId,
      );
      return {
        tasksBySystemId: nextTasksBySystemId,
        phasesBySystemId,
        systems: s.systems.map((sys) =>
          sys.id === systemId && sys.activeAgentTaskId === taskId
            ? { ...sys, activeAgentTaskId: null, updatedAt: nowIso() }
            : sys,
        ),
      };
    });
  },

  approveTask: (taskId) => {
    set((state) => {
      for (const [systemId, tasks] of Object.entries(state.tasksBySystemId)) {
        const existing = tasks.find((t) => t.id === taskId);
        if (!existing) continue;
        if (existing.columnId !== "in_review") return state;

        const nextTasks = tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                columnId: "done" as AikColumnId,
                updatedAt: nowIso(),
                timeline: [
                  ...t.timeline,
                  makeTimelineEntry({
                    kind: "status_change",
                    fromColumnId: "in_review",
                    toColumnId: "done",
                  }),
                ],
              }
            : t,
        );
        const nextTasksBySystemId = {
          ...state.tasksBySystemId,
          [systemId]: nextTasks,
        };
        const nextState = { ...state, tasksBySystemId: nextTasksBySystemId };
        const { phasesBySystemId } = recalcPhaseColumnInState(
          nextState,
          systemId,
          existing.phaseId,
        );
        return { tasksBySystemId: nextTasksBySystemId, phasesBySystemId };
      }
      return state;
    });
  },

  returnTask: (taskId, feedback) => {
    let linkedConversationId: string | undefined;
    set((state) => {
      for (const [systemId, tasks] of Object.entries(state.tasksBySystemId)) {
        const existing = tasks.find((t) => t.id === taskId);
        if (!existing) continue;
        if (existing.columnId !== "in_review") return state;

        linkedConversationId = existing.linkedConversationId;

        const nextTasks = tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                columnId: "in_progress" as AikColumnId,
                updatedAt: nowIso(),
                timeline: [
                  ...t.timeline,
                  makeTimelineEntry({
                    kind: "review_feedback",
                    text: feedback,
                  }),
                ],
              }
            : t,
        );
        const nextTasksBySystemId = {
          ...state.tasksBySystemId,
          [systemId]: nextTasks,
        };
        const nextState = { ...state, tasksBySystemId: nextTasksBySystemId };
        const { phasesBySystemId } = recalcPhaseColumnInState(
          nextState,
          systemId,
          existing.phaseId,
        );
        return { tasksBySystemId: nextTasksBySystemId, phasesBySystemId };
      }
      return state;
    });

    // Delivered on the SAME linked conversation (RF-20) — never a new one.
    if (linkedConversationId) {
      AgentServerConversationService.sendMessage(linkedConversationId, {
        role: "user",
        content: [{ type: "text", text: feedback }],
      }).catch(() => {
        // Best-effort delivery — the task's timeline/columnId change above
        // already happened and is not rolled back on delivery failure.
      });
    }
  },

  addComment: (taskId, text) => {
    set((state) => {
      for (const [systemId, tasks] of Object.entries(state.tasksBySystemId)) {
        const existing = tasks.find((t) => t.id === taskId);
        if (!existing) continue;
        const nextTasks = tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                updatedAt: nowIso(),
                timeline: [
                  ...t.timeline,
                  makeTimelineEntry({ kind: "comment", text }),
                ],
              }
            : t,
        );
        return {
          tasksBySystemId: { ...state.tasksBySystemId, [systemId]: nextTasks },
        };
      }
      return state;
    });
  },

  syncFromFile: async (systemId) => {
    const system = get().systems.find((s) => s.id === systemId);
    if (!system) return;

    // No-op silencioso para sistemas cloud (estado normal, não erro).
    if (system.workspaceRef.kind === "cloud") return;

    const result = await readAikSystemFile(system.workspaceRef.path);
    if (!result.ok) {
      set((state) => ({
        errorBySystemId: {
          ...state.errorBySystemId,
          [systemId]: { errorType: result.errorType, detail: result.errorType },
        },
      }));
      return;
    }

    set((state) => {
      const localFile: AikSystemFile = {
        version: 1,
        systemId,
        phases: state.phasesBySystemId[systemId] ?? [],
        tasks: state.tasksBySystemId[systemId] ?? [],
        updatedAt: nowIso(),
      };
      const merged = mergeAikSystemFiles(localFile, result.file);
      const { [systemId]: _removedError, ...errorBySystemId } =
        state.errorBySystemId;
      return {
        phasesBySystemId: {
          ...state.phasesBySystemId,
          [systemId]: merged.phases,
        },
        tasksBySystemId: { ...state.tasksBySystemId, [systemId]: merged.tasks },
        errorBySystemId,
      };
    });
  },

  startPolling: (systemId) => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void get().syncFromFile(systemId);
    };
    const intervalId = setInterval(tick, AIK_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  },
}));

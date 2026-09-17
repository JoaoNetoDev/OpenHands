import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  subscribeWithSelector,
} from "zustand/middleware";
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
  mergeAikSystemFiles,
  readAikSystemFile,
  writeAikSystemFile,
} from "#/api/aik-board-file.api";
import { startAikAgentTask } from "#/api/aik-pipeline.api";
import { pauseConversation } from "#/hooks/mutation/conversation-mutation-utils";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";

/** Polling interval for `startPolling` (TECH §2.3): covers RF-27's 5s
 * budget (M6) with margin. */
const AIK_POLL_INTERVAL_MS = 4000;

/** localStorage key for the AIK board store. Bumping the version in the
 * `persist` config below forces a migration on next load; keep this name
 * stable across versions so an upgrade doesn't strand a user's persisted
 * systems in an orphaned key. */
const AIK_PERSIST_KEY = "openhands:aik-board-store";
const AIK_PERSIST_VERSION = 1;

/** Debounce window for disk writes (RF-26 / CA-24 — SPEC: ".openhands/aik/
 * system.json dentro do workspace"). Coalesces a burst of mutations from a
 * single drag operation or rapid paste into one read-modify-write round trip. */
const AIK_DISK_WRITE_DEBOUNCE_MS = 500;

/** Module-level cache of the last JSON-serialized `AikSystemFile` per system,
 * used by the disk-write subscriber to skip no-op writes — without this,
 * every `syncFromFile` round trip (polling tick or hydration) would write
 * back the merged state even when disk and store agreed. Cleared on delete
 * to avoid leaking memory when systems are removed. Lives outside the store
 * because Zustand `persist` would otherwise try to serialize it. */
const lastWrittenBySystem = new Map<string, string>();

/** Set of `system.id`s that have a pending or in-flight disk write —
 * `syncFromFile` consults this to avoid pulling a stale `system.json` from
 * disk and re-applying its contents while the user's local mutation is
 * still waiting to be flushed. Without this gate, a `deletePhase` could
 * silently un-do itself: the polling tick would fire inside the 500 ms
 * debounce window, read the pre-delete `system.json`, see a phase that the
 * local state had just removed, and the merge would re-add it. The 500 ms
 * timer would then dutifully write the resurrected phase back to disk.
 * Lives outside the store because Zustand `persist` would otherwise try to
 * serialize it. */
const pendingSystemWrites = new Set<string>();

/** IDs of phases/tasks the local user has deleted (or moved-out-of) since the
 * last successful disk write, keyed by `system.id`. The disk-write path
 * passes these to `writeAikSystemFile` so its read-modify-write merge drops
 * the tombstoned IDs from the on-disk file — without this, a deletion looks
 * like "the phase is absent from local" to the merge, and the on-disk copy
 * (which still has it, because our write hasn't landed yet) silently wins
 * and re-adds the phase. Cleared after each successful write per system.
 *
 * Lives outside the store because Zustand `persist` would otherwise try to
 * serialize it, and because tombstones are an implementation detail of the
 * disk-write protocol — they shouldn't survive a page reload (a fresh load
 * rehydrates from disk, which is already correct). */
interface AikTombstones {
  phases: Set<string>;
  tasks: Set<string>;
}
const pendingTombstonesBySystem = new Map<string, AikTombstones>();

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
  setSystemMainConversationId(systemId: string, conversationId: string): void;

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

export const useAikBoardStore = create<AikBoardStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
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
          lastWrittenBySystem.delete(systemId);
          pendingTombstonesBySystem.delete(systemId);
          pendingSystemWrites.delete(systemId);
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
            // Capture the IDs we're about to drop so the disk-write merge
            // can tombstone them — see `pendingTombstonesBySystem` for the
            // full explanation. We do this in the same set callback that
            // performs the deletion so the IDs are guaranteed to exist in
            // state at this point.
            const tombstonedTaskIds = (state.tasksBySystemId[systemId] ?? [])
              .filter((t) => t.phaseId === phaseId)
              .map((t) => t.id);
            const tombstone = pendingTombstonesBySystem.get(systemId) ?? {
              phases: new Set<string>(),
              tasks: new Set<string>(),
            };
            tombstone.phases.add(phaseId);
            for (const taskId of tombstonedTaskIds) tombstone.tasks.add(taskId);
            pendingTombstonesBySystem.set(systemId, tombstone);
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
              t.phaseId === phaseId &&
              t.columnId === (input.columnId ?? "backlog"),
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
            const nextState = {
              ...state,
              tasksBySystemId: nextTasksBySystemId,
            };
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
            for (const [systemId, tasks] of Object.entries(
              state.tasksBySystemId,
            )) {
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
              const nextState = {
                ...state,
                tasksBySystemId: nextTasksBySystemId,
              };
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
            for (const [systemId, tasks] of Object.entries(
              state.tasksBySystemId,
            )) {
              const existing = tasks.find((t) => t.id === taskId);
              if (!existing) continue;

              const nextTasks = reindexTasksAfterMove(
                tasks,
                taskId,
                toColumnId,
                toOrder,
              ).map((t) =>
                t.id === taskId ? { ...t, updatedAt: nowIso() } : t,
              );
              const nextTasksBySystemId = {
                ...state.tasksBySystemId,
                [systemId]: nextTasks,
              };
              const nextState = {
                ...state,
                tasksBySystemId: nextTasksBySystemId,
              };
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
            for (const [systemId, tasks] of Object.entries(
              state.tasksBySystemId,
            )) {
              const existing = tasks.find((t) => t.id === taskId);
              if (!existing) continue;

              // Tombstone this task ID so the disk-write merge drops it
              // from the on-disk file even when the merge's "preserve
              // disk-only items" rule would otherwise re-add it.
              const tombstone = pendingTombstonesBySystem.get(systemId) ?? {
                phases: new Set<string>(),
                tasks: new Set<string>(),
              };
              tombstone.tasks.add(taskId);
              pendingTombstonesBySystem.set(systemId, tombstone);

              const nextTasks = tasks.filter((t) => t.id !== taskId);
              const nextTasksBySystemId = {
                ...state.tasksBySystemId,
                [systemId]: nextTasks,
              };
              const nextState = {
                ...state,
                tasksBySystemId: nextTasksBySystemId,
              };
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
          for (const [systemId, tasks] of Object.entries(
            state.tasksBySystemId,
          )) {
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
          for (const [systemId, tasks] of Object.entries(
            state.tasksBySystemId,
          )) {
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
            for (const [systemId, tasks] of Object.entries(
              state.tasksBySystemId,
            )) {
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
              const nextState = {
                ...state,
                tasksBySystemId: nextTasksBySystemId,
              };
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
            for (const [systemId, tasks] of Object.entries(
              state.tasksBySystemId,
            )) {
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
              const nextState = {
                ...state,
                tasksBySystemId: nextTasksBySystemId,
              };
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
            for (const [systemId, tasks] of Object.entries(
              state.tasksBySystemId,
            )) {
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
                tasksBySystemId: {
                  ...state.tasksBySystemId,
                  [systemId]: nextTasks,
                },
              };
            }
            return state;
          });
        },

        setSystemMainConversationId: (systemId, conversationId) => {
          set((state) => ({
            systems: state.systems.map((s) =>
              s.id === systemId
                ? {
                    ...s,
                    mainConversationId: conversationId,
                    updatedAt: nowIso(),
                  }
                : s,
            ),
          }));
        },

        syncFromFile: async (systemId) => {
          const system = get().systems.find((s) => s.id === systemId);
          if (!system) return;

          // No-op silencioso para sistemas cloud (estado normal, não erro).
          if (system.workspaceRef.kind === "cloud") return;

          // Race-guard: while a disk write is pending for this system, the
          // on-disk `system.json` is guaranteed to be older than our local
          // state — reading it would re-merge stale data and undo any
          // mutation the user just performed (the most painful case is a
          // `deletePhase` whose 500 ms debounce window happens to overlap
          // with the 4 s polling tick: the disk still has the deleted
          // phase, the merge sees a phase local doesn't, and the merge
          // resurrects it). The disk-write subscriber (`flushSystemsToDisk`)
          // clears this flag when the write resolves — that's when it
          // becomes safe to consult the disk again.
          if (pendingSystemWrites.has(systemId)) return;

          const result = await readAikSystemFile(system.workspaceRef.path);
          if (!result.ok) {
            set((state) => ({
              errorBySystemId: {
                ...state.errorBySystemId,
                [systemId]: {
                  errorType: result.errorType,
                  detail: result.errorType,
                },
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
              tasksBySystemId: {
                ...state.tasksBySystemId,
                [systemId]: merged.tasks,
              },
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
      }),
      {
        name: AIK_PERSIST_KEY,
        version: AIK_PERSIST_VERSION,
        storage: createJSONStorage(() => localStorage),
        // Persist only the data slices. `errorBySystemId` is transient
        // (regenerated by `syncFromFile` on the first disk round trip after
        // hydration), and action functions are non-serializable by design.
        partialize: (state) => ({
          systems: state.systems,
          phasesBySystemId: state.phasesBySystemId,
          tasksBySystemId: state.tasksBySystemId,
        }),
        // After localStorage rehydrates the store (i.e. the user reloaded the
        // page or returned to the tab and the in-memory state was lost), pull
        // the latest from each persisted system's `system.json` so the agent's
        // changes since the last visit show up without a manual refresh. The
        // merge is per-item (most-recent-updatedAt-wins), so concurrent writes
        // from us and the agent don't clobber each other. Cloud systems are
        // skipped — there's no `system.json` to read (SPEC §2.4).
        //
        // The callback runs synchronously during `create(...)`, BEFORE the
        // `useAikBoardStore` `const` binding has been assigned — accessing
        // the export here would hit a temporal-dead-zone `ReferenceError`.
        // We defer the actual `syncFromFile` calls to a microtask so they
        // happen after the module's top-level assignment completes.
        onRehydrateStorage: () => (state, error) => {
          if (error || !state) return;
          const localSystemIds = state.systems
            .filter((s) => s.workspaceRef.kind === "local")
            .map((s) => s.id);
          // The hydration itself updates the store (replaces systems /
          // phasesBySystemId / tasksBySystemId) and that triggers the
          // disk-write subscriber, which adds every local system to
          // `pendingSystemWrites`. By the time the microtask below runs
          // (after rehydrate resolves) those flags are set — and they
          // would block `syncFromFile` from reading disk, defeating the
          // whole point of this callback. Clear the flags BEFORE the
          // syncFromFile loop so the post-rehydrate pulls aren't no-ops.
          queueMicrotask(() => {
            pendingSystemWrites.clear();
            const store = useAikBoardStore.getState();
            for (const systemId of localSystemIds) {
              // Fire-and-forget: never block hydration on a slow `cat`.
              void store.syncFromFile(systemId);
            }
          });
        },
      },
    ),
  ),
);

/**
 * Writes the current `AikSystemFile` for every local system to its workspace
 * on disk, debounced via `AIK_DISK_WRITE_DEBOUNCE_MS`. Runs after every
 * mutation (drag, rename, create, delete, status change, agent-write merge)
 * so `system.json` always tracks the in-memory state — this is what makes
 * the board survive a browser cache clear AND what makes the file the
 * canonical source for the agent to read on conversation start (CA-24).
 *
 * No-op writes (the merged result equals what we wrote last) are skipped
 * via the `lastWrittenBySystem` cache, so a polling tick that finds disk
 * and store already in sync doesn't do a redundant read-modify-write.
 */
let diskWriteTimer: ReturnType<typeof setTimeout> | null = null;

async function flushSystemsToDisk(): Promise<void> {
  const state = useAikBoardStore.getState();
  await Promise.all(
    state.systems.map(async (system) => {
      if (system.workspaceRef.kind !== "local") return;
      const phases = state.phasesBySystemId[system.id] ?? [];
      const tasks = state.tasksBySystemId[system.id] ?? [];
      const updatedAt = new Date().toISOString();
      const file: AikSystemFile = {
        version: 1,
        systemId: system.id,
        phases,
        tasks,
        updatedAt,
      };
      // Cache key MUST exclude `updatedAt` — it's re-stamped on every flush
      // so the same logical state would serialize to different strings and
      // defeat the skip. We only care about whether phases/tasks changed.
      const cacheKey = JSON.stringify({
        version: 1,
        systemId: system.id,
        phases,
        tasks,
      });
      if (lastWrittenBySystem.get(system.id) === cacheKey) {
        // Disk and store already agree — the pending flag was set by a no-op
        // mutation (e.g. an `errorBySystemId` change). Clear it so polling
        // can resume; nothing was written, but the local state IS still
        // authoritative until the next user mutation.
        pendingSystemWrites.delete(system.id);
        // The disk state already matches the local state, so any tombstones
        // for this system must already have been honored by the previous
        // write that produced this cache key. Drop them.
        pendingTombstonesBySystem.delete(system.id);
        return;
      }
      // Snapshot the tombstone set BEFORE the await so a concurrent
      // `deletePhase`/`deleteTask` happening during the write round-trip
      // doesn't lose its tombstone (those new IDs go into a fresh map).
      const tombstones = pendingTombstonesBySystem.get(system.id);
      const result = await writeAikSystemFile(
        system.workspaceRef.path,
        file,
        tombstones,
      );
      // Clear the pending flag BEFORE recording success — `syncFromFile` may
      // fire on the next polling tick and needs to know the disk catchup
      // is done. If the write failed, the next successful mutation will
      // re-arm the flag anyway via the subscriber.
      pendingSystemWrites.delete(system.id);
      if (result.ok) {
        lastWrittenBySystem.set(system.id, cacheKey);
        // The write incorporated our snapshot of tombstones; any IDs added
        // to the tombstone set after this point will be re-merged on the
        // next write. We clear the entry entirely — but only if the set
        // hasn't been mutated in the meantime (the `.get` returns the
        // same reference iff nobody called `set`).
        if (pendingTombstonesBySystem.get(system.id) === tombstones) {
          pendingTombstonesBySystem.delete(system.id);
        }
      } else {
        // Write failed — keep the tombstones so the next attempt also drops
        // them. (We don't surface this as an error to the store here; the
        // store path below does.)
        useAikBoardStore.setState((prev) => ({
          errorBySystemId: {
            ...prev.errorBySystemId,
            [system.id]: {
              errorType: result.errorType,
              detail: result.errorType,
            },
          },
        }));
      }
    }),
  );
}

// Select on the three data slices we care about. `subscribeWithSelector`
// compares the previous and current selector output by reference; we
// intentionally use a fresh object on every set so the subscriber always
// fires and the debounce coalesces — the real "did anything change?" check
// happens inside `flushSystemsToDisk` via the `lastWrittenBySystem` cache.
useAikBoardStore.subscribe(
  (state) => ({
    systems: state.systems,
    phasesBySystemId: state.phasesBySystemId,
    tasksBySystemId: state.tasksBySystemId,
  }),
  () => {
    // Mark every local system as "write pending" — `syncFromFile` consults
    // this set to avoid pulling a stale `system.json` from disk while our
    // mutation is still in-flight. We mark ALL local systems (not just the
    // ones that changed) because the disk-write coalesces everything into
    // one round trip per local system anyway, and an over-cautious flag is
    // safer than an under-cautious one (the worst case is a 4 s polling
    // delay instead of a deleted-phase resurrection).
    for (const system of useAikBoardStore.getState().systems) {
      if (system.workspaceRef.kind === "local") {
        pendingSystemWrites.add(system.id);
      }
    }
    if (diskWriteTimer !== null) clearTimeout(diskWriteTimer);
    diskWriteTimer = setTimeout(() => {
      diskWriteTimer = null;
      void flushSystemsToDisk();
    }, AIK_DISK_WRITE_DEBOUNCE_MS);
  },
  { fireImmediately: false },
);

/** Test/dev escape hatch: drain any pending debounced disk write
 * synchronously. Production code never calls this — it's used by the store's
 * own tests to avoid waiting 500 ms per assertion. A no-op when no timer is
 * pending (e.g. the test already advanced fake timers past the 500 ms
 * window and the timer fired on its own), so callers can safely call this
 * after `vi.advanceTimersByTime` without doubling the writes. */
export async function __flushAikDiskWritesForTests(): Promise<void> {
  if (diskWriteTimer === null) return;
  clearTimeout(diskWriteTimer);
  diskWriteTimer = null;
  await flushSystemsToDisk();
}

/** Test/dev escape hatch: clear the module-level last-written cache, e.g.
 * after resetting localStorage between tests. Also clears the pending-write
 * set (per-system "disk write in flight" markers) so tests don't leak
 * `syncFromFile` skips between cases. */
export function __resetAikDiskWriteCacheForTests(): void {
  lastWrittenBySystem.clear();
  pendingSystemWrites.clear();
  pendingTombstonesBySystem.clear();
  if (diskWriteTimer !== null) {
    clearTimeout(diskWriteTimer);
    diskWriteTimer = null;
  }
}

/** Test/dev escape hatch: clear ONLY the pending-write set, leaving the
 * last-written cache and the debounce timer intact. Use this in tests that
 * just need `syncFromFile` to go through without disturbing the write
 * subscriber's bookkeeping — e.g. setup helpers that create a system and
 * then want to verify a subsequent `syncFromFile` reads disk immediately.
 * Production code never calls this. */
export function __clearPendingAikSystemWritesForTests(): void {
  pendingSystemWrites.clear();
}

/** Test/dev escape hatch: read the tombstones currently queued for a system,
 * so tests can assert that a deletion actually registered one. Production
 * code never calls this. */
export function __getPendingAikTombstonesForTests(
  systemId: string,
): { phases: string[]; tasks: string[] } | undefined {
  const tombstone = pendingTombstonesBySystem.get(systemId);
  if (!tombstone) return undefined;
  return {
    phases: Array.from(tombstone.phases),
    tasks: Array.from(tombstone.tasks),
  };
}

// Dev-only console/E2E handle (same pattern as `metrics-store.ts:34-40`):
// SPRINT-11's `aik-performance.spec.ts` needs to populate ~200 tasks
// directly against the store (SPEC §7 "popular 200 tarefas via
// aik-board-store diretamente, sem passar por 200 cliques de UI") — there
// is no other way to reach a Zustand store instance from a Playwright
// `page.evaluate`. Gated on `import.meta.env.DEV` so it never reaches a
// production build; `playwright.config.ts`'s `webServer` runs
// `npm run dev:mock`, which has `DEV` on.
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (
    window as unknown as { __OH_AIK_BOARD_STORE__?: typeof useAikBoardStore }
  ).__OH_AIK_BOARD_STORE__ = useAikBoardStore;
}

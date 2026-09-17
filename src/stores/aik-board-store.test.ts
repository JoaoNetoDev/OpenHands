import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AikWorkspaceRef } from "#/types/aik";

const startAikAgentTaskMock = vi.fn();
vi.mock("#/api/aik-pipeline.api", () => ({
  startAikAgentTask: (...args: unknown[]) => startAikAgentTaskMock(...args),
}));

type AikWriteResult =
  | { ok: true }
  | {
      ok: false;
      errorType:
        | "backend_down"
        | "workspace_unreachable"
        | "cloud_unsupported"
        | "conflict"
        | "parse_error";
    };

const readAikSystemFileMock = vi.fn();
const writeAikSystemFileMock = vi.fn(
  async (...args: unknown[]): Promise<AikWriteResult> => {
    void args;
    return Promise.resolve({ ok: true });
  },
);

/** Mirrors `mergeById` (`src/api/aik-board-file.api.ts:73-90`): fuse by `id`,
 * most recent `updatedAt` wins, disk-only items are kept UNLESS tombstoned.
 * Keeping this faithful matters — a naive concat would happily "resurrect"
 * a deleted phase in the tests below and mask the very bug they guard. */
function mergeByIdMock<T extends { id: string; updatedAt: string }>(
  disk: T[],
  incoming: T[],
  tombstones?: ReadonlySet<string>,
): T[] {
  const byId = new Map<string, T>();
  for (const item of disk) {
    if (tombstones?.has(item.id)) continue;
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing || new Date(item.updatedAt) >= new Date(existing.updatedAt)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

interface MergeTombstonesArg {
  phases?: ReadonlySet<string>;
  tasks?: ReadonlySet<string>;
}

vi.mock("#/api/aik-board-file.api", () => ({
  readAikSystemFile: (...args: unknown[]) => readAikSystemFileMock(...args),
  writeAikSystemFile: (...args: unknown[]) => writeAikSystemFileMock(...args),
  mergeAikSystemFiles: (
    local: { systemId: string; phases: unknown[]; tasks: unknown[] },
    remote: { systemId: string; phases: unknown[]; tasks: unknown[] },
    tombstones?: MergeTombstonesArg,
  ) => ({
    version: 1,
    systemId: remote.systemId || local.systemId,
    phases: mergeByIdMock(
      local.phases as { id: string; updatedAt: string }[],
      remote.phases as { id: string; updatedAt: string }[],
      tombstones?.phases,
    ),
    tasks: mergeByIdMock(
      local.tasks as { id: string; updatedAt: string }[],
      remote.tasks as { id: string; updatedAt: string }[],
      tombstones?.tasks,
    ),
    updatedAt: new Date().toISOString(),
  }),
}));

const pauseConversationMock = vi.fn();
vi.mock("#/hooks/mutation/conversation-mutation-utils", () => ({
  pauseConversation: (...args: unknown[]) => pauseConversationMock(...args),
}));

const sendMessageMock = vi.fn();
vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({
    default: {
      sendMessage: (...args: unknown[]) => sendMessageMock(...args),
    },
  }),
);

// Imported AFTER the mocks above so the store picks up the mocked modules.
const {
  useAikBoardStore,
  __flushAikDiskWritesForTests,
  __resetAikDiskWriteCacheForTests,
  __clearPendingAikSystemWritesForTests,
  __getPendingAikTombstonesForTests,
} = await import("#/stores/aik-board-store");

const LOCAL_WORKSPACE_REF: AikWorkspaceRef = {
  kind: "local",
  workspaceId: "ws-1",
  path: "/home/user/project",
};

const CLOUD_WORKSPACE_REF: AikWorkspaceRef = {
  kind: "cloud",
  repository: { provider: "github", fullName: "org/repo" },
};

function resetStore() {
  // Merge (not replace) — `useAikBoardStore`'s state object also holds the
  // action functions (zustand's plain `create`, no separate slice), so a
  // `replace: true` call here would wipe them out along with the data.
  useAikBoardStore.setState({
    systems: [],
    phasesBySystemId: {},
    tasksBySystemId: {},
    errorBySystemId: {},
  });
}

function setupSystemWithPhase(
  workspaceRef: AikWorkspaceRef = LOCAL_WORKSPACE_REF,
) {
  const { createSystem, createPhase } = useAikBoardStore.getState();
  const system = createSystem({
    name: "Sistema 1",
    backendId: "backend-1",
    workspaceRef,
  });
  const phase = createPhase(system.id, "Fase 1");
  // `createSystem` and `createPhase` schedule a debounced disk write, which
  // marks the system as "write pending" — the gate that protects
  // `syncFromFile` from re-reading stale disk while our mutation is in
  // flight. Most tests don't care, but the `syncFromFile` and rehydrate
  // tests call `syncFromFile` immediately after setup and need the flag
  // cleared so the read goes through. We use the surgical helper (set
  // only) instead of the full `__resetAikDiskWriteCacheForTests` so the
  // debounce timer set by `createSystem`/`createPhase` is preserved for
  // the persistence tests that depend on it firing 500 ms later.
  __clearPendingAikSystemWritesForTests();
  return { system, phase };
}

beforeEach(() => {
  resetStore();
  __resetAikDiskWriteCacheForTests();
  // Wipe the persisted slot so a previous test's systems don't bleed into
  // this one (zustand `persist` rehydrates synchronously on store creation,
  // so we need to clear it before any `createSystem` runs in the test body).
  localStorage.removeItem("openhands:aik-board-store");
  startAikAgentTaskMock.mockReset();
  readAikSystemFileMock.mockReset();
  writeAikSystemFileMock.mockReset();
  writeAikSystemFileMock.mockResolvedValue({ ok: true });
  pauseConversationMock.mockReset();
  sendMessageMock.mockReset();
  startAikAgentTaskMock.mockResolvedValue({
    ok: true,
    conversationId: "conv-1",
  });
  pauseConversationMock.mockResolvedValue({ success: true });
  sendMessageMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  // Drain any debounced write so the next test's `expect(writeAikSystemFileMock).toHaveBeenCalledTimes`
  // starts from a clean slate.
  await __flushAikDiskWritesForTests();
});

describe("RF-09 phase column aggregation (CA-07)", () => {
  it("(a) every task done -> phase done", () => {
    const { phase, system } = setupSystemWithPhase();
    const { createTask } = useAikBoardStore.getState();
    const t1 = createTask(phase.id, { title: "T1" });
    createTask(phase.id, { title: "T2" });
    useAikBoardStore.getState().updateTask(t1.id, { columnId: "done" });
    const tasks = useAikBoardStore.getState().tasksBySystemId[system.id];
    tasks.forEach((t) =>
      useAikBoardStore.getState().updateTask(t.id, { columnId: "done" }),
    );

    const resultPhase = useAikBoardStore
      .getState()
      .phasesBySystemId[system.id].find((p) => p.id === phase.id)!;
    expect(resultPhase.columnId).toBe("done");
  });

  it("(b) no tasks -> phase backlog", () => {
    const { phase, system } = setupSystemWithPhase();
    const resultPhase = useAikBoardStore
      .getState()
      .phasesBySystemId[system.id].find((p) => p.id === phase.id)!;
    expect(resultPhase.columnId).toBe("backlog");
  });

  it("(c) any task in_review -> phase in_review", () => {
    const { phase, system } = setupSystemWithPhase();
    const { createTask, updateTask } = useAikBoardStore.getState();
    const t1 = createTask(phase.id, { title: "T1", columnId: "done" });
    createTask(phase.id, { title: "T2", columnId: "in_review" });
    updateTask(t1.id, { columnId: "done" });

    const resultPhase = useAikBoardStore
      .getState()
      .phasesBySystemId[system.id].find((p) => p.id === phase.id)!;
    expect(resultPhase.columnId).toBe("in_review");
  });

  it("(d) any task in_progress (no in_review) -> phase in_progress", () => {
    const { phase, system } = setupSystemWithPhase();
    const { createTask } = useAikBoardStore.getState();
    createTask(phase.id, { title: "T1", columnId: "backlog" });
    createTask(phase.id, { title: "T2", columnId: "in_progress" });

    const resultPhase = useAikBoardStore
      .getState()
      .phasesBySystemId[system.id].find((p) => p.id === phase.id)!;
    expect(resultPhase.columnId).toBe("in_progress");
  });

  it("(e) mix of backlog/done, no in_progress/in_review -> phase backlog", () => {
    const { phase, system } = setupSystemWithPhase();
    const { createTask } = useAikBoardStore.getState();
    createTask(phase.id, { title: "T1", columnId: "backlog" });
    createTask(phase.id, { title: "T2", columnId: "done" });

    const resultPhase = useAikBoardStore
      .getState()
      .phasesBySystemId[system.id].find((p) => p.id === phase.id)!;
    expect(resultPhase.columnId).toBe("backlog");
  });

  it("recalculation is a synchronous side effect of moveTask, not a separate action", () => {
    const { phase, system } = setupSystemWithPhase();
    const task = useAikBoardStore
      .getState()
      .createTask(phase.id, { title: "T1", columnId: "backlog" });

    useAikBoardStore.getState().moveTask(task.id, "in_progress", 0);

    // No extra call needed — the phase must already reflect (d) right here.
    const resultPhase = useAikBoardStore
      .getState()
      .phasesBySystemId[system.id].find((p) => p.id === phase.id)!;
    expect(resultPhase.columnId).toBe("in_progress");
  });
});

describe("startAgent (CA-11, CA-21)", () => {
  it("fails locally with already_running, without calling startAikAgentTask, when another task owns activeAgentTaskId", async () => {
    const { phase, system } = setupSystemWithPhase();
    const { createTask, startAgent } = useAikBoardStore.getState();
    const taskA = createTask(phase.id, { title: "A" });
    const taskB = createTask(phase.id, { title: "B" });

    await startAgent(taskA.id);
    expect(startAikAgentTaskMock).toHaveBeenCalledTimes(1);

    startAikAgentTaskMock.mockClear();
    const result = await startAgent(taskB.id);

    expect(result).toEqual({ ok: false, error: "already_running" });
    expect(startAikAgentTaskMock).toHaveBeenCalledTimes(0);
    void system;
  });

  it("calls startAikAgentTask with the system/phase resolved from the task's own ids", async () => {
    const { phase, system } = setupSystemWithPhase();
    const otherSystem = useAikBoardStore.getState().createSystem({
      name: "Outro",
      backendId: "b2",
      workspaceRef: LOCAL_WORKSPACE_REF,
    });
    const { createTask, startAgent } = useAikBoardStore.getState();
    const task = createTask(phase.id, { title: "T1" });

    await startAgent(task.id);

    expect(startAikAgentTaskMock).toHaveBeenCalledTimes(1);
    const [calledSystem, calledPhase, calledTask] =
      startAikAgentTaskMock.mock.calls[0];
    expect(calledSystem.id).toBe(system.id);
    expect(calledSystem.id).not.toBe(otherSystem.id);
    expect(calledPhase.id).toBe(phase.id);
    expect(calledTask.id).toBe(task.id);
  });

  it("on success sets linkedConversationId, moves task to in_progress, sets activeAgentTaskId and appends run_started", async () => {
    const { phase, system } = setupSystemWithPhase();
    const task = useAikBoardStore
      .getState()
      .createTask(phase.id, { title: "T1" });

    await useAikBoardStore.getState().startAgent(task.id);

    const updatedTask = useAikBoardStore
      .getState()
      .tasksBySystemId[system.id].find((t) => t.id === task.id)!;
    const updatedSystem = useAikBoardStore
      .getState()
      .systems.find((s) => s.id === system.id)!;

    expect(updatedTask.linkedConversationId).toBe("conv-1");
    expect(updatedTask.columnId).toBe("in_progress");
    expect(updatedSystem.activeAgentTaskId).toBe(task.id);
    expect(updatedTask.timeline.at(-1)).toMatchObject({ kind: "run_started" });
  });
});

describe("stopAgent (CA-13)", () => {
  it("aborts the run and returns the task to the top of backlog, clearing activeAgentTaskId", async () => {
    const { phase, system } = setupSystemWithPhase();
    const { createTask, startAgent, stopAgent } = useAikBoardStore.getState();
    const other = createTask(phase.id, { title: "Other", columnId: "backlog" });
    const task = createTask(phase.id, { title: "T1" });

    await startAgent(task.id);
    await stopAgent(task.id);

    expect(pauseConversationMock).toHaveBeenCalledWith("conv-1");

    const tasks = useAikBoardStore.getState().tasksBySystemId[system.id];
    const updatedTask = tasks.find((t) => t.id === task.id)!;
    const updatedOther = tasks.find((t) => t.id === other.id)!;
    const updatedSystem = useAikBoardStore
      .getState()
      .systems.find((s) => s.id === system.id)!;

    expect(updatedTask.columnId).toBe("backlog");
    expect(updatedTask.order).toBe(0);
    expect(updatedOther.order).toBe(1);
    expect(updatedSystem.activeAgentTaskId).toBeNull();
    expect(updatedTask.timeline.at(-1)).toMatchObject({ kind: "run_stopped" });
  });
});

describe("approveTask / returnTask (CA-17, CA-18)", () => {
  it("approveTask is a no-op outside in_review", () => {
    const { phase, system } = setupSystemWithPhase();
    const task = useAikBoardStore
      .getState()
      .createTask(phase.id, { title: "T1", columnId: "backlog" });

    useAikBoardStore.getState().approveTask(task.id);

    const updated = useAikBoardStore
      .getState()
      .tasksBySystemId[system.id].find((t) => t.id === task.id)!;
    expect(updated.columnId).toBe("backlog");
  });

  it("approveTask moves in_review -> done with a status_change entry", () => {
    const { phase, system } = setupSystemWithPhase();
    const task = useAikBoardStore
      .getState()
      .createTask(phase.id, { title: "T1", columnId: "in_review" });

    useAikBoardStore.getState().approveTask(task.id);

    const updated = useAikBoardStore
      .getState()
      .tasksBySystemId[system.id].find((t) => t.id === task.id)!;
    expect(updated.columnId).toBe("done");
    expect(updated.timeline.at(-1)).toMatchObject({
      kind: "status_change",
      fromColumnId: "in_review",
      toColumnId: "done",
    });
  });

  it("returnTask is a no-op outside in_review", () => {
    const { phase, system } = setupSystemWithPhase();
    const task = useAikBoardStore
      .getState()
      .createTask(phase.id, { title: "T1", columnId: "backlog" });

    useAikBoardStore.getState().returnTask(task.id, "feedback");

    const updated = useAikBoardStore
      .getState()
      .tasksBySystemId[system.id].find((t) => t.id === task.id)!;
    expect(updated.columnId).toBe("backlog");
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("returnTask moves in_review -> in_progress and delivers feedback on the SAME linked conversation", () => {
    const { phase, system } = setupSystemWithPhase();
    const task = useAikBoardStore.getState().createTask(phase.id, {
      title: "T1",
      columnId: "in_review",
      linkedConversationId: "conv-existing",
    });

    useAikBoardStore.getState().returnTask(task.id, "faltou X");

    const updated = useAikBoardStore
      .getState()
      .tasksBySystemId[system.id].find((t) => t.id === task.id)!;
    expect(updated.columnId).toBe("in_progress");
    expect(updated.timeline.at(-1)).toMatchObject({
      kind: "review_feedback",
      text: "faltou X",
    });
    expect(sendMessageMock).toHaveBeenCalledWith(
      "conv-existing",
      expect.objectContaining({
        role: "user",
        content: [{ type: "text", text: "faltou X" }],
      }),
    );
  });
});

describe("blockedByTaskId cycle rejection (CA-27)", () => {
  it("updateTask rejects a blockedByTaskId that would close a cycle", () => {
    const { phase } = setupSystemWithPhase();
    const { createTask, updateTask } = useAikBoardStore.getState();
    const t1 = createTask(phase.id, { title: "T1" });
    const t2 = createTask(phase.id, { title: "T2", blockedByTaskId: t1.id });

    // t1 -> blockedBy t2 would close the cycle t1 -> t2 -> t1.
    expect(() => updateTask(t1.id, { blockedByTaskId: t2.id })).toThrow();
  });

  it("updateTask rejects self-reference", () => {
    const { phase } = setupSystemWithPhase();
    const t1 = useAikBoardStore
      .getState()
      .createTask(phase.id, { title: "T1" });
    expect(() =>
      useAikBoardStore.getState().updateTask(t1.id, { blockedByTaskId: t1.id }),
    ).toThrow();
  });

  it("updateTask allows a valid, non-circular blockedByTaskId", () => {
    const { phase, system } = setupSystemWithPhase();
    const { createTask, updateTask } = useAikBoardStore.getState();
    const t1 = createTask(phase.id, { title: "T1" });
    const t2 = createTask(phase.id, { title: "T2" });

    updateTask(t2.id, { blockedByTaskId: t1.id });

    const updated = useAikBoardStore
      .getState()
      .tasksBySystemId[system.id].find((t) => t.id === t2.id)!;
    expect(updated.blockedByTaskId).toBe(t1.id);
  });
});

describe("syncFromFile (CA-25, CA-38, CA-39)", () => {
  it("is a silent no-op for cloud systems (never calls readAikSystemFile)", async () => {
    const { system } = setupSystemWithPhase(CLOUD_WORKSPACE_REF);
    await useAikBoardStore.getState().syncFromFile(system.id);
    expect(readAikSystemFileMock).not.toHaveBeenCalled();
    expect(
      useAikBoardStore.getState().errorBySystemId[system.id],
    ).toBeUndefined();
  });

  it("merges disk data into the store for local systems", async () => {
    const { system, phase } = setupSystemWithPhase();
    readAikSystemFileMock.mockResolvedValue({
      ok: true,
      file: {
        version: 1,
        systemId: system.id,
        phases: [],
        tasks: [
          {
            id: "agent-task",
            phaseId: phase.id,
            systemId: system.id,
            title: "From agent",
            executorType: "agent",
            priority: "p1",
            columnId: "in_review",
            order: 0,
            timeline: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    });

    await useAikBoardStore.getState().syncFromFile(system.id);

    const tasks = useAikBoardStore.getState().tasksBySystemId[system.id];
    expect(tasks.some((t) => t.id === "agent-task")).toBe(true);
  });

  it("backend_down and workspace_unreachable populate distinct error messages, without throwing", async () => {
    const { system: systemDown } = setupSystemWithPhase();
    readAikSystemFileMock.mockResolvedValueOnce({
      ok: false,
      errorType: "backend_down",
    });
    await expect(
      useAikBoardStore.getState().syncFromFile(systemDown.id),
    ).resolves.toBeUndefined();
    expect(
      useAikBoardStore.getState().errorBySystemId[systemDown.id],
    ).toMatchObject({
      errorType: "backend_down",
    });

    const system2 = useAikBoardStore.getState().createSystem({
      name: "Sistema 2",
      backendId: "backend-2",
      workspaceRef: LOCAL_WORKSPACE_REF,
    });
    // `createSystem` schedules a debounced write which marks system2 as
    // pending — clear that so the `syncFromFile` call below can actually
    // hit the disk.
    __clearPendingAikSystemWritesForTests();
    readAikSystemFileMock.mockResolvedValueOnce({
      ok: false,
      errorType: "workspace_unreachable",
    });
    await useAikBoardStore.getState().syncFromFile(system2.id);
    expect(
      useAikBoardStore.getState().errorBySystemId[system2.id],
    ).toMatchObject({
      errorType: "workspace_unreachable",
    });

    expect(
      useAikBoardStore.getState().errorBySystemId[systemDown.id]!.errorType,
    ).not.toBe(
      useAikBoardStore.getState().errorBySystemId[system2.id]!.errorType,
    );
  });

  it("malformed system.json isolates only that system in an error state (CA-39)", async () => {
    const { system: brokenSystem } = setupSystemWithPhase();
    const okSystem = useAikBoardStore.getState().createSystem({
      name: "Sistema OK",
      backendId: "backend-ok",
      workspaceRef: LOCAL_WORKSPACE_REF,
    });
    // Both systems were just created via `createSystem`, which marked them
    // as write-pending — clear so the `syncFromFile` calls below hit disk.
    __clearPendingAikSystemWritesForTests();

    readAikSystemFileMock.mockImplementation(async (path: string) => {
      if (path === LOCAL_WORKSPACE_REF.path) {
        return { ok: false, errorType: "parse_error" };
      }
      return {
        ok: true,
        file: {
          version: 1,
          systemId: okSystem.id,
          phases: [],
          tasks: [],
          updatedAt: new Date().toISOString(),
        },
      };
    });

    await useAikBoardStore.getState().syncFromFile(brokenSystem.id);

    expect(
      useAikBoardStore.getState().errorBySystemId[brokenSystem.id],
    ).toMatchObject({
      errorType: "parse_error",
    });
    expect(
      useAikBoardStore.getState().errorBySystemId[okSystem.id],
    ).toBeUndefined();
    expect(useAikBoardStore.getState().systems).toHaveLength(2);
  });
});

describe("startPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("polls syncFromFile every 4s while the tab is visible, and stop() cancels it", async () => {
    const { system } = setupSystemWithPhase();
    readAikSystemFileMock.mockResolvedValue({
      ok: true,
      file: {
        version: 1,
        systemId: system.id,
        phases: [],
        tasks: [],
        updatedAt: new Date().toISOString(),
      },
    });
    vi.stubGlobal("document", { visibilityState: "visible" });

    const stop = useAikBoardStore.getState().startPolling(system.id);

    await vi.advanceTimersByTimeAsync(4000);
    expect(readAikSystemFileMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(readAikSystemFileMock).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(8000);
    expect(readAikSystemFileMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("pauses while document.visibilityState is not visible", async () => {
    const { system } = setupSystemWithPhase();
    readAikSystemFileMock.mockResolvedValue({
      ok: true,
      file: {
        version: 1,
        systemId: system.id,
        phases: [],
        tasks: [],
        updatedAt: new Date().toISOString(),
      },
    });
    vi.stubGlobal("document", { visibilityState: "hidden" });

    const stop = useAikBoardStore.getState().startPolling(system.id);

    await vi.advanceTimersByTimeAsync(12000);
    expect(readAikSystemFileMock).not.toHaveBeenCalled();

    stop();
    vi.unstubAllGlobals();
  });
});

describe("persistence (RF-26 / CA-24)", () => {
  it("createSystem for a local workspace schedules a debounced writeAikSystemFile with the current file", async () => {
    vi.useFakeTimers();
    const { system } = setupSystemWithPhase(LOCAL_WORKSPACE_REF);

    // Not yet — debounce window is 500 ms.
    expect(writeAikSystemFileMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(writeAikSystemFileMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await __flushAikDiskWritesForTests();

    expect(writeAikSystemFileMock).toHaveBeenCalledTimes(1);
    const [path, file] = writeAikSystemFileMock.mock.calls[0] as [
      string,
      {
        version: number;
        systemId: string;
        phases: unknown[];
        tasks: unknown[];
      },
    ];
    expect(path).toBe(LOCAL_WORKSPACE_REF.path);
    expect(file.systemId).toBe(system.id);
    expect(file.version).toBe(1);
    expect(file.phases).toHaveLength(1);
    expect(file.tasks).toEqual([]);
  });

  it("does NOT schedule a disk write for cloud systems (SPEC §2.4)", async () => {
    vi.useFakeTimers();
    setupSystemWithPhase(CLOUD_WORKSPACE_REF);
    vi.advanceTimersByTime(1000);
    await __flushAikDiskWritesForTests();
    expect(writeAikSystemFileMock).not.toHaveBeenCalled();
  });

  it("coalesces a burst of mutations into one write (500 ms debounce window)", async () => {
    vi.useFakeTimers();
    const { system, phase } = setupSystemWithPhase(LOCAL_WORKSPACE_REF);
    const { createTask, updateTask, moveTask } = useAikBoardStore.getState();
    const task = createTask(phase.id, { title: "T1" });
    updateTask(task.id, { title: "T1 renamed" });
    moveTask(task.id, "in_progress", 0);

    // Still inside the debounce window — single coalesced write.
    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();
    expect(writeAikSystemFileMock).toHaveBeenCalledTimes(1);

    // Subsequent identical state (no new mutation) shouldn't trigger another write.
    // Touch a non-serialized slice to force a `set` without changing the
    // file content, then re-flush — the lastWritten cache should skip it.
    useAikBoardStore.setState((prev) => ({
      errorBySystemId: { ...prev.errorBySystemId },
    }));
    vi.advanceTimersByTime(1000);
    await __flushAikDiskWritesForTests();
    expect(writeAikSystemFileMock).toHaveBeenCalledTimes(1);

    // A real mutation produces another coalesced write.
    updateTask(task.id, { title: "T1 renamed again" });
    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();
    expect(writeAikSystemFileMock).toHaveBeenCalledTimes(2);

    // Sanity: the file content reflects the latest title.
    const [, lastFile] = writeAikSystemFileMock.mock.calls[1] as [
      string,
      {
        version: number;
        systemId: string;
        tasks: { title: string }[];
        phases: unknown[];
      },
    ];
    expect(lastFile.tasks[0].title).toBe("T1 renamed again");
    expect(lastFile.systemId).toBe(system.id);
  });

  it("deleteSystem clears the per-system last-written cache so no orphan write happens", async () => {
    vi.useFakeTimers();
    const { system } = setupSystemWithPhase(LOCAL_WORKSPACE_REF);
    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();
    expect(writeAikSystemFileMock).toHaveBeenCalledTimes(1);

    useAikBoardStore.getState().deleteSystem(system.id);

    // After delete, the system is gone from state.systems so the flush
    // iterator skips it — no extra write. The cache entry for the deleted
    // id is also gone (verified indirectly: a fresh createSystem with a
    // new UUID will not be blocked by a stale cache hit).
    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();
    expect(writeAikSystemFileMock).toHaveBeenCalledTimes(1);

    // A brand-new system with a fresh UUID writes again.
    const { createSystem } = useAikBoardStore.getState();
    createSystem({
      name: "Sistema novo",
      backendId: "backend-1",
      workspaceRef: LOCAL_WORKSPACE_REF,
    });
    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();
    expect(writeAikSystemFileMock).toHaveBeenCalledTimes(2);
  });

  it("writeAikSystemFile failure routes the error to errorBySystemId for the board to surface", async () => {
    vi.useFakeTimers();
    writeAikSystemFileMock.mockResolvedValueOnce({
      ok: false,
      errorType: "workspace_unreachable",
    });
    const { system } = setupSystemWithPhase(LOCAL_WORKSPACE_REF);
    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();

    expect(
      useAikBoardStore.getState().errorBySystemId[system.id]?.errorType,
    ).toBe("workspace_unreachable");
  });

  // Regression: without the `pendingSystemWrites` gate, the 4 s polling
  // tick could fire inside the 500 ms disk-write debounce window, read the
  // pre-delete `system.json`, and `mergeAikSystemFiles` would re-add the
  // deleted phase. The user would see the phase come back to life right
  // after they clicked delete.
  it("a deleted phase does NOT come back after the debounced write and a later polling tick", async () => {
    vi.useFakeTimers();
    const { system, phase } = setupSystemWithPhase(LOCAL_WORKSPACE_REF);

    // --- Simulated disk -----------------------------------------------------
    // `writeAikSystemFileMock` writes into this variable instead of a real
    // file, and `readAikSystemFileMock` reads from it. That lets the test
    // assert the real end-to-end outcome ("the phase is gone from disk and
    // stays gone") rather than an intermediate flag.
    let disk: {
      version: number;
      systemId: string;
      phases: { id: string; updatedAt: string }[];
      tasks: { id: string; updatedAt: string }[];
      updatedAt: string;
    } = {
      version: 1,
      systemId: system.id,
      phases: [{ ...phase }],
      tasks: [],
      updatedAt: "2026-09-16T17:20:39.009Z",
    };
    readAikSystemFileMock.mockImplementation(async () => ({
      ok: true,
      file: structuredClone(disk),
    }));
    writeAikSystemFileMock.mockImplementation(async (...args: unknown[]) => {
      // Mirror what the real `writeAikSystemFile` does: read-modify-write
      // against whatever is on disk, honoring the tombstones.
      const fileToWrite = args[1];
      const tombstones = args[2] as MergeTombstonesArg | undefined;
      const incoming = fileToWrite as typeof disk;
      disk = {
        ...incoming,
        phases: mergeByIdMock(disk.phases, incoming.phases, tombstones?.phases),
        tasks: mergeByIdMock(disk.tasks, incoming.tasks, tombstones?.tasks),
      };
      return { ok: true };
    });

    // Settle the initial `createSystem`/`createPhase` write so the disk
    // snapshot above is what "was on disk" before the user acts.
    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();
    expect(disk.phases.map((p) => p.id)).toEqual([phase.id]);

    // --- The user deletes the phase ----------------------------------------
    useAikBoardStore.getState().deletePhase(phase.id);
    expect(
      useAikBoardStore.getState().phasesBySystemId[system.id],
    ).toHaveLength(0);

    // --- A polling tick lands inside the 500 ms debounce window ------------
    // Without the pending-write gate this reads the pre-delete disk (still
    // holding `phase`), merges it back in, and the phase resurrects.
    await useAikBoardStore.getState().syncFromFile(system.id);
    expect(
      useAikBoardStore.getState().phasesBySystemId[system.id],
    ).toHaveLength(0);

    // --- The debounced write fires -----------------------------------------
    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();

    // The deletion must have reached the simulated disk. This is the
    // assertion that actually reproduces the reported bug: before tombstones,
    // the write's own read-modify-write put the phase right back.
    expect(disk.phases).toEqual([]);

    // --- And a later polling tick doesn't resurrect it either --------------
    // This is the ~2-3 s mark in the live report: the delete looked fine
    // until a subsequent poll re-merged the stale file.
    await useAikBoardStore.getState().syncFromFile(system.id);
    expect(
      useAikBoardStore.getState().phasesBySystemId[system.id],
    ).toHaveLength(0);

    // Three real round trips: the initial create write, the delete write (the
    // polling tick above was gated so it never read), and the final poll's
    // read.
    expect(readAikSystemFileMock).toHaveBeenCalledTimes(1);
  });

  it("deletePhase tombstones the phase and its descendant tasks", () => {
    const { system, phase } = setupSystemWithPhase(LOCAL_WORKSPACE_REF);
    const { createTask } = useAikBoardStore.getState();
    const task = createTask(phase.id, {
      title: "Tarefa filha",
      executorType: "human",
      priority: "p1",
    });

    useAikBoardStore.getState().deletePhase(phase.id);

    expect(__getPendingAikTombstonesForTests(system.id)).toEqual({
      phases: [phase.id],
      tasks: [task.id],
    });
  });

  it("deleteTask tombstones the task", () => {
    const { system, phase } = setupSystemWithPhase(LOCAL_WORKSPACE_REF);
    const { createTask } = useAikBoardStore.getState();
    const task = createTask(phase.id, {
      title: "Tarefa",
      executorType: "human",
      priority: "p1",
    });

    useAikBoardStore.getState().deleteTask(task.id);

    expect(__getPendingAikTombstonesForTests(system.id)?.tasks).toEqual([
      task.id,
    ]);
  });

  it("clears a system's tombstones after a successful write", async () => {
    vi.useFakeTimers();
    const { system, phase } = setupSystemWithPhase(LOCAL_WORKSPACE_REF);
    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();

    useAikBoardStore.getState().deletePhase(phase.id);
    expect(__getPendingAikTombstonesForTests(system.id)?.phases).toEqual([
      phase.id,
    ]);

    vi.advanceTimersByTime(500);
    await __flushAikDiskWritesForTests();

    expect(__getPendingAikTombstonesForTests(system.id)).toBeUndefined();
  });

  it("hydrates systems, phasesBySystemId, tasksBySystemId from localStorage on a fresh store", async () => {
    // `onRehydrateStorage` schedules a `syncFromFile` via `queueMicrotask`,
    // which the store will attempt to run after the rehydrate resolves —
    // so the mock must return a valid envelope (not undefined), otherwise
    // the microtask surfaces an unhandled rejection.
    readAikSystemFileMock.mockResolvedValue({
      ok: true,
      file: {
        version: 1,
        systemId: "sys-persisted",
        phases: [],
        tasks: [],
        updatedAt: new Date().toISOString(),
      },
    });
    // Seed the localStorage slot as if a previous browser session persisted it.
    const persisted = {
      state: {
        systems: [
          {
            id: "sys-persisted",
            name: "Sistema persistido",
            backendId: "backend-1",
            workspaceRef: LOCAL_WORKSPACE_REF,
            columnId: "ativo",
            activeAgentTaskId: null,
            createdAt: "2026-09-16T00:00:00.000Z",
            updatedAt: "2026-09-16T00:00:00.000Z",
          },
        ],
        phasesBySystemId: {
          "sys-persisted": [
            {
              id: "phase-persisted",
              systemId: "sys-persisted",
              title: "Fase persistida",
              columnId: "backlog",
              order: 0,
              createdAt: "2026-09-16T00:00:00.000Z",
              updatedAt: "2026-09-16T00:00:00.000Z",
            },
          ],
        },
        tasksBySystemId: { "sys-persisted": [] },
      },
      version: 1,
    };
    localStorage.setItem(
      "openhands:aik-board-store",
      JSON.stringify(persisted),
    );

    // The persist middleware rehydrates synchronously on the next call to
    // `useAikBoardStore.persist.rehydrate()` — or, in dev mock mode, by the
    // time we re-import. Easier: directly rehydrate here.
    await useAikBoardStore.persist.rehydrate();

    // Let the queueMicrotask drain so the `syncFromFile` it kicks off has
    // a chance to land before the assertions run.
    await new Promise((r) => setTimeout(r, 0));

    expect(useAikBoardStore.getState().systems).toHaveLength(1);
    expect(useAikBoardStore.getState().systems[0].id).toBe("sys-persisted");
    expect(
      useAikBoardStore.getState().phasesBySystemId["sys-persisted"],
    ).toHaveLength(1);
    // errorBySystemId is NOT persisted — confirms partialize.
    expect(
      useAikBoardStore.getState().errorBySystemId["sys-persisted"],
    ).toBeUndefined();
  });

  it("on rehydrate, triggers syncFromFile for every persisted local system so the agent's edits are pulled in", async () => {
    readAikSystemFileMock.mockResolvedValue({
      ok: true,
      file: {
        version: 1,
        systemId: "sys-persisted",
        phases: [],
        tasks: [],
        updatedAt: "2026-09-16T01:00:00.000Z",
      },
    });
    localStorage.setItem(
      "openhands:aik-board-store",
      JSON.stringify({
        state: {
          systems: [
            {
              id: "sys-persisted",
              name: "Sistema persistido",
              backendId: "backend-1",
              workspaceRef: LOCAL_WORKSPACE_REF,
              columnId: "ativo",
              activeAgentTaskId: null,
              createdAt: "2026-09-16T00:00:00.000Z",
              updatedAt: "2026-09-16T00:00:00.000Z",
            },
          ],
          phasesBySystemId: { "sys-persisted": [] },
          tasksBySystemId: { "sys-persisted": [] },
        },
        version: 1,
      }),
    );

    await useAikBoardStore.persist.rehydrate();

    // The rehydrate callback fires syncFromFile fire-and-forget; give the
    // microtask queue a turn.
    await new Promise((r) => setTimeout(r, 0));
    expect(readAikSystemFileMock).toHaveBeenCalledWith(
      LOCAL_WORKSPACE_REF.path,
    );
  });
});

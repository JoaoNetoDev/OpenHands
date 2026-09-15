import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AikWorkspaceRef } from "#/types/aik";

const startAikAgentTaskMock = vi.fn();
vi.mock("#/api/aik-pipeline.api", () => ({
  startAikAgentTask: (...args: unknown[]) => startAikAgentTaskMock(...args),
}));

const readAikSystemFileMock = vi.fn();
vi.mock("#/api/aik-board-file.api", () => ({
  readAikSystemFile: (...args: unknown[]) => readAikSystemFileMock(...args),
  mergeAikSystemFiles: (
    local: { phases: unknown[]; tasks: unknown[] },
    remote: { phases: unknown[]; tasks: unknown[] },
  ) => ({
    version: 1,
    systemId: "merged",
    phases: [...local.phases, ...remote.phases],
    tasks: [...local.tasks, ...remote.tasks],
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
const { useAikBoardStore } = await import("#/stores/aik-board-store");

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
  return { system, phase };
}

beforeEach(() => {
  resetStore();
  startAikAgentTaskMock.mockReset();
  readAikSystemFileMock.mockReset();
  pauseConversationMock.mockReset();
  sendMessageMock.mockReset();
  startAikAgentTaskMock.mockResolvedValue({
    ok: true,
    conversationId: "conv-1",
  });
  pauseConversationMock.mockResolvedValue({ success: true });
  sendMessageMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { I18nKey } from "#/i18n/declaration";
import { AikTaskCard } from "#/components/features/aik/aik-task-card";
import { useAikBoardStore } from "#/stores/aik-board-store";
import type { AikSystem, AikTask } from "#/types/aik";

const SYSTEM_ID = "system-1";

function makeSystem(overrides: Partial<AikSystem> = {}): AikSystem {
  const now = new Date().toISOString();
  return {
    id: SYSTEM_ID,
    name: "Sistema 1",
    backendId: "backend-1",
    workspaceRef: { kind: "local", workspaceId: "ws-1", path: "/tmp/ws" },
    columnId: "ativo",
    activeAgentTaskId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTask(overrides: Partial<AikTask> = {}): AikTask {
  const now = new Date().toISOString();
  return {
    id: "task-1",
    phaseId: "phase-1",
    systemId: SYSTEM_ID,
    title: "Task 1",
    executorType: "human",
    priority: "p2",
    columnId: "backlog",
    order: 0,
    timeline: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function resetStore() {
  useAikBoardStore.setState({
    systems: [],
    phasesBySystemId: {},
    tasksBySystemId: {},
    errorBySystemId: {},
  });
}

describe("AikTaskCard", () => {
  beforeEach(() => {
    resetStore();
  });

  it("shows the task's priority", () => {
    const task = makeTask({ priority: "p0" });
    useAikBoardStore.setState({
      systems: [makeSystem()],
      tasksBySystemId: { [SYSTEM_ID]: [task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={vi.fn()} />);
    expect(
      screen.getByTestId(`aik-task-card-priority-${task.id}`),
    ).toHaveTextContent(I18nKey.AIK$TASK_PRIORITY_P0);
  });

  it("calls onOpen when clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const task = makeTask();
    useAikBoardStore.setState({
      systems: [makeSystem()],
      tasksBySystemId: { [SYSTEM_ID]: [task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={onOpen} />);
    await user.click(screen.getByTestId(`aik-task-card-${task.id}`));
    expect(onOpen).toHaveBeenCalledWith(task);
  });

  // CA-10: Executar habilitado só com executorType agent + agentBriefing.
  it("disables Executar when executorType is human", () => {
    const task = makeTask({ executorType: "human" });
    useAikBoardStore.setState({
      systems: [makeSystem()],
      tasksBySystemId: { [SYSTEM_ID]: [task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={vi.fn()} />);
    expect(screen.getByTestId(`aik-task-card-run-${task.id}`)).toBeDisabled();
  });

  it("enables Executar when executorType is agent, agentBriefing is set and no blockers exist", () => {
    const task = makeTask({
      executorType: "agent",
      agentBriefing: "faça X",
    });
    useAikBoardStore.setState({
      systems: [makeSystem()],
      tasksBySystemId: { [SYSTEM_ID]: [task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={vi.fn()} />);
    expect(
      screen.getByTestId(`aik-task-card-run-${task.id}`),
    ).not.toBeDisabled();
  });

  // Dependency blocking: blockedByTaskId pointing to a non-done task only
  // disables Executar, not the drag handle (card itself stays interactive).
  it("shows a blocked indicator and disables Executar when blockedByTaskId points to a non-done task", () => {
    const blocker = makeTask({ id: "blocker", columnId: "in_progress" });
    const task = makeTask({
      id: "task-2",
      executorType: "agent",
      agentBriefing: "faça X",
      blockedByTaskId: "blocker",
    });
    useAikBoardStore.setState({
      systems: [makeSystem()],
      tasksBySystemId: { [SYSTEM_ID]: [blocker, task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={vi.fn()} />);
    expect(
      screen.getByTestId(`aik-task-card-blocked-${task.id}`),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`aik-task-card-run-${task.id}`)).toBeDisabled();
  });

  it("does not show a blocked indicator when blockedByTaskId points to a done task", () => {
    const blocker = makeTask({ id: "blocker", columnId: "done" });
    const task = makeTask({
      id: "task-2",
      executorType: "agent",
      agentBriefing: "faça X",
      blockedByTaskId: "blocker",
    });
    useAikBoardStore.setState({
      systems: [makeSystem()],
      tasksBySystemId: { [SYSTEM_ID]: [blocker, task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={vi.fn()} />);
    expect(screen.queryByTestId(`aik-task-card-blocked-${task.id}`)).toBeNull();
    expect(
      screen.getByTestId(`aik-task-card-run-${task.id}`),
    ).not.toBeDisabled();
  });

  // CA-11: Executar desabilitado com motivo visível quando outra tarefa já
  // ocupa activeAgentTaskId; startAgent não dispara chamada de rede.
  it("disables Executar with a visible reason when another task already has a live run", () => {
    const task = makeTask({
      id: "task-2",
      executorType: "agent",
      agentBriefing: "faça X",
    });
    useAikBoardStore.setState({
      systems: [makeSystem({ activeAgentTaskId: "some-other-task" })],
      tasksBySystemId: { [SYSTEM_ID]: [task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={vi.fn()} />);
    expect(screen.getByTestId(`aik-task-card-run-${task.id}`)).toBeDisabled();
    expect(
      screen.getByTestId(`aik-task-card-run-blocked-reason-${task.id}`),
    ).toHaveTextContent(I18nKey.AIK$TASK_RUN_BLOCKED_OTHER_RUN);
  });

  // CA-14: live-run indicator driven purely by store state (linkedConversationId +
  // system.activeAgentTaskId pointing at this task).
  it("shows a live-run indicator when this task is the system's active agent task", () => {
    const task = makeTask({
      id: "task-2",
      linkedConversationId: "conv-1",
    });
    useAikBoardStore.setState({
      systems: [makeSystem({ activeAgentTaskId: "task-2" })],
      tasksBySystemId: { [SYSTEM_ID]: [task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={vi.fn()} />);
    expect(
      screen.getByTestId(`aik-task-card-running-${task.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`aik-task-card-run-${task.id}`),
    ).toHaveTextContent(I18nKey.AIK$TASK_STOP_BUTTON);
  });

  // CA-15: card shows the list of files changed by the last run.
  it("renders task.lastRunFilesChanged as a list", () => {
    const task = makeTask({ lastRunFilesChanged: ["a.ts", "b.ts"] });
    useAikBoardStore.setState({
      systems: [makeSystem()],
      tasksBySystemId: { [SYSTEM_ID]: [task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={vi.fn()} />);
    const list = screen.getByTestId(`aik-task-card-files-changed-${task.id}`);
    expect(list).toHaveTextContent("a.ts");
    expect(list).toHaveTextContent("b.ts");
  });

  it("does not render a files-changed list when lastRunFilesChanged is absent", () => {
    const task = makeTask();
    useAikBoardStore.setState({
      systems: [makeSystem()],
      tasksBySystemId: { [SYSTEM_ID]: [task] },
    });
    renderWithProviders(<AikTaskCard task={task} onOpen={vi.fn()} />);
    expect(
      screen.queryByTestId(`aik-task-card-files-changed-${task.id}`),
    ).toBeNull();
  });

  // CA-12: clicking Executar calls startAgent from the store, without
  // opening the drawer (onOpen is not called).
  it("clicking Executar calls startAgent and does not trigger onOpen", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const task = makeTask({
      id: "task-2",
      executorType: "agent",
      agentBriefing: "faça X",
    });
    useAikBoardStore.setState({
      systems: [makeSystem()],
      tasksBySystemId: { [SYSTEM_ID]: [task] },
    });
    const startAgentSpy = vi
      .spyOn(useAikBoardStore.getState(), "startAgent")
      .mockResolvedValue({ ok: true, conversationId: "conv-1" });

    renderWithProviders(<AikTaskCard task={task} onOpen={onOpen} />);
    await user.click(screen.getByTestId(`aik-task-card-run-${task.id}`));

    expect(startAgentSpy).toHaveBeenCalledWith(task.id);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

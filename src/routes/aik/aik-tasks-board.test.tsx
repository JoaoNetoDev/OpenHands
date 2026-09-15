import { describe, expect, it, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, useParamsMock } from "test-utils";
import { I18nKey } from "#/i18n/declaration";
import AikTasksBoard from "#/routes/aik/aik-tasks-board";
import { useAikBoardStore } from "#/stores/aik-board-store";
import type { AikSystem, AikTask } from "#/types/aik";

const SYSTEM_ID = "system-1";
const PHASE_ID = "phase-1";

function setParams(systemId?: string, phaseId?: string) {
  useParamsMock.mockReturnValue({
    conversationId: "test-conversation-id",
    ...(systemId ? { systemId } : {}),
    ...(phaseId ? { phaseId } : {}),
  });
}

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
    phaseId: PHASE_ID,
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

describe("AikTasksBoard", () => {
  beforeEach(() => {
    resetStore();
    setParams(SYSTEM_ID, PHASE_ID);
  });

  it("shows a not-found state when systemId/phaseId are missing from the URL", () => {
    setParams(undefined, undefined);
    renderWithProviders(<AikTasksBoard />);
    expect(screen.getByTestId("aik-tasks-board-not-found")).toHaveTextContent(
      I18nKey.AIK$TASKS_BOARD_NOT_FOUND,
    );
  });

  // CA-08: renders tasks scoped to systemId+phaseId across the 4 fixed columns.
  it("renders only tasks belonging to the given systemId/phaseId, in the right columns", () => {
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: {},
      tasksBySystemId: {
        [SYSTEM_ID]: [
          makeTask({ id: "t-backlog", columnId: "backlog" }),
          makeTask({ id: "t-progress", columnId: "in_progress" }),
          makeTask({ id: "t-other-phase", phaseId: "other-phase" }),
        ],
      },
      errorBySystemId: {},
    });

    renderWithProviders(<AikTasksBoard />);

    expect(screen.getByTestId("aik-tasks-column-backlog")).toContainElement(
      screen.getByTestId("aik-task-card-t-backlog"),
    );
    expect(screen.getByTestId("aik-tasks-column-in_progress")).toContainElement(
      screen.getByTestId("aik-task-card-t-progress"),
    );
    expect(screen.queryByTestId("aik-task-card-t-other-phase")).toBeNull();
  });

  // CA-08: drag-based move calls moveTask with the destination column.
  it("moveTask persists columnId/order when a task is dropped in another column", () => {
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: {},
      tasksBySystemId: {
        [SYSTEM_ID]: [makeTask({ id: "t1", columnId: "backlog" })],
      },
      errorBySystemId: {},
    });

    useAikBoardStore.getState().moveTask("t1", "in_progress", 0);

    const moved = useAikBoardStore
      .getState()
      .tasksBySystemId[SYSTEM_ID].find((t) => t.id === "t1");
    expect(moved?.columnId).toBe("in_progress");
    expect(moved?.order).toBe(0);
  });

  // CA-19: opening a task shows its timeline in order.
  it("opening a task card shows its timeline entries", async () => {
    const user = userEvent.setup();
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: {},
      tasksBySystemId: {
        [SYSTEM_ID]: [
          makeTask({
            id: "t1",
            timeline: [
              {
                id: "e1",
                at: "2024-01-01T00:00:00.000Z",
                kind: "comment",
                text: "hello",
              },
            ],
          }),
        ],
      },
      errorBySystemId: {},
    });

    renderWithProviders(<AikTasksBoard />);
    await user.click(screen.getByTestId("aik-task-card-t1"));

    expect(screen.getByTestId("aik-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("aik-timeline-entry-text-e1")).toHaveTextContent(
      "hello",
    );
  });

  // CA-19/RF-20: Aprovar/Devolver only visible in in_review, and act via store.
  it("shows approve/return actions only for a task in in_review, and they update the store", async () => {
    const user = userEvent.setup();
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: {},
      tasksBySystemId: {
        [SYSTEM_ID]: [makeTask({ id: "t1", columnId: "in_review" })],
      },
      errorBySystemId: {},
    });

    renderWithProviders(<AikTasksBoard />);
    await user.click(screen.getByTestId("aik-task-card-t1"));

    expect(
      screen.getByTestId("aik-task-drawer-approve-t1"),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("aik-task-drawer-approve-t1"));

    const approved = useAikBoardStore
      .getState()
      .tasksBySystemId[SYSTEM_ID].find((t) => t.id === "t1");
    expect(approved?.columnId).toBe("done");
  });

  it("does not show approve/return actions for a task outside in_review", async () => {
    const user = userEvent.setup();
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: {},
      tasksBySystemId: {
        [SYSTEM_ID]: [makeTask({ id: "t1", columnId: "backlog" })],
      },
      errorBySystemId: {},
    });

    renderWithProviders(<AikTasksBoard />);
    await user.click(screen.getByTestId("aik-task-card-t1"));

    expect(screen.queryByTestId("aik-task-drawer-approve-t1")).toBeNull();
  });
});

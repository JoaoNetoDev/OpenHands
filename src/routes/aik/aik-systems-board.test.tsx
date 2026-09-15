import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { AikSystemsBoard } from "#/routes/aik/aik-systems-board";
import { useAikBoardStore } from "#/stores/aik-board-store";
import * as activeStore from "#/api/backend-registry/active-store";
import type { AikSystem, AikTask } from "#/types/aik";
import type { Backend } from "#/api/backend-registry/types";

const LOCAL_BACKEND: Backend = {
  id: "local-backend",
  name: "Local backend",
  host: "http://localhost:3000",
  apiKey: "",
  kind: "local",
};

vi.mock("#/hooks/query/use-local-workspaces", () => ({
  useLocalWorkspaces: () => ({
    data: { workspaces: [], workspaceParents: [] },
  }),
}));
vi.mock("#/hooks/query/use-git-repositories", () => ({
  useGitRepositories: () => ({ data: undefined }),
}));
vi.mock("#/hooks/use-user-providers", () => ({
  useUserProviders: () => ({ providers: [] }),
}));

function buildSystem(overrides: Partial<AikSystem> = {}): AikSystem {
  return {
    id: "sys-1",
    name: "System One",
    backendId: LOCAL_BACKEND.id,
    workspaceRef: { kind: "local", workspaceId: "ws-1", path: "/tmp/ws-1" },
    columnId: "ativo",
    activeAgentTaskId: null,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    ...overrides,
  };
}

function buildTask(overrides: Partial<AikTask> = {}): AikTask {
  return {
    id: "task-1",
    phaseId: "phase-1",
    systemId: "sys-1",
    title: "Task",
    executorType: "human",
    priority: "p2",
    columnId: "in_progress",
    order: 0,
    timeline: [],
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("AikSystemsBoard", () => {
  beforeEach(() => {
    useAikBoardStore.setState({
      systems: [],
      phasesBySystemId: {},
      tasksBySystemId: {},
      errorBySystemId: {},
    });
    vi.spyOn(activeStore, "getRegisteredBackends").mockReturnValue([
      LOCAL_BACKEND,
    ]);
  });

  // CA-01 (metade): renders the board root.
  it("renders the systems board root", () => {
    renderWithProviders(<AikSystemsBoard />);
    expect(screen.getByTestId("aik-systems-board")).toBeInTheDocument();
  });

  it("renders the 3 fixed columns and places systems in their own column", () => {
    useAikBoardStore.setState({
      systems: [
        buildSystem({ id: "sys-ativo", columnId: "ativo" }),
        buildSystem({ id: "sys-pausado", columnId: "pausado" }),
        buildSystem({ id: "sys-arquivado", columnId: "arquivado" }),
      ],
      phasesBySystemId: {},
      tasksBySystemId: {},
      errorBySystemId: {},
    });
    renderWithProviders(<AikSystemsBoard />);

    expect(
      screen.getByTestId("aik-systems-board-column-ativo"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("aik-systems-board-column-pausado"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("aik-systems-board-column-arquivado"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("aik-system-card-sys-ativo")).toBeInTheDocument();
    expect(
      screen.getByTestId("aik-system-card-sys-pausado"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("aik-system-card-sys-arquivado"),
    ).toBeInTheDocument();
  });

  // CA-04: card shows the count of in_progress/in_review tasks.
  it("shows the count of in_progress/in_review tasks on the card", () => {
    useAikBoardStore.setState({
      systems: [buildSystem()],
      phasesBySystemId: {},
      tasksBySystemId: {
        "sys-1": [
          buildTask({ id: "t1", columnId: "in_progress" }),
          buildTask({ id: "t2", columnId: "in_review" }),
          buildTask({ id: "t3", columnId: "done" }),
          buildTask({ id: "t4", columnId: "backlog" }),
        ],
      },
      errorBySystemId: {},
    });
    renderWithProviders(<AikSystemsBoard />);

    expect(
      screen.getByTestId("aik-system-card-task-count-sys-1"),
    ).toHaveAttribute("data-count", "2");
  });

  // CA-29: clicking a card navigates to /__aik/<systemId>, the clicked
  // system's own id (not any other system's).
  it("navigates to /__aik/<systemId> for the clicked card only", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    useAikBoardStore.setState({
      systems: [
        buildSystem({ id: "sys-a", name: "A" }),
        buildSystem({ id: "sys-b", name: "B" }),
      ],
      phasesBySystemId: {},
      tasksBySystemId: {},
      errorBySystemId: {},
    });
    renderWithProviders(<AikSystemsBoard />, { navigation: { navigate } });

    await user.click(screen.getByTestId("aik-system-card-open-sys-b"));

    expect(navigate).toHaveBeenCalledWith("/__aik/sys-b");
    expect(navigate).not.toHaveBeenCalledWith("/__aik/sys-a");
  });

  // CA-30: deleting a system shows the phase+task count and removes the
  // system (and its phases/tasks) from the store.
  it("shows descendant count and removes system + phases + tasks on delete", async () => {
    const user = userEvent.setup();
    useAikBoardStore.setState({
      systems: [buildSystem()],
      phasesBySystemId: {
        "sys-1": [
          {
            id: "phase-1",
            systemId: "sys-1",
            title: "Phase",
            columnId: "backlog",
            order: 0,
            createdAt: "2026-09-15T00:00:00.000Z",
            updatedAt: "2026-09-15T00:00:00.000Z",
          },
        ],
      },
      tasksBySystemId: { "sys-1": [buildTask()] },
      errorBySystemId: {},
    });
    renderWithProviders(<AikSystemsBoard />);

    await user.click(screen.getByTestId("aik-system-card-delete-sys-1"));
    expect(
      screen.getByTestId("delete-system-descendant-count"),
    ).toHaveAttribute("data-count", "2");

    await user.click(screen.getByTestId("confirm-delete-system-button"));

    expect(useAikBoardStore.getState().systems).toHaveLength(0);
    expect(
      useAikBoardStore.getState().phasesBySystemId["sys-1"],
    ).toBeUndefined();
    expect(
      useAikBoardStore.getState().tasksBySystemId["sys-1"],
    ).toBeUndefined();
  });

  // CA-39: a system in an isolated error state doesn't break the rest of
  // the board — other systems still render, and the erroring one shows a
  // badge instead of crashing.
  it("isolates a system's error without breaking the rest of the board", () => {
    useAikBoardStore.setState({
      systems: [
        buildSystem({ id: "sys-ok", name: "OK" }),
        buildSystem({ id: "sys-broken", name: "Broken" }),
      ],
      phasesBySystemId: {},
      tasksBySystemId: {},
      errorBySystemId: {
        "sys-broken": { errorType: "parse_error", detail: "parse_error" },
      },
    });
    renderWithProviders(<AikSystemsBoard />);

    expect(screen.getByTestId("aik-system-card-sys-ok")).toBeInTheDocument();
    expect(
      screen.getByTestId("aik-system-card-error-sys-broken"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("aik-system-card-sys-broken"),
    ).toBeInTheDocument();
  });
});

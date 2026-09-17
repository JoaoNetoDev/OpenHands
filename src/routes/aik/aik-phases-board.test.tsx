import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, useParamsMock } from "test-utils";
import { AikPhasesBoard } from "#/routes/aik/aik-phases-board";
import { useAikBoardStore } from "#/stores/aik-board-store";
import type { AikPhase, AikSystem, AikTask } from "#/types/aik";

const SYSTEM_ID = "sys-1";

function setSystemParam(systemId: string | undefined) {
  useParamsMock.mockReturnValue({
    conversationId: "test-conversation-id",
    ...(systemId ? { systemId } : {}),
  });
}

function makePhase(overrides: Partial<AikPhase> = {}): AikPhase {
  return {
    id: "phase-1",
    systemId: SYSTEM_ID,
    title: "Phase 1",
    columnId: "backlog",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<AikTask> = {}): AikTask {
  return {
    id: "task-1",
    phaseId: "phase-1",
    systemId: SYSTEM_ID,
    title: "Task 1",
    executorType: "human",
    priority: "p1",
    columnId: "backlog",
    order: 0,
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSystem(overrides: Partial<AikSystem> = {}): AikSystem {
  return {
    id: SYSTEM_ID,
    name: "System 1",
    backendId: "backend-1",
    workspaceRef: { kind: "local", workspaceId: "ws-1", path: "/tmp/ws" },
    columnId: "ativo",
    activeAgentTaskId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

describe("AikPhasesBoard", () => {
  beforeEach(() => {
    setSystemParam(SYSTEM_ID);
    resetStore();
  });

  // CA-05/RF-05: renders the 4 fixed columns and reads each phase's
  // columnId as-is from the store (derivation is the store's job, per
  // SPRINT-06 — this screen never recomputes it).
  it("renders phases in the column matching their store-derived columnId", () => {
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: {
        [SYSTEM_ID]: [
          makePhase({ id: "p-backlog", columnId: "backlog" }),
          makePhase({ id: "p-progress", columnId: "in_progress" }),
          makePhase({ id: "p-review", columnId: "in_review" }),
          makePhase({ id: "p-done", columnId: "done" }),
        ],
      },
      tasksBySystemId: { [SYSTEM_ID]: [] },
    });

    renderWithProviders(<AikPhasesBoard />);

    expect(screen.getByTestId("aik-phases-column-backlog")).toHaveTextContent(
      "Phase 1",
    );
    expect(screen.getByTestId("aik-phase-card-p-backlog")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("aik-phases-column-in_progress")
        .contains(screen.getByTestId("aik-phase-card-p-progress")),
    ).toBe(true);
    expect(
      screen
        .getByTestId("aik-phases-column-in_review")
        .contains(screen.getByTestId("aik-phase-card-p-review")),
    ).toBe(true);
    expect(
      screen
        .getByTestId("aik-phases-column-done")
        .contains(screen.getByTestId("aik-phase-card-p-done")),
    ).toBe(true);
  });

  // Regression test: AikLayout (the parent route) already renders the
  // breadcrumb once; AikPhasesBoard must not render a second one, or the
  // trail duplicates on screen ("Sistemas / <id>" shown twice).
  it("does not render its own breadcrumb (AikLayout already renders it once)", () => {
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: { [SYSTEM_ID]: [] },
      tasksBySystemId: { [SYSTEM_ID]: [] },
    });

    renderWithProviders(<AikPhasesBoard />);

    expect(screen.queryByTestId("aik-breadcrumb")).not.toBeInTheDocument();
  });

  it("shows the empty-column placeholder for columns with no phases", () => {
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: { [SYSTEM_ID]: [] },
      tasksBySystemId: { [SYSTEM_ID]: [] },
    });

    renderWithProviders(<AikPhasesBoard />);

    expect(
      screen.getByTestId("aik-phases-column-empty-backlog"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("aik-phases-column-empty-in_progress"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("aik-phases-column-empty-in_review"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("aik-phases-column-empty-done"),
    ).toBeInTheDocument();
  });

  // CA-06: a phase card never shows an "Executar" button nor a briefing
  // field — those only exist on task cards.
  it("never renders an execute button or briefing field on a phase card", () => {
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: { [SYSTEM_ID]: [makePhase()] },
      tasksBySystemId: { [SYSTEM_ID]: [] },
    });

    renderWithProviders(<AikPhasesBoard />);

    expect(screen.queryByText(/executar/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  // CA-08: no drag sensor is registered on the phase card — dragging must
  // be structurally impossible, not just visually blocked.
  it("does not attach any drag/sortable attributes to the phase card", () => {
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: { [SYSTEM_ID]: [makePhase()] },
      tasksBySystemId: { [SYSTEM_ID]: [] },
    });

    renderWithProviders(<AikPhasesBoard />);

    const card = screen.getByTestId("aik-phase-card-phase-1");
    expect(card).not.toHaveAttribute("draggable");
    expect(card.getAttribute("aria-roledescription")).toBeNull();
    // `@dnd-kit` sortable nodes always carry `aria-describedby` pointing at
    // its internal live-region announcer; absence confirms no `useSortable`
    // ran against this node.
    expect(card).not.toHaveAttribute("aria-describedby");
  });

  it("navigates to the phase's task board when the card is clicked", () => {
    const navigate = vi.fn();
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: { [SYSTEM_ID]: [makePhase()] },
      tasksBySystemId: { [SYSTEM_ID]: [] },
    });

    renderWithProviders(<AikPhasesBoard />, { navigation: { navigate } });

    fireEvent.click(screen.getByTestId("aik-phase-card-phase-1"));

    expect(navigate).toHaveBeenCalledWith("/__aik/sys-1/fases/phase-1");
  });

  // CA-09: deleting a phase with children (no live run) asks for
  // confirmation showing the descendant count, and succeeds.
  it("shows the delete confirmation with descendant count and deletes when there is no live run", () => {
    useAikBoardStore.setState({
      systems: [makeSystem({ activeAgentTaskId: null })],
      phasesBySystemId: { [SYSTEM_ID]: [makePhase()] },
      tasksBySystemId: {
        [SYSTEM_ID]: [makeTask({ id: "t-1" }), makeTask({ id: "t-2" })],
      },
    });

    renderWithProviders(<AikPhasesBoard />);

    fireEvent.click(screen.getByTestId("aik-phase-delete-phase-1"));

    expect(
      screen.getByTestId("delete-phase-confirm-dialog"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("delete-phase-descendant-count")).toHaveAttribute(
      "data-count",
      "2",
    );
    expect(
      screen.queryByTestId("delete-phase-blocked-message"),
    ).not.toBeInTheDocument();

    const confirmButton = screen.getByTestId("confirm-delete-button");
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    expect(
      useAikBoardStore.getState().phasesBySystemId[SYSTEM_ID],
    ).toHaveLength(0);
  });

  // CA-09/SPEC §4: a child task with a live run (system.activeAgentTaskId
  // pointing at it) blocks the confirm button.
  it("blocks deletion when a child task has a live agent run", () => {
    useAikBoardStore.setState({
      systems: [makeSystem({ activeAgentTaskId: "t-1" })],
      phasesBySystemId: { [SYSTEM_ID]: [makePhase()] },
      tasksBySystemId: { [SYSTEM_ID]: [makeTask({ id: "t-1" })] },
    });

    renderWithProviders(<AikPhasesBoard />);

    fireEvent.click(screen.getByTestId("aik-phase-delete-phase-1"));

    expect(
      screen.getByTestId("delete-phase-blocked-message"),
    ).toBeInTheDocument();
    const confirmButton = screen.getByTestId("confirm-delete-button");
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton);

    // Clicking the disabled button must not have deleted the phase.
    expect(
      useAikBoardStore.getState().phasesBySystemId[SYSTEM_ID],
    ).toHaveLength(1);
  });

  it("renders an empty container when there is no systemId in the URL", () => {
    setSystemParam(undefined);

    renderWithProviders(<AikPhasesBoard />);

    expect(screen.getByTestId("aik-phases-board")).toBeInTheDocument();
    expect(
      screen.queryByTestId("aik-phases-column-backlog"),
    ).not.toBeInTheDocument();
  });

  it("shows an isolated error state without crashing when the system has a sync error", () => {
    useAikBoardStore.setState({
      systems: [makeSystem()],
      phasesBySystemId: { [SYSTEM_ID]: [] },
      tasksBySystemId: { [SYSTEM_ID]: [] },
      errorBySystemId: {
        [SYSTEM_ID]: { errorType: "backend_down", detail: "offline" },
      },
    });

    renderWithProviders(<AikPhasesBoard />);

    expect(screen.getByTestId("aik-phases-board-error")).toHaveAttribute(
      "data-error-type",
      "backend_down",
    );
    expect(
      screen.queryByTestId("aik-phases-column-backlog"),
    ).not.toBeInTheDocument();
  });
});

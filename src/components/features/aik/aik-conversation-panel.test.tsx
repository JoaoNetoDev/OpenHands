import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { AikConversationPanel } from "#/components/features/aik/aik-conversation-panel";
import { useAikBoardStore } from "#/stores/aik-board-store";
import { useNavigation } from "#/context/navigation-context";

const wsProviderMountSpy = vi.fn();
const conversationMainMountSpy = vi.fn();

vi.mock("#/contexts/websocket-provider-wrapper", () => ({
  WebSocketProviderWrapper: ({
    conversationId,
    children,
  }: {
    conversationId: string;
    children: React.ReactNode;
  }) => {
    wsProviderMountSpy(conversationId);
    return (
      <div
        data-testid="mock-websocket-provider-wrapper"
        data-conversation-id={conversationId}
      >
        {children}
      </div>
    );
  },
}));

vi.mock("#/wrapper/event-handler", () => ({
  EventHandler: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-event-handler">{children}</div>
  ),
}));

vi.mock(
  "#/components/features/conversation/conversation-overview-drawer-context",
  () => ({
    ConversationOverviewDrawerProvider: ({
      children,
    }: {
      children: React.ReactNode;
    }) => <div data-testid="mock-drawer-provider">{children}</div>,
  }),
);

function NavigationProbe() {
  const { conversationId } = useNavigation();
  return <div data-testid="nav-probe">{conversationId}</div>;
}

vi.mock(
  "#/components/features/conversation/conversation-main/conversation-main",
  () => ({
    ConversationMain: () => {
      conversationMainMountSpy();
      return (
        <div data-testid="mock-conversation-main">
          <NavigationProbe />
        </div>
      );
    },
  }),
);

const SYSTEM_ID = "sys-1";
const TASK_ID = "task-1";

describe("AikConversationPanel", () => {
  beforeEach(() => {
    wsProviderMountSpy.mockClear();
    conversationMainMountSpy.mockClear();
    useAikBoardStore.setState({
      systems: [],
      phasesBySystemId: {},
      tasksBySystemId: {},
      errorBySystemId: {},
    });
  });

  it("shows the empty state when the system has no mainConversationId yet", () => {
    useAikBoardStore.setState({
      systems: [
        {
          id: SYSTEM_ID,
          name: "Sys",
          backendId: "backend-1",
          workspaceRef: { kind: "local", path: "/tmp/sys" },
          columnId: "ativo",
          activeAgentTaskId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          // no mainConversationId
        } as never,
      ],
    });

    renderWithProviders(<AikConversationPanel systemId={SYSTEM_ID} />);

    expect(
      screen.getByTestId("aik-conversation-panel-empty"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("mock-websocket-provider-wrapper"),
    ).not.toBeInTheDocument();
  });

  it("mounts the reused conversation package with the system's mainConversationId when no taskId is given", () => {
    useAikBoardStore.setState({
      systems: [
        {
          id: SYSTEM_ID,
          name: "Sys",
          backendId: "backend-1",
          workspaceRef: { kind: "local", path: "/tmp/sys" },
          columnId: "ativo",
          activeAgentTaskId: null,
          mainConversationId: "conv-system",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        } as never,
      ],
    });

    renderWithProviders(<AikConversationPanel systemId={SYSTEM_ID} />);

    expect(
      screen.getByTestId("mock-websocket-provider-wrapper"),
    ).toHaveAttribute("data-conversation-id", "conv-system");
    expect(screen.getByTestId("mock-event-handler")).toBeInTheDocument();
    expect(screen.getByTestId("mock-drawer-provider")).toBeInTheDocument();
    expect(screen.getByTestId("mock-conversation-main")).toBeInTheDocument();
    // The reused package must resolve `conversationId` from the local
    // override, not the app-wide navigation context (TECH §2.5).
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("conv-system");
    expect(wsProviderMountSpy).toHaveBeenCalledWith("conv-system");
  });

  it("mounts with the task's linkedConversationId when taskId is given", () => {
    useAikBoardStore.setState({
      systems: [
        {
          id: SYSTEM_ID,
          name: "Sys",
          backendId: "backend-1",
          workspaceRef: { kind: "local", path: "/tmp/sys" },
          columnId: "ativo",
          activeAgentTaskId: null,
          mainConversationId: "conv-system",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        } as never,
      ],
      tasksBySystemId: {
        [SYSTEM_ID]: [
          {
            id: TASK_ID,
            phaseId: "phase-1",
            systemId: SYSTEM_ID,
            title: "Task",
            executorType: "agent",
            priority: "p2",
            columnId: "in_progress",
            order: 0,
            linkedConversationId: "conv-task",
            timeline: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          } as never,
        ],
      },
    });

    renderWithProviders(
      <AikConversationPanel systemId={SYSTEM_ID} taskId={TASK_ID} />,
    );

    expect(
      screen.getByTestId("mock-websocket-provider-wrapper"),
    ).toHaveAttribute("data-conversation-id", "conv-task");
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("conv-task");
  });

  it("unmounts and remounts the conversation package when taskId changes", () => {
    useAikBoardStore.setState({
      systems: [
        {
          id: SYSTEM_ID,
          name: "Sys",
          backendId: "backend-1",
          workspaceRef: { kind: "local", path: "/tmp/sys" },
          columnId: "ativo",
          activeAgentTaskId: null,
          mainConversationId: "conv-system",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        } as never,
      ],
      tasksBySystemId: {
        [SYSTEM_ID]: [
          {
            id: TASK_ID,
            phaseId: "phase-1",
            systemId: SYSTEM_ID,
            title: "Task",
            executorType: "agent",
            priority: "p2",
            columnId: "in_progress",
            order: 0,
            linkedConversationId: "conv-task",
            timeline: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          } as never,
        ],
      },
    });

    const { rerender } = renderWithProviders(
      <AikConversationPanel systemId={SYSTEM_ID} />,
    );
    expect(conversationMainMountSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("mock-websocket-provider-wrapper"),
    ).toHaveAttribute("data-conversation-id", "conv-system");

    rerender(<AikConversationPanel systemId={SYSTEM_ID} taskId={TASK_ID} />);

    // A new instance was mounted (key changed) rather than the existing
    // one receiving new props in place.
    expect(conversationMainMountSpy).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId("mock-websocket-provider-wrapper"),
    ).toHaveAttribute("data-conversation-id", "conv-task");
  });
});

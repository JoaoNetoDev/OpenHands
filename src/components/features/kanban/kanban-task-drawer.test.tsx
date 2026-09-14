import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { KanbanTaskDrawer } from "#/components/features/kanban/kanban-task-drawer";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";

vi.mock("#/hooks/query/use-local-workspaces", () => ({
  useLocalWorkspaces: () => ({
    data: {
      workspaces: [{ id: WORKSPACE_ID, path: "/home/user/workspace" }],
    },
  }),
}));

vi.mock("#/api/kanban-pipeline.api", () => ({
  startFeatdevelopConversation: vi.fn(),
  readFeatureDoc: vi.fn().mockResolvedValue({ exists: false }),
  listFeatureSprintFiles: vi.fn().mockResolvedValue([]),
}));

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Task 1",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("KanbanTaskDrawer — featdevelop pipeline UI (SPRINT-03)", () => {
  beforeEach(() => {
    useKanbanBoardStore.setState({
      tasksByBoardId: { [WORKSPACE_ID]: [] },
      lastPersistFailed: false,
    });
  });

  it("shows FeatureSlugInput and RunAgentButton for a level-1 card", () => {
    const task = makeTask({ level: 1 });
    renderWithProviders(
      <KanbanTaskDrawer
        workspaceId={WORKSPACE_ID}
        task={task}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("kanban-feature-slug-input")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-run-agent-button")).toBeInTheDocument();
  });

  it("shows FeatureDocsPanel once a level-1 card has a featureSlug", async () => {
    const task = makeTask({ level: 1, featureSlug: "my-feature" });
    renderWithProviders(
      <KanbanTaskDrawer
        workspaceId={WORKSPACE_ID}
        task={task}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("kanban-feature-docs-panel"),
      ).toBeInTheDocument();
    });
  });

  it("regression: never shows the featdevelop UI for a level-2 card", () => {
    const task = makeTask({ id: "task-2", parentId: "parent-1", level: 2 });
    renderWithProviders(
      <KanbanTaskDrawer
        workspaceId={WORKSPACE_ID}
        task={task}
        onClose={() => {}}
      />,
    );

    expect(
      screen.queryByTestId("kanban-feature-slug-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("kanban-run-agent-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("kanban-feature-docs-panel"),
    ).not.toBeInTheDocument();
  });

  it("regression: never shows the featdevelop UI for a level-3 card", () => {
    const task = makeTask({ id: "task-3", parentId: "parent-2", level: 3 });
    renderWithProviders(
      <KanbanTaskDrawer
        workspaceId={WORKSPACE_ID}
        task={task}
        onClose={() => {}}
      />,
    );

    expect(
      screen.queryByTestId("kanban-feature-slug-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("kanban-run-agent-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("kanban-feature-docs-panel"),
    ).not.toBeInTheDocument();
  });
});

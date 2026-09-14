import { describe, expect, it, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { FeatureSlugInput } from "#/components/features/kanban/feature-slug-input";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    parentId: null,
    level: 1,
    title: "Task 1",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("FeatureSlugInput", () => {
  beforeEach(() => {
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: {
        [WORKSPACE_ID]: [makeTask()],
      },
      lastPersistFailed: false,
    });
  });

  it("does not save an invalid slug and shows an inline error", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    renderWithProviders(
      <FeatureSlugInput workspaceId={WORKSPACE_ID} task={task} />,
    );

    const input = screen.getByTestId("kanban-feature-slug-input");
    await user.type(input, "Not Valid_Slug");
    await user.tab();

    const tasks =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
    expect(tasks[0].featureSlug).toBeUndefined();
    expect(input).toBeInvalid();
  });

  it("saves a valid slug and persists it", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    renderWithProviders(
      <FeatureSlugInput workspaceId={WORKSPACE_ID} task={task} />,
    );

    const input = screen.getByTestId("kanban-feature-slug-input");
    await user.type(input, "my-feature");
    await user.tab();

    const tasks =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
    expect(tasks[0].featureSlug).toBe("my-feature");
  });

  it("resets columnId to featdevelop_todo when saving a slug while still in todo", async () => {
    const user = userEvent.setup();
    const task = makeTask({ columnId: "todo" });
    renderWithProviders(
      <FeatureSlugInput workspaceId={WORKSPACE_ID} task={task} />,
    );

    const input = screen.getByTestId("kanban-feature-slug-input");
    await user.type(input, "my-feature");
    await user.tab();

    const tasks =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
    expect(tasks[0].columnId).toBe("featdevelop_todo");
  });

  it("does not force a column change when the card was already moved manually", async () => {
    const user = userEvent.setup();
    const task = makeTask({ columnId: "in_progress" });
    useKanbanBoardStore.setState({
      tasksByWorkspaceId: { [WORKSPACE_ID]: [task] },
      lastPersistFailed: false,
    });
    renderWithProviders(
      <FeatureSlugInput workspaceId={WORKSPACE_ID} task={task} />,
    );

    const input = screen.getByTestId("kanban-feature-slug-input");
    await user.type(input, "my-feature");
    await user.tab();

    const tasks =
      useKanbanBoardStore.getState().tasksByWorkspaceId[WORKSPACE_ID];
    expect(tasks[0].columnId).toBe("in_progress");
    expect(tasks[0].featureSlug).toBe("my-feature");
  });
});

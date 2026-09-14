import { describe, expect, it, beforeEach, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { I18nKey } from "#/i18n/declaration";
import { KanbanCard } from "#/components/features/kanban/kanban-card";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Parent task",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("KanbanCard", () => {
  beforeEach(() => {
    useKanbanBoardStore.setState({
      tasksByBoardId: {},
      lastPersistFailed: false,
    });
  });

  it("does not show a progress indicator when the task has no children", () => {
    const task = makeTask();
    renderWithProviders(
      <DndContext>
        <KanbanCard workspaceId={WORKSPACE_ID} task={task} />
      </DndContext>,
    );

    expect(screen.getByText("Parent task")).toBeInTheDocument();
    expect(screen.queryByTestId(`kanban-card-progress-${task.id}`)).toBeNull();
  });

  it('shows "2 of 5" when 2 of 5 children are done', () => {
    const parent = makeTask({ id: "parent-1" });
    const children: KanbanTask[] = [
      makeTask({ id: "c1", parentId: parent.id, level: 2, columnId: "done" }),
      makeTask({ id: "c2", parentId: parent.id, level: 2, columnId: "done" }),
      makeTask({
        id: "c3",
        parentId: parent.id,
        level: 2,
        columnId: "todo",
      }),
      makeTask({
        id: "c4",
        parentId: parent.id,
        level: 2,
        columnId: "in_progress",
      }),
      makeTask({
        id: "c5",
        parentId: parent.id,
        level: 2,
        columnId: "todo",
      }),
    ];

    useKanbanBoardStore.setState({
      tasksByBoardId: { [WORKSPACE_ID]: [parent, ...children] },
      lastPersistFailed: false,
    });

    renderWithProviders(
      <DndContext>
        <KanbanCard workspaceId={WORKSPACE_ID} task={parent} />
      </DndContext>,
    );

    const progress = screen.getByTestId(`kanban-card-progress-${parent.id}`);
    expect(progress).toHaveTextContent(I18nKey.KANBAN$SUBTASK_PROGRESS);
    expect(progress).toHaveAttribute("data-completed", "2");
    expect(progress).toHaveAttribute("data-total", "5");
  });

  // F-K3-1: the card is both clickable (opens the task drawer) and a
  // `@dnd-kit` sortable drag source, so keyboard activation must not
  // collide with `KeyboardSensor`'s own Enter/Space drag pickup. Enter is
  // reserved for "open the drawer" (see the `handleKeyDown` comment in
  // `kanban-card.tsx`).
  it("calls the click handler when Enter is pressed on the card", () => {
    const task = makeTask();
    const onClick = vi.fn();
    renderWithProviders(
      <DndContext>
        <KanbanCard workspaceId={WORKSPACE_ID} task={task} onClick={onClick} />
      </DndContext>,
    );

    fireEvent.keyDown(screen.getByTestId(`kanban-card-${task.id}`), {
      key: "Enter",
      code: "Enter",
    });

    expect(onClick).toHaveBeenCalledWith(task);
  });

  it("does not call the click handler when Space is pressed on the card (reserved for keyboard drag pickup)", () => {
    const task = makeTask();
    const onClick = vi.fn();
    renderWithProviders(
      <DndContext>
        <KanbanCard workspaceId={WORKSPACE_ID} task={task} onClick={onClick} />
      </DndContext>,
    );

    fireEvent.keyDown(screen.getByTestId(`kanban-card-${task.id}`), {
      key: " ",
      code: "Space",
    });

    expect(onClick).not.toHaveBeenCalled();
  });
});

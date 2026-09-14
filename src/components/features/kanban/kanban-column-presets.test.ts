import { describe, expect, it } from "vitest";
import type { KanbanTask } from "#/types/kanban";
import { getColumnsForTask } from "./kanban-column-presets";

function buildTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Título",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("getColumnsForTask", () => {
  it("returns the six featdevelop columns, in order, for a card with featureSlug", () => {
    const task = buildTask({ featureSlug: "minha-feature" });

    const columns = getColumnsForTask(task);

    expect(columns.map((c) => c.id)).toEqual([
      "featdevelop_todo",
      "featdevelop_prd",
      "featdevelop_tech",
      "featdevelop_spec",
      "featdevelop_sprints",
      "featdevelop_done",
    ]);
  });

  it("returns the three generic columns, in order, for a card without featureSlug", () => {
    const task = buildTask();

    const columns = getColumnsForTask(task);

    expect(columns.map((c) => c.id)).toEqual(["todo", "in_progress", "done"]);
  });

  it("regression: level 2/3 cards without featureSlug keep the 3-column preset from kanban-3-niveis", () => {
    const level2Task = buildTask({
      id: "task-2",
      parentId: "task-1",
      level: 2,
    });
    const level3Task = buildTask({
      id: "task-3",
      parentId: "task-2",
      level: 3,
    });

    expect(getColumnsForTask(level2Task).map((c) => c.id)).toEqual([
      "todo",
      "in_progress",
      "done",
    ]);
    expect(getColumnsForTask(level3Task).map((c) => c.id)).toEqual([
      "todo",
      "in_progress",
      "done",
    ]);
  });
});

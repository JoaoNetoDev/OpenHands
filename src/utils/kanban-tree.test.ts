import { describe, expect, it } from "vitest";
import type { KanbanTask } from "#/types/kanban";
import { collectDescendantIds, reindexAfterMove } from "#/utils/kanban-tree";

function makeTask(overrides: Partial<KanbanTask> & { id: string }): KanbanTask {
  return {
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: `Task ${overrides.id}`,
    columnId: "todo",
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("collectDescendantIds", () => {
  it("returns an empty set when the task has no children", () => {
    const tasks = [makeTask({ id: "a" })];
    expect(collectDescendantIds(tasks, "a")).toEqual(new Set());
  });

  it("returns direct children (1 level deep)", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", parentId: "a", level: 2 }),
      makeTask({ id: "c", parentId: "a", level: 2 }),
    ];
    expect(collectDescendantIds(tasks, "a")).toEqual(new Set(["b", "c"]));
  });

  it("returns all descendants across 3 levels (full cascade)", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", parentId: "a", level: 2 }),
      makeTask({ id: "c", parentId: "a", level: 2 }),
      makeTask({ id: "d", parentId: "b", level: 3 }),
      makeTask({ id: "e", parentId: "c", level: 3 }),
    ];
    expect(collectDescendantIds(tasks, "a")).toEqual(
      new Set(["b", "c", "d", "e"]),
    );
  });

  it("returns an empty set for a nonexistent id", () => {
    const tasks = [makeTask({ id: "a" })];
    expect(collectDescendantIds(tasks, "nonexistent")).toEqual(new Set());
  });

  it("terminates in finite time on a corrupted parentId cycle", () => {
    const tasks = [
      makeTask({ id: "a", parentId: "b" }),
      makeTask({ id: "b", parentId: "a" }),
    ];
    const result = collectDescendantIds(tasks, "a");
    expect(result).toEqual(new Set(["b"]));
  });

  it("terminates in finite time on self-referential parentId", () => {
    const tasks = [makeTask({ id: "a", parentId: "a" })];
    const result = collectDescendantIds(tasks, "a");
    expect(result).toEqual(new Set());
  });
});

describe("reindexAfterMove", () => {
  it("moves a task to a different column and reindexes both columns", () => {
    const tasks = [
      makeTask({ id: "a", columnId: "todo", order: 0 }),
      makeTask({ id: "b", columnId: "todo", order: 1 }),
      makeTask({ id: "c", columnId: "in_progress", order: 0 }),
    ];
    const result = reindexAfterMove(tasks, "a", "in_progress", 0);

    const a = result.find((t) => t.id === "a")!;
    const b = result.find((t) => t.id === "b")!;
    const c = result.find((t) => t.id === "c")!;

    expect(a.columnId).toBe("in_progress");
    expect(a.order).toBe(0);
    expect(c.order).toBe(1);
    expect(b.columnId).toBe("todo");
    expect(b.order).toBe(0);
  });

  it("reindexes order within the same column", () => {
    const tasks = [
      makeTask({ id: "a", columnId: "todo", order: 0 }),
      makeTask({ id: "b", columnId: "todo", order: 1 }),
      makeTask({ id: "c", columnId: "todo", order: 2 }),
    ];
    const result = reindexAfterMove(tasks, "c", "todo", 0);
    expect(result.find((t) => t.id === "c")!.order).toBe(0);
    expect(result.find((t) => t.id === "a")!.order).toBe(1);
    expect(result.find((t) => t.id === "b")!.order).toBe(2);
  });

  it("is a no-op when the task does not exist", () => {
    const tasks = [makeTask({ id: "a" })];
    const result = reindexAfterMove(tasks, "missing", "done", 0);
    expect(result).toEqual(tasks);
  });
});

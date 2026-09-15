import { describe, expect, it } from "vitest";
import type { AikTask } from "#/types/aik";
import { wouldCreateCycle } from "#/utils/aik-dependency-graph";

function makeTask(overrides: Partial<AikTask> & { id: string }): AikTask {
  return {
    phaseId: "phase-1",
    systemId: "system-1",
    title: `Task ${overrides.id}`,
    executorType: "human",
    priority: "p2",
    columnId: "backlog",
    order: 0,
    timeline: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("wouldCreateCycle", () => {
  it("detects a direct cycle (A blocked by B, B blocked by A)", () => {
    const tasks = [
      makeTask({ id: "a", blockedByTaskId: undefined }),
      makeTask({ id: "b", blockedByTaskId: "a" }),
    ];
    // Setting a.blockedByTaskId = "b" would close A -> B -> A.
    expect(wouldCreateCycle(tasks, "a", "b")).toBe(true);
  });

  it("detects an indirect cycle (A -> B -> C -> A)", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", blockedByTaskId: "a" }),
      makeTask({ id: "c", blockedByTaskId: "b" }),
    ];
    // Setting a.blockedByTaskId = "c" would close A -> C -> B -> A.
    expect(wouldCreateCycle(tasks, "a", "c")).toBe(true);
  });

  it("detects self-reference", () => {
    const tasks = [makeTask({ id: "a" })];
    expect(wouldCreateCycle(tasks, "a", "a")).toBe(true);
  });

  it("returns false when there is no cycle", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c", blockedByTaskId: "b" }),
    ];
    expect(wouldCreateCycle(tasks, "a", "b")).toBe(false);
  });

  it("returns false for a disconnected graph", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c", blockedByTaskId: "d" }),
      makeTask({ id: "d" }),
    ];
    expect(wouldCreateCycle(tasks, "a", "c")).toBe(false);
  });
});

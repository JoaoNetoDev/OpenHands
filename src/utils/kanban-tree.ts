import type { KanbanColumnId, KanbanTask } from "#/types/kanban";

/**
 * BFS over `parentId` links collecting every descendant id of `taskId`.
 * Uses a `visited` Set from the start so corrupted data (a `parentId` cycle,
 * or a task whose `parentId === id`) cannot cause an infinite loop — any id
 * already visited (or equal to the starting `taskId`) is skipped instead of
 * re-enqueued. Does NOT include `taskId` itself in the returned set.
 */
export function collectDescendantIds(
  tasks: KanbanTask[],
  taskId: string,
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [taskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = tasks.filter((t) => t.parentId === current);
    for (const child of children) {
      if (visited.has(child.id) || child.id === taskId) continue;
      visited.add(child.id);
      queue.push(child.id);
    }
  }
  return visited;
}

/**
 * Recomputes sequential `order` (0..n-1) for the siblings (same `parentId`)
 * of the moved task in both the origin column and the destination column,
 * after moving `taskId` to `toColumnId` at position `toOrder`.
 */
export function reindexAfterMove(
  tasks: KanbanTask[],
  taskId: string,
  toColumnId: KanbanColumnId,
  toOrder: number,
): KanbanTask[] {
  const moving = tasks.find((t) => t.id === taskId);
  if (!moving) return tasks;

  const parentId = moving.parentId;
  const fromColumnId = moving.columnId;

  // Siblings in the destination column, excluding the moving task itself.
  const destSiblings = tasks
    .filter(
      (t) =>
        t.id !== taskId && t.parentId === parentId && t.columnId === toColumnId,
    )
    .sort((a, b) => a.order - b.order);

  const clampedOrder = Math.max(0, Math.min(toOrder, destSiblings.length));
  destSiblings.splice(clampedOrder, 0, { ...moving, columnId: toColumnId });

  const destOrderById = new Map<string, number>();
  destSiblings.forEach((t, index) => destOrderById.set(t.id, index));

  // Siblings remaining in the origin column (only relevant if it differs
  // from the destination column), reindexed to close the gap left behind.
  const originSiblings =
    fromColumnId === toColumnId
      ? []
      : tasks
          .filter(
            (t) =>
              t.id !== taskId &&
              t.parentId === parentId &&
              t.columnId === fromColumnId,
          )
          .sort((a, b) => a.order - b.order);

  const originOrderById = new Map<string, number>();
  originSiblings.forEach((t, index) => originOrderById.set(t.id, index));

  return tasks.map((t) => {
    if (destOrderById.has(t.id)) {
      const order = destOrderById.get(t.id)!;
      return t.id === taskId
        ? { ...t, columnId: toColumnId, order }
        : { ...t, order };
    }
    if (originOrderById.has(t.id)) {
      return { ...t, order: originOrderById.get(t.id)! };
    }
    return t;
  });
}

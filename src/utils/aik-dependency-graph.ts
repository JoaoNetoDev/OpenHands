import type { AikTask } from "#/types/aik";

/**
 * BFS over `blockedByTaskId` links starting at `candidateBlockedByTaskId`,
 * adapted from `collectDescendantIds` (`src/utils/kanban-tree.ts:10-26`)
 * trading `parentId` for the blocking graph. Returns `true` when `taskId`
 * is reachable from `candidateBlockedByTaskId` — i.e. setting
 * `taskId.blockedByTaskId = candidateBlockedByTaskId` would close a cycle.
 *
 * Self-reference (`candidateBlockedByTaskId === taskId`) is always a cycle
 * and is checked before the BFS. A `visited` Set guards against corrupted
 * data (an existing cycle already in `tasks`) causing an infinite loop.
 */
export function wouldCreateCycle(
  tasks: AikTask[],
  taskId: string,
  candidateBlockedByTaskId: string,
): boolean {
  if (candidateBlockedByTaskId === taskId) return true;

  const visited = new Set<string>();
  const queue: string[] = [candidateBlockedByTaskId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const currentTask = tasks.find((t) => t.id === current);
    const next = currentTask?.blockedByTaskId;
    if (next && !visited.has(next)) {
      queue.push(next);
    }
  }

  return false;
}

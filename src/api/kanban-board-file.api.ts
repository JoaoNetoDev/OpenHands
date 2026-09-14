import { getActiveBackend } from "#/api/backend-registry/active-store";
import AgentServerRuntimeService from "#/api/runtime-service/agent-server-runtime-service";
import {
  buildWriteFileCommand,
  escapeSingleQuoted,
  toBase64,
} from "#/api/kanban-sintering.api";
import type { KanbanBoard, KanbanColumnId, KanbanTask } from "#/types/kanban";

/**
 * On-disk envelope for a workspace's boards + tasks (SPEC §2.6 / TECH
 * §2.6). One file per workspace, at
 * `<workspacePath>/.openhands/kanban/<workspaceId>/board.json`.
 */
export interface KanbanBoardFile {
  version: 1;
  boards: KanbanBoard[];
  tasksByBoardId: Record<string, KanbanTask[]>;
  updatedAt: string;
}

const ALL_COLUMN_IDS: KanbanColumnId[] = [
  "todo",
  "in_progress",
  "done",
  "featdevelop_todo",
  "featdevelop_prd",
  "featdevelop_tech",
  "featdevelop_spec",
  "featdevelop_sprints",
  "featdevelop_done",
];

function isValidColumnId(value: unknown): value is KanbanColumnId {
  return (
    typeof value === "string" &&
    ALL_COLUMN_IDS.includes(value as KanbanColumnId)
  );
}

/**
 * Parses and validates the raw contents of `board.json`. Never throws —
 * malformed JSON or a malformed envelope returns `null`; a malformed
 * individual board/task is dropped *individually* rather than failing the
 * whole parse (TECH §2.6 / SPEC §2.6), because once the agent can write this
 * file directly (RF-09) its content is no longer guaranteed to have been
 * produced only by this frontend.
 */
export function parseBoardFile(raw: string): KanbanBoardFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Partial<KanbanBoardFile>;
  if (
    p.version !== 1 ||
    !Array.isArray(p.boards) ||
    typeof p.tasksByBoardId !== "object" ||
    p.tasksByBoardId === null
  ) {
    return null;
  }

  const boards = p.boards.filter(
    (b): b is KanbanBoard =>
      typeof b?.id === "string" &&
      b.id.length > 0 &&
      typeof b?.workspaceId === "string" &&
      b.workspaceId.length > 0 &&
      typeof b?.name === "string" &&
      b.name.length > 0,
  );
  const knownBoardIds = new Set(boards.map((b) => b.id));

  const tasksByBoardId: Record<string, KanbanTask[]> = {};
  for (const [boardId, tasks] of Object.entries(p.tasksByBoardId ?? {})) {
    // A boardId that doesn't match any valid KanbanBoard (e.g. a board
    // deleted between the read and the write) is dropped entirely here —
    // mandatory, not optional: without this `if`, tasks stay stuck under a
    // key the board-list UI never iterates over, invisible but never
    // cleaned up from the file.
    if (!knownBoardIds.has(boardId)) continue;
    tasksByBoardId[boardId] = (Array.isArray(tasks) ? tasks : []).filter(
      (t): t is KanbanTask =>
        typeof t?.id === "string" &&
        t.id.length > 0 &&
        t?.boardId === boardId &&
        (t?.level === 1 || t?.level === 2 || t?.level === 3) &&
        isValidColumnId(t?.columnId),
    );
  }

  return {
    version: 1,
    boards,
    tasksByBoardId,
    updatedAt:
      typeof p.updatedAt === "string" ? p.updatedAt : new Date(0).toISOString(),
  };
}

function boardFilePath(workspacePath: string, workspaceId: string): string {
  return `${workspacePath}/.openhands/kanban/${workspaceId}/board.json`;
}

/**
 * Merges the on-disk file (`disk`) with a candidate to write (`incoming`),
 * task-by-task by `id`, the most recent `updatedAt` wins per task (TECH
 * §2.6) — never overwrites the whole document. Boards don't carry a
 * per-field `updatedAt`, so `incoming` wins wholesale for any board id
 * present in both.
 */
export function mergeBoardFiles(
  disk: KanbanBoardFile,
  incoming: KanbanBoardFile,
): KanbanBoardFile {
  const tasksByBoardId: Record<string, KanbanTask[]> = {};
  const boardIds = new Set([
    ...Object.keys(disk.tasksByBoardId),
    ...Object.keys(incoming.tasksByBoardId),
  ]);
  for (const boardId of boardIds) {
    const byId = new Map<string, KanbanTask>();
    for (const t of disk.tasksByBoardId[boardId] ?? []) byId.set(t.id, t);
    for (const t of incoming.tasksByBoardId[boardId] ?? []) {
      const existing = byId.get(t.id);
      if (!existing || new Date(t.updatedAt) >= new Date(existing.updatedAt)) {
        byId.set(t.id, t);
      }
    }
    tasksByBoardId[boardId] = Array.from(byId.values());
  }

  const boardsById = new Map(disk.boards.map((b) => [b.id, b]));
  for (const b of incoming.boards) boardsById.set(b.id, b); // incoming wins (no granular timestamp)

  return {
    version: 1,
    boards: Array.from(boardsById.values()),
    tasksByBoardId,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Reads and validates `board.json` for `workspaceId`. Never throws.
 *
 * Local-only (same limitation already documented for
 * `kanban-card-contexto-arquivos`): `execute_bash_command` without an
 * active conversation only works against the local agent-server. On a
 * Cloud backend this returns `{ ok: false, error: "cloud_unsupported" }`
 * immediately, without ever calling `executeCommand` — the board then stays
 * in `localStorage` only, same behavior as v1.
 */
export async function readBoardFile(
  workspacePath: string,
  workspaceId: string,
): Promise<{ ok: true; data: KanbanBoardFile } | { ok: false; error: string }> {
  if (getActiveBackend().backend.kind === "cloud") {
    return { ok: false, error: "cloud_unsupported" };
  }
  try {
    const path = boardFilePath(workspacePath, workspaceId);
    const result = await AgentServerRuntimeService.executeCommand(
      null,
      null,
      `cat -- ${escapeSingleQuoted(path)}`,
      workspacePath,
    );
    if (result.exit_code !== 0) return { ok: false, error: "not_found" };
    const parsed = parseBoardFile(result.stdout);
    if (!parsed) return { ok: false, error: "invalid_schema" };
    return { ok: true, data: parsed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}

/**
 * Writes `next` to `board.json` for `workspaceId`. Never throws.
 *
 * Same Cloud guard as `readBoardFile`, checked first — no attempt to build
 * or run a command against a Cloud backend.
 *
 * read-modify-write (TECH §2.6): re-reads the current on-disk file
 * immediately before writing and merges it against `next` task-by-task via
 * `mergeBoardFiles` (most recent `updatedAt` per task wins), instead of
 * overwriting the whole snapshot. This matters because the agent can write
 * this same file directly (RF-09) while the browser also writes it — an
 * overwrite-the-snapshot write would silently discard any change the agent
 * made between the browser's last read and this write, including the
 * agent's own transition to `"pending_validation"`.
 */
export async function writeBoardFile(
  workspacePath: string,
  workspaceId: string,
  next: KanbanBoardFile,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (getActiveBackend().backend.kind === "cloud") {
    return { ok: false, error: "cloud_unsupported" };
  }
  try {
    const current = await readBoardFile(workspacePath, workspaceId);
    const merged = current.ok ? mergeBoardFiles(current.data, next) : next;
    const contentBase64 = await toBase64(
      new TextEncoder().encode(JSON.stringify(merged)).buffer,
    );
    const path = boardFilePath(workspacePath, workspaceId);
    const result = await AgentServerRuntimeService.executeCommand(
      null,
      null,
      buildWriteFileCommand(path, contentBase64),
      workspacePath,
    );
    if (result.exit_code !== 0) {
      return { ok: false, error: result.stderr || "write_failed" };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}

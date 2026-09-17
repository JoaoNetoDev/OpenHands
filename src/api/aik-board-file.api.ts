import { getActiveBackend } from "#/api/backend-registry/active-store";
import AgentServerRuntimeService from "#/api/runtime-service/agent-server-runtime-service";
import {
  buildWriteFileCommand,
  escapeSingleQuoted,
  toBase64,
} from "#/api/kanban-sintering.api";
import type {
  AikErrorType,
  AikPhase,
  AikSystemFile,
  AikTask,
} from "#/types/aik";

/**
 * Builds the on-disk path for a workspace's AIK system file (SPEC §2.4 /
 * TECH §2.3). One file per workspace, at
 * `<workspacePath>/.openhands/aik/system.json`.
 */
export function buildAikFilePath(workspacePath: string): string {
  return `${workspacePath}/.openhands/aik/system.json`;
}

/**
 * Parses and validates the raw contents of `system.json`. Returns `null`
 * for malformed JSON or an unknown `version` — never throws.
 */
function parseAikSystemFile(raw: string): AikSystemFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Partial<AikSystemFile>;
  if (
    p.version !== 1 ||
    typeof p.systemId !== "string" ||
    !Array.isArray(p.phases) ||
    !Array.isArray(p.tasks)
  ) {
    return null;
  }
  return {
    version: 1,
    systemId: p.systemId,
    phases: p.phases,
    tasks: p.tasks,
    updatedAt:
      typeof p.updatedAt === "string" ? p.updatedAt : new Date(0).toISOString(),
  };
}

/** IDs the local user has deleted since the last successful write, keyed by
 * collection. Items on disk whose `id` is tombstoned are dropped from the
 * merge instead of being treated as "present only on disk, keep it" — that
 * rule is what made a local deletion look like a no-op when the on-disk file
 * still held the pre-delete snapshot. See `pendingTombstonesBySystem`
 * (`src/stores/aik-board-store.ts`) for how these are captured. */
export interface AikMergeTombstones {
  phases?: ReadonlySet<string>;
  tasks?: ReadonlySet<string>;
}

/**
 * Merges a collection of items keyed by `id`, keeping the version with the
 * most recent `updatedAt` when an item is present on both sides. An item
 * present on only one side is always kept (never dropped for being absent
 * on the other side) — UNLESS its `id` is tombstoned, in which case the disk
 * copy is dropped so the local deletion survives the read-modify-write.
 */
function mergeById<T extends { id: string; updatedAt: string }>(
  disk: T[],
  incoming: T[],
  tombstones?: ReadonlySet<string>,
): T[] {
  const byId = new Map<string, T>();
  for (const item of disk) {
    if (tombstones?.has(item.id)) continue;
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing || new Date(item.updatedAt) >= new Date(existing.updatedAt)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

/**
 * Merges the on-disk file (`local`) with a candidate to write (`remote`),
 * fusing `phases` and `tasks` independently by `id`, the most recent
 * `updatedAt` wins per item (SPEC §2.4) — generalization of the
 * per-task half of `mergeBoardFiles` (`kanban-board-file.api.ts:116-146`)
 * to both collections, since `AikPhase` (unlike `KanbanBoard`) carries a
 * per-item `updatedAt`.
 */
export function mergeAikSystemFiles(
  local: AikSystemFile,
  remote: AikSystemFile,
  tombstones?: AikMergeTombstones,
): AikSystemFile {
  return {
    version: 1,
    systemId: remote.systemId || local.systemId,
    phases: mergeById<AikPhase>(
      local.phases,
      remote.phases,
      tombstones?.phases,
    ),
    tasks: mergeById<AikTask>(local.tasks, remote.tasks, tombstones?.tasks),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Reads and validates `.openhands/aik/system.json` for `workspacePath`.
 * Never throws.
 *
 * Local-only, same limitation as `readBoardFile`
 * (`kanban-board-file.api.ts:158-183`): `executeCommand` without an active
 * conversation only works against the local agent-server. On a Cloud
 * backend this returns `{ ok: false, errorType: "cloud_unsupported" }`
 * immediately, without ever calling `executeCommand`.
 */
function emptyAikSystemFile(): AikSystemFile {
  return {
    version: 1,
    systemId: "",
    phases: [],
    tasks: [],
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * A `cat` on a `system.json` that hasn't been written yet fails with exit
 * code 1 and this exact GNU coreutils message on stderr — the same failure
 * shape as any other unreadable path. Without this check, a brand-new
 * system (created but never yet synced to disk, the normal state right
 * after `createSystem`) was indistinguishable from a genuinely unreachable
 * workspace, and surfaced the same scary "workspace inacessível" error for
 * something that isn't an error at all.
 */
function isFileNotFoundError(stderr: string): boolean {
  return /no such file or directory/i.test(stderr);
}

export async function readAikSystemFile(
  workspacePath: string,
): Promise<
  { ok: true; file: AikSystemFile } | { ok: false; errorType: AikErrorType }
> {
  if (getActiveBackend().backend.kind === "cloud") {
    return { ok: false, errorType: "cloud_unsupported" };
  }
  try {
    const path = buildAikFilePath(workspacePath);
    const result = await AgentServerRuntimeService.executeCommand(
      null,
      null,
      `cat -- ${escapeSingleQuoted(path)}`,
      workspacePath,
    );
    if (result.exit_code !== 0) {
      if (isFileNotFoundError(result.stderr)) {
        return { ok: true, file: emptyAikSystemFile() };
      }
      return { ok: false, errorType: "workspace_unreachable" };
    }
    const parsed = parseAikSystemFile(result.stdout);
    if (!parsed) return { ok: false, errorType: "parse_error" };
    return { ok: true, file: parsed };
  } catch {
    return { ok: false, errorType: "workspace_unreachable" };
  }
}

/**
 * Writes `file` to `.openhands/aik/system.json` for `workspacePath`. Never
 * throws.
 *
 * Same Cloud guard as `readAikSystemFile`, checked first.
 *
 * read-modify-write (SPEC §2.4, same sequence as
 * `kanban-board-file.api.ts:200-224`): re-reads the current on-disk file
 * immediately before writing and merges it against `file` via
 * `mergeAikSystemFiles` (most recent `updatedAt` per phase/task wins),
 * instead of overwriting the whole snapshot — the agent can write this same
 * file directly (RF-09) while the browser also writes it.
 */
export async function writeAikSystemFile(
  workspacePath: string,
  file: AikSystemFile,
  tombstones?: AikMergeTombstones,
): Promise<{ ok: true } | { ok: false; errorType: AikErrorType }> {
  if (getActiveBackend().backend.kind === "cloud") {
    return { ok: false, errorType: "cloud_unsupported" };
  }
  try {
    const current = await readAikSystemFile(workspacePath);
    const merged = current.ok
      ? mergeAikSystemFiles(current.file, file, tombstones)
      : file;
    const contentBase64 = await toBase64(
      new TextEncoder().encode(JSON.stringify(merged)).buffer,
    );
    const path = buildAikFilePath(workspacePath);
    const result = await AgentServerRuntimeService.executeCommand(
      null,
      null,
      buildWriteFileCommand(path, contentBase64),
      workspacePath,
    );
    if (result.exit_code !== 0) {
      return { ok: false, errorType: "workspace_unreachable" };
    }
    return { ok: true };
  } catch {
    return { ok: false, errorType: "workspace_unreachable" };
  }
}

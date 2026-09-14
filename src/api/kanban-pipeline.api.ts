import AgentServerRuntimeService from "#/api/runtime-service/agent-server-runtime-service";
import { escapeSingleQuoted } from "#/api/kanban-sintering.api";
import { isValidFeatureSlug } from "#/utils/kanban-slug";

/**
 * Reads a feature doc (PRD/TECH/SPEC/sprint file) from the workspace
 * filesystem via `cat`, without requiring an active conversation
 * (same pattern as `kanban-card-contexto-arquivos`, TECH §1).
 *
 * Defense in depth (TECH §2.3, post-review correction): `relativePath` is
 * always built internally from a slug that was already validated by the UI
 * (`feature-slug-input.tsx`), but this function revalidates the slug again
 * here so it never depends solely on the UI having done that check —
 * e.g. state tampered with directly in devtools. If the slug embedded in
 * `relativePath` is invalid, returns `{ exists: false }` immediately,
 * without ever calling `executeCommand`.
 */
export async function readFeatureDoc(
  workspacePath: string,
  relativePath: string,
): Promise<{ exists: true; content: string } | { exists: false }> {
  // Reject any ".." path segment anywhere in relativePath. This sprint
  // does not need to support subdirectories inside a feature slug beyond
  // `sprints/`, so any ".." is treated as an attack, no exceptions.
  if (relativePath.split("/").includes("..")) {
    return { exists: false };
  }

  const slugMatch = relativePath.match(/^docs\/features\/([^/]+)\//);
  if (!slugMatch || !isValidFeatureSlug(slugMatch[1])) {
    return { exists: false };
  }

  const result = await AgentServerRuntimeService.executeCommand(
    null,
    null,
    `cat -- ${escapeSingleQuoted(`${workspacePath}/${relativePath}`)}`,
    workspacePath,
  );

  if (result.exit_code !== 0) return { exists: false };
  return { exists: true, content: result.stdout };
}

/**
 * Lists the sprint files under `docs/features/<slug>/sprints` via `ls -1`,
 * without requiring an active conversation.
 *
 * Defense in depth (TECH §2.3, post-review correction): `slug` is
 * revalidated internally with `isValidFeatureSlug` before any command is
 * built — never trusts only the UI validation. If invalid, returns `[]`
 * immediately, without ever calling `executeCommand`.
 */
export async function listFeatureSprintFiles(
  workspacePath: string,
  slug: string,
): Promise<string[]> {
  if (!isValidFeatureSlug(slug)) return [];

  const result = await AgentServerRuntimeService.executeCommand(
    null,
    null,
    `ls -1 -- ${escapeSingleQuoted(`${workspacePath}/docs/features/${slug}/sprints`)} 2>/dev/null || true`,
    workspacePath,
  );

  if (result.exit_code !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

import AgentServerRuntimeService from "#/api/runtime-service/agent-server-runtime-service";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import {
  escapeSingleQuoted,
  htmlToSimpleMarkdown,
} from "#/api/kanban-sintering.api";
import { isValidFeatureSlug } from "#/utils/kanban-slug";
import type { KanbanTask } from "#/types/kanban";

/**
 * Builds the initial user message for the conversation that will run the
 * `/featdevelop` skill for a given card (TECH §2.3). Pure function — no
 * side effects — so it is trivial to unit test presence/absence of
 * description and additional context independently of
 * `startFeatdevelopConversation`.
 */
export function buildFeatdevelopInitialMessage(
  task: KanbanTask,
  contextText: string,
  workspaceId: string,
): string {
  return [
    `Use a skill /featdevelop para planejar a feature "${task.title}" com slug "${task.featureSlug}".`,
    task.description ? `Descrição: ${task.description}` : null,
    contextText ? `Contexto adicional do usuário:\n${contextText}` : null,
    task.rejectionReason
      ? `Esta tarefa foi reprovada anteriormente pelo motivo: ${task.rejectionReason}`
      : null,
    // Only cards launched from a pipeline conversation (i.e. that already
    // have a `linkedConversationId`) need the board.json contract — a
    // brand-new card being kicked off for the first time has nothing to
    // report back yet (SPEC §2.7, CA-10). This paragraph is built purely
    // from `task` itself, never from the board/workspace's full task list,
    // so its size never grows with the number of tasks (RNF-03, CA-11).
    task.linkedConversationId
      ? [
          "Contrato do arquivo board.json: ao concluir esta tarefa, edite",
          `o arquivo \`.openhands/kanban/${workspaceId}/board.json\` (caminho`,
          "relativo à raiz do workspace) e atualize o objeto desta tarefa",
          "(procure pelo id abaixo) com o formato mínimo:",
          '```json\n{ "id": "<id da tarefa>", "boardId": "<id do quadro>", "columnId": "pending_validation" }\n```',
          `O id desta tarefa é "${task.id}" e o boardId é "${task.boardId}".`,
          'Troque explicitamente o campo "columnId" para "pending_validation"',
          "quando a tarefa estiver concluída, para que um humano possa",
          "revisar o resultado.",
        ].join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Starts a new conversation running the `/featdevelop` skill for a
 * level-1 card that already has a `featureSlug` (TECH §2.3). Never
 * throws — always resolves to a discriminated result so callers
 * (`run-agent-button.tsx`, a later sprint) can show a toast instead of
 * crashing the board.
 *
 * `AppConversationStartTask.app_conversation_id` is the id of the
 * conversation itself (`id` is the id of the creation *task*, not the
 * conversation —
 * `src/api/conversation-service/agent-server-conversation-service.types.ts:103-111`).
 * On the local backend `app_conversation_id` already comes populated equal
 * to `id`, but using the correct field avoids breaking when the Cloud
 * backend diverges the two values.
 */
export async function startFeatdevelopConversation(
  workspacePath: string,
  task: KanbanTask,
  workspaceId: string,
): Promise<
  { ok: true; conversationId: string } | { ok: false; error: string }
> {
  try {
    const contextText = htmlToSimpleMarkdown(task.userContextHtml ?? "");
    const result = await AgentServerConversationService.createConversation({
      initialUserMsg: buildFeatdevelopInitialMessage(
        task,
        contextText,
        workspaceId,
      ),
      workingDirOverride: workspacePath,
    });
    if (!result.app_conversation_id) {
      return { ok: false, error: "Conversa criada sem id retornado" };
    }
    return { ok: true, conversationId: result.app_conversation_id };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Falha ao iniciar conversa",
    };
  }
}

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

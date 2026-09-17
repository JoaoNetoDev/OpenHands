import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import type { AikPhase, AikSystem, AikTask } from "#/types/aik";
import { ProviderOptions, type Provider } from "#/types/settings";

/**
 * Builds the initial user message sent to the agent for a given AIK task
 * (SPEC §2.5). Pure function — no side effects — mirroring the shape of
 * `buildFeatdevelopInitialMessage` (`kanban-pipeline.api.ts:17-51`): a list
 * of optional paragraphs, filtered for emptiness and joined.
 *
 * Deliberately never receives the system's full phase/task list — only the
 * single `task`/`phase`/`system` it concerns — so the message size never
 * grows with how many other tasks exist in the system (RNF-03, CA-34).
 */
export function buildAikAgentBriefing(
  task: AikTask,
  phase: AikPhase,
  system: AikSystem,
  contextText: string,
): string {
  const pendingChecklistItems = (task.checklist ?? []).filter(
    (item) => !item.done,
  );

  return [
    task.agentSkill ? `Use a skill /${task.agentSkill}.` : null,
    `Tarefa: "${task.title}"`,
    task.description ? task.description : null,
    `Fase: "${phase.title}"`,
    `Sistema: "${system.name}"`,
    pendingChecklistItems.length > 0
      ? [
          "Itens pendentes do checklist:",
          ...pendingChecklistItems.map((item) => `- ${item.text}`),
        ].join("\n")
      : null,
    contextText ? contextText : null,
    task.linkedConversationId
      ? [
          "Ao concluir esta tarefa, edite `.openhands/aik/system.json` (raiz do",
          `workspace) e mova o objeto desta tarefa (id "${task.id}") para`,
          'columnId="in_review". Não altere outras tarefas.',
        ].join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Starts a new conversation running an AIK task's briefing as the initial
 * message (SPEC §2.5). Never throws — always resolves to a discriminated
 * result so callers can show feedback instead of crashing the board.
 *
 * The workspace parameter passed to `createConversation` depends on
 * `system.workspaceRef.kind` (F-SPEC-4): `createConversation`
 * (`agent-server-conversation-service.api.ts:425-460`) only directs
 * creation at a Git repository when the caller explicitly passes
 * `metadata.selected_repository`/`metadata.git_provider` — there is no
 * automatic repo detection from a path. So:
 *   - "local": `workingDirOverride: workspaceRef.path` (same param
 *     `kanban-pipeline.api.ts:83` already uses).
 *   - "cloud": `metadata: { selected_repository, git_provider }` mapped
 *     directly from `AikWorkspaceRefCloud.repository`.
 *
 * Does not touch the store — the caller (store, §2.3) is responsible for
 * updating `task.linkedConversationId`/`system.activeAgentTaskId` on
 * success, keeping this module free of a Zustand dependency, same
 * separation as `kanban-pipeline.api.ts`.
 */
export async function startAikAgentTask(
  system: AikSystem,
  phase: AikPhase,
  task: AikTask,
): Promise<
  { ok: true; conversationId: string } | { ok: false; error: string }
> {
  try {
    if (
      system.workspaceRef.kind === "cloud" &&
      !(system.workspaceRef.repository.provider in ProviderOptions)
    ) {
      return { ok: false, error: "invalid_git_provider" };
    }

    const initialUserMsg = buildAikAgentBriefing(task, phase, system, "");

    const result = await AgentServerConversationService.createConversation(
      system.workspaceRef.kind === "local"
        ? {
            initialUserMsg,
            workingDirOverride: system.workspaceRef.path,
          }
        : {
            initialUserMsg,
            metadata: {
              selected_repository: system.workspaceRef.repository.fullName,
              selected_branch: null,
              git_provider: system.workspaceRef.repository.provider as Provider,
            },
          },
    );

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
 * Starts the system-level conversation (RF-22/23) — the same workspace
 * resolution as `startAikAgentTask` above, but with no task/phase briefing:
 * just the user's own first message, exactly like starting a plain new
 * conversation against this system's workspace/repository.
 */
export async function startAikSystemConversation(
  system: AikSystem,
  initialUserMsg: string,
): Promise<
  { ok: true; conversationId: string } | { ok: false; error: string }
> {
  try {
    if (
      system.workspaceRef.kind === "cloud" &&
      !(system.workspaceRef.repository.provider in ProviderOptions)
    ) {
      return { ok: false, error: "invalid_git_provider" };
    }

    const result = await AgentServerConversationService.createConversation(
      system.workspaceRef.kind === "local"
        ? {
            initialUserMsg,
            workingDirOverride: system.workspaceRef.path,
          }
        : {
            initialUserMsg,
            metadata: {
              selected_repository: system.workspaceRef.repository.fullName,
              selected_branch: null,
              git_provider: system.workspaceRef.repository.provider as Provider,
            },
          },
    );

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

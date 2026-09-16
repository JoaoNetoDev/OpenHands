import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";
import {
  getStoredConversationMetadata,
  type WorkspaceMode,
} from "#/api/conversation-metadata-store";
import { useNavigation } from "#/context/navigation-context";
import {
  useCreateConversation,
  type CreateConversationVariables,
} from "#/hooks/mutation/use-create-conversation";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";

export interface SwitchAcpProviderVariables {
  /** The conversation whose provider is failing. */
  sourceConversationId: string;
  /** The ACP profile to start the next conversation with. */
  targetProfile: AgentProfileSummary;
}

export interface SwitchAcpProviderResult {
  /** The newly created conversation id, for callers that want to inspect it. */
  conversationId: string;
}

/**
 * Recovers from an ACP rate-limit / quota error by starting a fresh
 * conversation with a different ACP AgentProfile, carrying the source
 * conversation's repository / workspace / plugins so the new chat lands in the
 * same project. History is not copied — the agent-server has no
 * "fork + relaunch with a different wrapper" endpoint, and every ACP wrapper is
 * its own subprocess with isolated session state, so the new chat is empty by
 * design.
 *
 * Local-only for now: cloud backends do not let the client pick a different
 * ACP provider for a new conversation (#3730 / cloud app-server parity work
 * tracked separately).
 */
export const useSwitchAcpProvider = () => {
  const { navigate } = useNavigation();
  const { data: conversation } = useActiveConversation();
  const createConversation = useCreateConversation();

  return useMutation<
    SwitchAcpProviderResult,
    Error,
    SwitchAcpProviderVariables,
    // Cache the source metadata so the inner createConversation call can run
    // after the active-conversation query is invalidated by the navigation.
    { metadata: ReturnType<typeof getStoredConversationMetadata> | null }
  >({
    mutationKey: ["switch-acp-provider"],
    onMutate: ({ sourceConversationId }) => ({
      metadata: getStoredConversationMetadata(sourceConversationId),
    }),
    mutationFn: async ({
      sourceConversationId,
      targetProfile,
    }: SwitchAcpProviderVariables) => {
      if (targetProfile.agent_kind !== "acp") {
        throw new Error(
          "Switch provider only supports ACP profiles; the chosen profile is not ACP.",
        );
      }
      if (!targetProfile.id) {
        throw new Error("Target profile is missing a stable id.");
      }

      const metadata = getStoredConversationMetadata(sourceConversationId);
      const sourceIsActive =
        conversation?.id === sourceConversationId ? conversation : null;

      const variables: CreateConversationVariables = {
        agentProfileId: targetProfile.id,
        // Mark the new conversation as spawned from this recovery flow so
        // analytics can attribute it separately from a profile picker pick.
        entryPoint: "error_banner_switch_acp_provider",
        parentConversationId: sourceConversationId,
      };

      const repo =
        sourceIsActive?.selected_repository ?? metadata?.selected_repository;
      const branch =
        sourceIsActive?.selected_branch ?? metadata?.selected_branch ?? null;
      const gitProvider =
        sourceIsActive?.git_provider ?? metadata?.git_provider ?? null;
      if (repo) {
        variables.repository = {
          name: repo,
          gitProvider: gitProvider ?? "github",
          branch: branch ?? undefined,
        };
      }

      const workspace =
        sourceIsActive?.selected_workspace ??
        metadata?.selected_workspace ??
        null;
      if (workspace) {
        variables.workingDir = workspace;
        const mode = metadata?.workspace_mode as WorkspaceMode | undefined;
        variables.workspaceMode = mode ?? "local_repo";
      }

      const plugins = metadata?.plugins ?? [];
      if (plugins.length > 0) {
        variables.plugins = plugins;
      }

      const data = await createConversation.mutateAsync(variables);
      return { conversationId: data.conversation_id };
    },
    onSuccess: ({ conversationId }) => {
      navigate(`/conversations/${conversationId}`);
    },
  });
};

/**
 * Convenience wrapper that returns a stable callback matching the
 * `(profile) => void` shape the error-banner menu renders, instead of the raw
 * `mutate` API. The caller still has to own the source conversation id (the
 * banner already has it from the active-conversation context).
 */
export const useSwitchAcpProviderCallback = (sourceConversationId: string) => {
  const switchProvider = useSwitchAcpProvider();
  const { mutate, isPending } = switchProvider;
  return useCallback(
    (targetProfile: AgentProfileSummary) => {
      if (isPending) return;
      mutate({ sourceConversationId, targetProfile });
    },
    [sourceConversationId, mutate, isPending],
  );
};

// Re-export so callers can guard on the same key the hook uses (the mutation
// hot path checks it to disable the menu while a switch is in flight).
export const SWITCH_ACP_PROVIDER_MUTATION_KEY = [
  "switch-acp-provider",
] as const;

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { retrieveAxiosErrorMessage } from "#/utils/retrieve-axios-error-message";
import { I18nKey } from "#/i18n/declaration";
import type { ReasoningEffort } from "#/utils/conversation-local-storage";
import { setConversationState } from "#/utils/conversation-local-storage";
import { invalidateConversationQueries } from "./conversation-mutation-utils";

interface SwitchReasoningEffortVars {
  conversationId: string;
  profileName: string;
  reasoningEffort: ReasoningEffort | null;
}

export const SWITCH_REASONING_EFFORT_MUTATION_KEY = ["switch-reasoning-effort"];

/**
 * Switches only the running conversation's `reasoning_effort`, leaving the
 * active LLM profile (and the user's global default) untouched. Local
 * backend only — see
 * {@link AgentServerConversationService.switchReasoningEffort}.
 *
 * The chosen value is persisted per-conversation in localStorage (not
 * `agent_settings`) so it survives a reload and keeps showing as selected
 * in the picker, mirroring how `conversationMode` is stored.
 */
export const useSwitchReasoningEffort = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationKey: SWITCH_REASONING_EFFORT_MUTATION_KEY,
    mutationFn: ({
      conversationId,
      profileName,
      reasoningEffort,
    }: SwitchReasoningEffortVars) =>
      AgentServerConversationService.switchReasoningEffort(
        conversationId,
        profileName,
        reasoningEffort === null ? undefined : reasoningEffort,
      ),
    meta: { disableToast: true },
    onError: (error) => {
      const fallback = t(I18nKey.ERROR$GENERIC);
      displayErrorToast(retrieveAxiosErrorMessage(error) || fallback);
    },
    onSuccess: (_data, { conversationId, reasoningEffort }) => {
      setConversationState(conversationId, { reasoningEffort });
      invalidateConversationQueries(queryClient, conversationId);
    },
  });
};

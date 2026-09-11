import { useIsMutating } from "@tanstack/react-query";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  useConversationLocalStorageState,
  type ReasoningEffort,
} from "#/utils/conversation-local-storage";
import {
  useSwitchReasoningEffort,
  SWITCH_REASONING_EFFORT_MUTATION_KEY,
} from "#/hooks/mutation/use-switch-reasoning-effort";

export const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
];

export interface ChatInputReasoningEffortState {
  /**
   * Whether the picker should render at all. False on cloud backends (no
   * server-side switch endpoint yet), outside a conversation, or when the
   * running conversation's LLM profile isn't known.
   */
  isAvailable: boolean;
  /** `null` means "use the profile's / global default effort". */
  currentEffort: ReasoningEffort | null;
  isSwitching: boolean;
  selectEffort: (effort: ReasoningEffort | null) => void;
}

/**
 * Backs the per-conversation reasoning-effort picker in the chat input.
 * Overlays `reasoning_effort` onto the conversation's active LLM profile via
 * `switchLLM` (see `useSwitchReasoningEffort`) without ever writing to the
 * user's global `agent_settings` — the global setting stays the default for
 * new conversations.
 */
export function useChatInputReasoningEffortState(
  profileName: string | null,
): ChatInputReasoningEffortState {
  const { conversationId } = useOptionalConversationId();
  const { backend } = useActiveBackend();
  const { state } = useConversationLocalStorageState(conversationId ?? "");
  const switchReasoningEffort = useSwitchReasoningEffort();
  const isSwitching =
    useIsMutating({ mutationKey: SWITCH_REASONING_EFFORT_MUTATION_KEY }) > 0;

  const isAvailable =
    backend.kind !== "cloud" && !!conversationId && !!profileName;

  const selectEffort = (effort: ReasoningEffort | null) => {
    if (!isAvailable || !conversationId || !profileName) return;
    if (effort === (state.reasoningEffort ?? null)) return;
    switchReasoningEffort.mutate({
      conversationId,
      profileName,
      reasoningEffort: effort,
    });
  };

  return {
    isAvailable,
    currentEffort: isAvailable ? (state.reasoningEffort ?? null) : null,
    isSwitching,
    selectEffort,
  };
}

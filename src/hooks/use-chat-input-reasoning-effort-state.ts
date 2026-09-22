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
   * server-side switch endpoint yet) or outside a conversation. Independent of
   * the active profile being known — at conversation start the profile is
   * resolved lazily (stamped metadata + model match + account default), so the
   * picker renders immediately and disables its items until that lands.
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

  // Show the picker as soon as we're in a conversation on a local backend —
  // the active profile is resolved lazily, and gating on `profileName` made
  // the picker pop in only after the first turn (the conversation's stamped
  // active_profile is set by the agent's first response). Consumers should
  // disable individual items while `profileName` is still null — `selectEffort`
  // is a no-op until then.
  const isAvailable = backend.kind !== "cloud" && !!conversationId;

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

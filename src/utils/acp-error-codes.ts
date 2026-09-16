import { I18nKey } from "#/i18n/declaration";
import { ExecutionStatus } from "#/types/agent-server/core/base/common";

/**
 * Structured `code` values the SDK's ACPAgent puts on a ConversationErrorEvent
 * (see software-agent-sdk `acp_agent.py`). The banner uses them to show a
 * code-specific header and, for credential failures, a recovery action.
 */
export const ACP_AUTH_REQUIRED_CODE = "ACPAuthRequired";

const ACP_ERROR_HEADER_KEYS: Record<string, I18nKey> = {
  ACPAuthRequired: I18nKey.ERROR$ACP_AUTH_REQUIRED_TITLE,
  // Spawn/init/prompt/usage-policy failures share the generic "Agent error"
  // header; their detail already carries the specific cause.
  ACPSpawnError: I18nKey.CHAT_INTERFACE$AGENT_ERROR_MESSAGE,
  ACPInitError: I18nKey.CHAT_INTERFACE$AGENT_ERROR_MESSAGE,
  ACPPromptError: I18nKey.CHAT_INTERFACE$AGENT_ERROR_MESSAGE,
  UsagePolicyRefusal: I18nKey.CHAT_INTERFACE$AGENT_ERROR_MESSAGE,
};

/** Localized header key for an error code, or null when the code is unknown. */
export function getAcpErrorHeaderKey(code?: string | null): I18nKey | null {
  if (!code) return null;
  return ACP_ERROR_HEADER_KEYS[code] ?? null;
}

/** Whether the error is a credential failure that warrants a re-auth action. */
export function isAcpAuthErrorCode(code?: string | null): boolean {
  return code === ACP_AUTH_REQUIRED_CODE;
}

/**
 * Minimal conversation shape the ACP recovery gate needs. Both
 * `SharedConversation` (returned by `useUserConversation`) and the full
 * `AppConversation` payload expose `acp_server` and `execution_status`; we
 * deliberately accept a loose shape here to avoid coupling to one of them.
 *
 * `acp_server` is the agent-server's authoritative ACP detector — it is
 * stamped from `info.tags.acpserver` (see
 * `agent-server-conversation-service.types.ts`) and survives across both
 * REST and Cloud responses. `agent_kind === "acp"` is honored as a fallback
 * for endpoint responses that include the discriminated agent payload but no
 * `acp_server` tag.
 */
export interface AcpRecoveryConversationShape {
  acp_server?: string | null;
  agent_kind?: string | null;
  execution_status?: ExecutionStatus | string | null;
}

/**
 * Whether the error banner should surface the "switch provider" recovery
 * action. Triggers on **any** conversation error on an ACP conversation, as
 * long as the agent is not currently running a turn — the user should always
 * be able to fork a stuck / failed / limit-hit ACP conversation into a fresh
 * one with a different provider without losing the workspace / repo.
 *
 * `RUNNING` is the only "agent is mid-turn" state; every other state
 * (`WAITING_FOR_CONFIRMATION`, `FINISHED`, `PAUSED`, `ERROR`, `STUCK`,
 * `IDLE`) means a new conversation can be safely started.
 */
export function canShowAcpProviderSwitch(
  conversation: AcpRecoveryConversationShape | null | undefined,
): boolean {
  if (!conversation) return false;
  const isAcp = !!conversation.acp_server || conversation.agent_kind === "acp";
  if (!isAcp) return false;
  return conversation.execution_status !== ExecutionStatus.RUNNING;
}

import React from "react";
import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { Typography } from "#/ui/typography";
import { ComboboxCaretInline } from "#/ui/combobox-caret";
import { StyledTooltip } from "#/components/shared/buttons/styled-tooltip";
import {
  formControlMutedHoverClassName,
  formControlTransitionClassName,
} from "#/utils/form-control-classes";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";
import { useSwitchAcpProviderCallback } from "#/hooks/mutation/use-switch-acp-provider";
import { canShowAcpProviderSwitch } from "#/utils/acp-error-codes";
import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";
import { SwitchAcpProviderContextMenu } from "./switch-acp-provider-context-menu";

/**
 * Persistent "switch ACP provider" affordance in the chat input row. Unlike the
 * recovery action in `ErrorMessageBanner` (which only appears when the
 * conversation is in a non-RUNNING error state), this button is always visible
 * while the active conversation is an ACP chat and the user has at least one
 * other ACP profile configured. Clicking opens a popover of those profiles;
 * selecting one forks the active conversation onto a new chat running the
 * chosen provider, carrying over workspace / repository / branch / plugins.
 *
 * History is not copied — the agent-server has no "fork + relaunch with a
 * different wrapper" endpoint, and every ACP wrapper is its own subprocess
 * with isolated session state. The new chat starts empty by design; this
 * button is for picking up the same project with a different model / vendor,
 * not for resuming the prior session verbatim.
 */
export function SwitchAcpProviderButton() {
  const [open, setOpen] = React.useState(false);
  const { conversationId } = useOptionalConversationId();
  const { data: conversation } = useActiveConversation();
  const { data: profilesData } = useAgentProfiles();
  const sourceId = conversation?.id ?? conversationId ?? "";
  const switchProvider = useSwitchAcpProviderCallback(sourceId);
  const { t } = useTranslation("openhands");

  const isAvailable = canShowAcpProviderSwitch(conversation);

  const otherAcpProfiles = React.useMemo<AgentProfileSummary[]>(() => {
    const currentId = profilesData?.active_agent_profile_id ?? null;
    return (profilesData?.profiles ?? []).filter(
      (profile) =>
        profile.agent_kind === "acp" &&
        profile.id != null &&
        profile.id !== currentId,
    );
  }, [profilesData]);

  if (!isAvailable || otherAcpProfiles.length === 0) {
    return null;
  }

  const currentProfileName =
    profilesData?.profiles.find(
      (p) => p.id === profilesData.active_agent_profile_id,
    )?.name ?? null;

  const handleSelect = (target: AgentProfileSummary) => {
    setOpen(false);
    switchProvider(target);
  };

  const button = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="switch-acp-provider-trigger"
        className={cn(
          "flex items-center rounded-[100px] border border-transparent",
          "text-[var(--oh-muted)] cursor-pointer",
          formControlTransitionClassName,
          formControlMutedHoverClassName,
        )}
      >
        <div className="flex items-center gap-1 pl-1.5">
          <Repeat className="h-[14px] w-[14px] shrink-0" aria-hidden />
          <Typography.Text className="text-2.75 not-italic font-normal leading-5">
            {currentProfileName ?? t(I18nKey.ERROR$ACP_SWITCH_PROVIDER_BUTTON)}
          </Typography.Text>
        </div>
        <ComboboxCaretInline isOpen={open} />
      </button>
      {open && (
        <SwitchAcpProviderContextMenu
          profiles={otherAcpProfiles}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );

  return (
    <StyledTooltip
      content={t(I18nKey.CHAT$SWITCH_ACP_PROVIDER_TOOLTIP)}
      placement="top"
    >
      {button}
    </StyledTooltip>
  );
}

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { ContextMenu } from "#/ui/context-menu";
import { ContextMenuListItem } from "../context-menu/context-menu-list-item";
import { ContextMenuIconTextWithDescription } from "../context-menu/context-menu-icon-text-with-description";
import { useClickOutsideElement } from "#/hooks/use-click-outside-element";
import RobotIcon from "#/icons/robot.svg?react";
import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";

interface SwitchAcpProviderContextMenuProps {
  profiles: AgentProfileSummary[];
  onSelect: (profile: AgentProfileSummary) => void;
  onClose: () => void;
}

/**
 * Popover body for `SwitchAcpProviderButton`. Lists every configured ACP
 * profile except the active one; selecting one delegates to the parent which
 * runs the mutation + navigation. `useClickOutsideElement` closes on
 * outside-click so the popover never lingers after the user moves on.
 */
export function SwitchAcpProviderContextMenu({
  profiles,
  onSelect,
  onClose,
}: SwitchAcpProviderContextMenuProps) {
  const { t } = useTranslation("openhands");
  const menuRef = useClickOutsideElement<HTMLUListElement>(onClose);

  const handleSelect =
    (profile: AgentProfileSummary) =>
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(profile);
    };

  return (
    <ContextMenu
      ref={menuRef}
      testId="switch-acp-provider-menu"
      position="top"
      alignment="left"
      className="min-h-fit mb-2 min-w-[240px] max-w-[320px] max-h-[60vh] overflow-y-auto"
    >
      {profiles.map((profile) => (
        <ContextMenuListItem
          key={profile.id ?? profile.name}
          testId={`switch-acp-provider-option-${profile.id ?? profile.name}`}
          onClick={handleSelect(profile)}
        >
          <ContextMenuIconTextWithDescription
            icon={RobotIcon}
            title={profile.name}
            description={t(I18nKey.CHAT$SWITCH_ACP_PROVIDER_FORK_HINT)}
            isActive={false}
          />
        </ContextMenuListItem>
      ))}
    </ContextMenu>
  );
}

import React from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleX,
  Copy,
  X,
} from "lucide-react";
import { OH_STATUS_ERROR_COLOR } from "#/constants/status-colors";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import {
  SWITCH_ACP_PROVIDER_MUTATION_KEY,
  useSwitchAcpProviderCallback,
} from "#/hooks/mutation/use-switch-acp-provider";
import { useIsMutating } from "@tanstack/react-query";
import { useClickOutsideElement } from "#/hooks/use-click-outside-element";
import { I18nKey } from "#/i18n/declaration";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { getAcpErrorHeaderKey } from "#/utils/acp-error-codes";
import { cn } from "#/utils/utils";
import type { ErrorClassification } from "@openhands/typescript-client";

interface ErrorMessageBannerProps {
  message: string;
  /** Structured error code (e.g. "ACPAuthRequired") used to pick a header. */
  code?: string | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  /** Recovery action (e.g. re-authenticate) shown for credential failures. */
  onReauth?: () => void;
  classification?: ErrorClassification | null;
  /**
   * Whether the current conversation is an ACP conversation that hit a
   * recoverable provider failure (rate-limit / quota). When true, the banner
   * surfaces a "Switch provider" menu that lets the user pick one of the
   * configured ACP profiles and start a fresh conversation with it.
   */
  canSwitchAcpProvider?: boolean;
}

const DEFAULT_MAX_COLLAPSED_CHARS = 220;

export function ErrorMessageBanner({
  message,
  code,
  onDismiss,
  onRetry,
  onReauth,
  classification,
  canSwitchAcpProvider,
}: ErrorMessageBannerProps) {
  const { t, i18n } = useTranslation("openhands");
  const headerKey = getAcpErrorHeaderKey(code);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isMultiLine, setIsMultiLine] = React.useState(false);
  const [isProviderMenuOpen, setIsProviderMenuOpen] = React.useState(false);
  const providerMenuRef = useClickOutsideElement<HTMLDivElement>(() =>
    setIsProviderMenuOpen(false),
  );
  const [isCopied, setIsCopied] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);

  const { conversationId: sourceConversationId } = useOptionalConversationId();
  const switchAcpProvider = useSwitchAcpProviderCallback(
    sourceConversationId ?? "",
  );
  const switchingAcpProviderCount = useIsMutating({
    mutationKey: SWITCH_ACP_PROVIDER_MUTATION_KEY,
  });
  // Lazy-load the ACP profile list only while the menu is open, so a banner
  // that never opens the menu does not cost an extra GET.
  const { data: agentProfiles } = useAgentProfiles({
    enabled: canSwitchAcpProvider === true && isProviderMenuOpen,
  });
  const acpProfiles = React.useMemo(
    () =>
      (agentProfiles?.profiles ?? []).filter(
        (profile) => profile.agent_kind === "acp",
      ),
    [agentProfiles?.profiles],
  );
  const showSwitchProvider =
    canSwitchAcpProvider === true && Boolean(sourceConversationId);
  const isSwitchingProvider = switchingAcpProviderCount > 0;

  const isI18nKey = i18n.exists(message, { ns: "openhands" });
  const displayTextForLength = isI18nKey ? String(t(message)) : message;
  const shouldShowToggle =
    displayTextForLength.length > DEFAULT_MAX_COLLAPSED_CHARS;

  const isCollapsed = shouldShowToggle && !isExpanded;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayTextForLength);
      setIsCopied(true);
    } catch {
      displayErrorToast(t(I18nKey.CHAT_INTERFACE$CHAT_MESSAGE_COPY_FAILED));
    }
  };

  React.useEffect(() => {
    if (!isCopied) return undefined;

    const timeout = setTimeout(() => {
      setIsCopied(false);
    }, 2000);

    return () => clearTimeout(timeout);
  }, [isCopied]);

  React.useEffect(() => {
    setIsCopied(false);
  }, [displayTextForLength]);

  React.useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return undefined;
    }

    const updateIsMultiLine = () => {
      const lineHeight = Number.parseFloat(
        getComputedStyle(content).lineHeight,
      );
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        setIsMultiLine(false);
        return;
      }

      setIsMultiLine(content.getBoundingClientRect().height > lineHeight * 1.5);
    };

    updateIsMultiLine();

    const observer = new ResizeObserver(updateIsMultiLine);
    observer.observe(content);

    return () => observer.disconnect();
  }, [displayTextForLength, isCollapsed, isExpanded, message]);

  return (
    <div
      className={cn(
        "flex w-full gap-2 rounded-lg border border-border bg-surface-raised p-2 text-foreground",
        isMultiLine ? "items-start" : "items-center",
      )}
      data-testid="error-message-banner"
    >
      {classification != null &&
      classification.kind !== "internal" &&
      classification.kind !== "unknown" ? (
        <CircleAlert
          aria-hidden
          className="h-4 w-4 shrink-0 text-warning"
          strokeWidth={2}
          data-testid="warning-message-banner-icon"
        />
      ) : (
        <CircleX
          aria-hidden
          className="h-4 w-4 shrink-0"
          strokeWidth={2}
          style={{ color: OH_STATUS_ERROR_COLOR }}
          data-testid="error-message-banner-icon"
        />
      )}
      <div className="min-w-0 flex-1">
        {headerKey && (
          <div
            className="text-sm font-medium text-foreground"
            data-testid="error-message-banner-header"
          >
            {t(headerKey)}
          </div>
        )}
        <div
          ref={contentRef}
          className={cn(
            "whitespace-pre-wrap break-words text-sm text-muted",
            isCollapsed && "line-clamp-3",
          )}
          data-testid="error-message-banner-content"
        >
          {isI18nKey ? <Trans ns="openhands" i18nKey={message} /> : message}
        </div>

        {onReauth && (
          <button
            type="button"
            onClick={onReauth}
            className="mt-2 cursor-pointer rounded-md border border-border px-2 py-1 text-xs font-normal text-foreground hover:bg-interactive-hover"
            data-testid="error-message-banner-reauth"
          >
            {t(I18nKey.ERROR$ACP_UPDATE_CREDENTIALS)}
          </button>
        )}

        {showSwitchProvider && (
          <div ref={providerMenuRef} className="relative mt-2 inline-block">
            <button
              type="button"
              disabled={isSwitchingProvider}
              onClick={() => setIsProviderMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={isProviderMenuOpen}
              className="cursor-pointer rounded-md border border-[var(--oh-border)] px-2 py-1 text-xs font-normal text-[var(--oh-foreground)] hover:bg-[var(--oh-interactive-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="error-message-banner-switch-provider"
            >
              {t(I18nKey.ERROR$ACP_SWITCH_PROVIDER_BUTTON)}
              <ChevronDown
                className="ml-1 inline h-3 w-3"
                aria-hidden
                strokeWidth={2}
              />
            </button>
            {isProviderMenuOpen && (
              <div
                role="menu"
                aria-label={t(I18nKey.ERROR$ACP_SWITCH_PROVIDER_MENU_LABEL)}
                className="absolute left-0 top-full z-20 mt-1 min-w-[12rem] rounded-md border border-[var(--oh-border-subtle)] bg-tertiary py-1 shadow-lg"
                data-testid="error-message-banner-switch-provider-menu"
              >
                {acpProfiles.length === 0 ? (
                  <div
                    className="px-3 py-2 text-xs text-[var(--oh-muted)]"
                    data-testid="error-message-banner-switch-provider-empty"
                  >
                    {t(I18nKey.ERROR$ACP_SWITCH_PROVIDER_PROMPT)}
                  </div>
                ) : (
                  acpProfiles.map((profile) => (
                    <button
                      key={profile.id ?? profile.name}
                      type="button"
                      role="menuitem"
                      disabled={isSwitchingProvider}
                      onClick={() => {
                        setIsProviderMenuOpen(false);
                        switchAcpProvider(profile);
                      }}
                      className="block w-full cursor-pointer px-3 py-1.5 text-left text-xs text-[var(--oh-foreground)] hover:bg-[var(--oh-interactive-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid={`error-message-banner-switch-provider-option-${profile.name}`}
                    >
                      {profile.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {shouldShowToggle && (
          <button
            type="button"
            className="mt-1 cursor-pointer text-xs font-normal text-foreground underline"
            onClick={() => setIsExpanded((prev) => !prev)}
            data-testid="error-message-banner-toggle"
          >
            {isExpanded
              ? t(I18nKey.COMMON$VIEW_LESS)
              : t(I18nKey.COMMON$VIEW_MORE)}
          </button>
        )}
      </div>

      <div
        className={cn(
          "flex shrink-0 gap-1",
          isMultiLine ? "self-start" : "items-center",
        )}
      >
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs font-normal text-foreground hover:bg-interactive-hover"
            data-testid="error-message-banner-retry"
          >
            {t(I18nKey.CHAT_INTERFACE$MESSAGE_RETRY)}
          </button>
        )}

        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 cursor-pointer rounded-md p-1 text-muted hover:bg-interactive-hover hover:text-foreground"
          aria-label={t(isCopied ? I18nKey.BUTTON$COPIED : I18nKey.BUTTON$COPY)}
          data-testid="error-message-banner-copy"
        >
          {isCopied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
        </button>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 cursor-pointer rounded-md p-1 text-muted hover:bg-interactive-hover hover:text-foreground"
            aria-label={t(I18nKey.BUTTON$CLOSE)}
            data-testid="error-message-banner-dismiss"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useBtwStore } from "#/stores/btw-store";
import { GenericEventMessage } from "./generic-event-message";
import { GotItButton } from "./got-it-button";

export interface BtwMessagesProps {
  conversationId: string | null | undefined;
}

export function BtwMessages({ conversationId }: BtwMessagesProps) {
  const { t } = useTranslation("openhands");
  const entriesById = useBtwStore((s) => s.entriesByConversation);
  const dismiss = useBtwStore((s) => s.dismiss);
  const entries = conversationId ? (entriesById[conversationId] ?? []) : [];

  if (!conversationId || entries.length === 0) return null;

  return (
    <div
      data-testid="btw-messages"
      // Cap height + internal scroll: a long /btw response (e.g. a markdown
      // table) would otherwise grow the sibling `InteractiveChatBox` (the
      // composer/textarea) below the visible viewport, hiding it entirely.
      // The companion parent in chat-interface.tsx is `shrink-0`, so this
      // sized-by-content behavior is exactly what tipped the textarea off-
      // screen — see the bug report ("BTW questions hide the textarea and
      // don't scroll"). The cap is viewport-relative so it scales with the
      // chat panel.
      className="custom-scrollbar-always flex max-h-[40vh] flex-col w-full overflow-y-auto"
    >
      {entries.map((entry) => {
        const isPending = entry.status === "pending";
        return (
          <GenericEventMessage
            key={entry.id}
            title={
              <span className="flex items-center gap-2">
                <span className="opacity-60">
                  {t(I18nKey.CHAT_INTERFACE$BTW_PREFIX)}
                </span>
                <span>{entry.question}</span>
                {isPending && (
                  <span
                    data-testid="btw-spinner"
                    className="inline-block w-3.5 h-3.5 ml-2 rounded-full border-2 border-transparent border-t-border-input animate-spin"
                  />
                )}
              </span>
            }
            details={
              isPending
                ? t(I18nKey.CHAT_INTERFACE$BTW_WAITING_FOR_ANSWER)
                : (entry.response ?? "")
            }
            initiallyExpanded={!isPending}
            chevronPosition="before"
            titleTrailing={
              !isPending && (
                <GotItButton
                  onClick={() => dismiss(conversationId, entry.id)}
                />
              )
            }
          />
        );
      })}
    </div>
  );
}

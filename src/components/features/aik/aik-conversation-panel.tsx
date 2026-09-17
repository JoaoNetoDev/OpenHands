import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { useAikBoardStore } from "#/stores/aik-board-store";
import { startAikSystemConversation } from "#/api/aik-pipeline.api";
import { WebSocketProviderWrapper } from "#/contexts/websocket-provider-wrapper";
import { EventHandler } from "#/wrapper/event-handler";
import { ConversationOverviewDrawerProvider } from "#/components/features/conversation/conversation-overview-drawer-context";
import { ConversationMain } from "#/components/features/conversation/conversation-main/conversation-main";
import {
  NavigationProvider,
  useNavigation,
} from "#/context/navigation-context";
import { BrandButton } from "#/components/features/settings/brand-button";
import { LoadingSpinner } from "#/components/shared/loading-spinner";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { I18nKey } from "#/i18n/declaration";

export interface AikConversationPanelProps {
  systemId: string;
  taskId?: string;
}

/**
 * Reaproveita o pacote de conversa real (TECH §2.5): `WebSocketProviderWrapper`
 * + `EventHandler` + `ConversationOverviewDrawerProvider` + `ConversationMain`,
 * do jeito que `routes/conversation.tsx` já compõe, mas com o `conversationId`
 * resolvido localmente (sistema ou tarefa) em vez de vir do param de URL
 * `conversations/:conversationId`.
 *
 * Os componentes internos do pacote lêem `conversationId` de
 * `useConversationId()`/`useOptionalConversationId()`, que por sua vez lêem
 * do `NavigationContext` global (`src/context/navigation-context.tsx`),
 * populado em `root-layout.tsx` a partir do match de rota real — que nunca
 * inclui um param `conversationId` nas rotas `__aik`. Por isso este painel
 * precisa sobrepor localmente o `NavigationContext` com o `conversationId`
 * resolvido, senão os hooks internos do pacote (ex.: `useActiveConversation`)
 * ficariam sem id.
 */
export function AikConversationPanel({
  systemId,
  taskId,
}: AikConversationPanelProps): JSX.Element {
  const { t } = useTranslation("openhands");
  const parentNavigation = useNavigation();
  const setSystemMainConversationId = useAikBoardStore(
    (state) => state.setSystemMainConversationId,
  );
  const [draft, setDraft] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const system = useAikBoardStore((state) =>
    state.systems.find((s) => s.id === systemId),
  );
  const task = useAikBoardStore((state) =>
    taskId
      ? (state.tasksBySystemId[systemId] ?? []).find((tk) => tk.id === taskId)
      : undefined,
  );

  const conversationId = taskId
    ? task?.linkedConversationId
    : system?.mainConversationId;

  const handleStartSystemConversation = async () => {
    if (!system || !draft.trim() || isStarting) return;
    setIsStarting(true);
    const result = await startAikSystemConversation(system, draft.trim());
    setIsStarting(false);
    if (result.ok) {
      setSystemMainConversationId(systemId, result.conversationId);
    } else {
      displayErrorToast(result.error);
    }
  };

  if (!conversationId) {
    // RF-22: sem conversa ainda — apenas a conversa do sistema (não a de
    // uma tarefa) pode ser iniciada por aqui; a conversa de tarefa nasce ao
    // clicar em Executar (startAgent), não por um composer solto.
    if (taskId) {
      return (
        <div data-testid="aik-conversation-panel-empty">
          {t(I18nKey.AIK$CONVERSATION_PANEL_EMPTY)}
        </div>
      );
    }
    return (
      <div
        data-testid="aik-conversation-panel-empty"
        className="flex flex-col gap-2"
      >
        <p className="text-sm text-muted">
          {t(I18nKey.AIK$CONVERSATION_PANEL_EMPTY)}
        </p>
        <textarea
          data-testid="aik-conversation-panel-start-input"
          className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
          placeholder={t(I18nKey.AIK$CONVERSATION_PANEL_START_PLACEHOLDER)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isStarting}
          rows={3}
        />
        <BrandButton
          testId="aik-conversation-panel-start-button"
          type="button"
          variant="primary"
          isDisabled={!draft.trim() || isStarting}
          startContent={
            isStarting ? <LoadingSpinner size="small" /> : undefined
          }
          onClick={() => void handleStartSystemConversation()}
        >
          {t(I18nKey.AIK$CONVERSATION_PANEL_START_BUTTON)}
        </BrandButton>
      </div>
    );
  }

  // Troca de `taskId` (e portanto de `conversationId`) precisa desmontar e
  // remontar o pacote inteiro — o socket não sobrevive à troca, mesmo
  // comportamento de navegar entre `/conversations/:id` diferentes. A `key`
  // força isso de forma determinística.
  return (
    <NavigationProvider
      key={`${taskId ?? "system"}:${conversationId}`}
      value={{ ...parentNavigation, conversationId }}
    >
      <div data-testid="aik-conversation-panel">
        <WebSocketProviderWrapper conversationId={conversationId}>
          <EventHandler>
            <ConversationOverviewDrawerProvider>
              <ConversationMain />
            </ConversationOverviewDrawerProvider>
          </EventHandler>
        </WebSocketProviderWrapper>
      </div>
    </NavigationProvider>
  );
}

export default AikConversationPanel;

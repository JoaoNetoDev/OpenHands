import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useAikBoardStore } from "#/stores/aik-board-store";
import { WebSocketProviderWrapper } from "#/contexts/websocket-provider-wrapper";
import { EventHandler } from "#/wrapper/event-handler";
import { ConversationOverviewDrawerProvider } from "#/components/features/conversation/conversation-overview-drawer-context";
import { ConversationMain } from "#/components/features/conversation/conversation-main/conversation-main";
import {
  NavigationProvider,
  useNavigation,
} from "#/context/navigation-context";
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

  if (!conversationId) {
    // RF-22: sem conversa ainda — a criação sob demanda na primeira
    // mensagem fica para uma sprint de UI de composer (fora do escopo desta
    // sprint, que só monta o pacote reaproveitado quando já existe um id).
    return (
      <div data-testid="aik-conversation-panel-empty">
        {t(I18nKey.AIK$CONVERSATION_PANEL_EMPTY)}
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

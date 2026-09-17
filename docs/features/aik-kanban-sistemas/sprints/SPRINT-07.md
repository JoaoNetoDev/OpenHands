# SPRINT-07 — Shell do AIK e painel de conversa

## Objetivo
Montar o layout real do AIK (breadcrumb + outlet + painel de conversa),
substituindo o placeholder do SPRINT-02, e o painel de conversa que alterna
entre a conversa do sistema e a de uma tarefa em execução.

## Depende de
SPRINT-02 (`aik-routes.tsx`/`host-gate.tsx`), SPRINT-06 (`aik-board-store`),
SPRINT-05 (`AikBreadcrumb`)

## Onda
4

## Arquivos previstos
- `src/routes/aik/aik-layout.tsx` — alterar — reescreve o stub criado pelo
  SPRINT-02 (único sprint que toca este arquivo depois do SPRINT-02, sem
  editar `aik-routes.tsx`) com a versão real: `<AikBreadcrumb/>` +
  `<Outlet/>` + `<AikConversationPanel/>`, chama `startPolling(systemId)`
  no mount, `stop()` no unmount/troca de `systemId` (SPEC §2.1/§2.3)
- `src/components/features/aik/aik-conversation-panel.tsx` — criar — props
  `{ systemId: string; taskId?: string }`, monta o pacote
  `WebSocketProviderWrapper` + `EventHandler` +
  `ConversationOverviewDrawerProvider` + `ConversationMain` (TECH §2.5),
  alternando `conversationId` entre `system.mainConversationId` (sem
  `taskId`) e `task.linkedConversationId` (com `taskId`)
- `src/components/features/aik/aik-conversation-panel.test.tsx` — criar
- `src/routes/aik/aik-layout.test.tsx` — criar

## Passos de implementação
1. `AikLayout` resolve `systemId` de `useParams()`, chama
   `useAikBoardStore().startPolling(systemId)` em `useEffect`, limpando no
   cleanup.
2. `AikConversationPanel` monta o pacote de conversa reaproveitado (TECH
   §2.5) com o `conversationId` resolvido pela prop `taskId` — troca de
   `taskId` desmonta e remonta o pacote (o socket não sobrevive à troca,
   mesmo comportamento de navegar entre `/conversations/:id` diferentes).
3. Sem `mainConversationId` ainda: painel mostra estado "iniciar conversa"
   que cria a conversa sob demanda na primeira mensagem (RF-22, sem criar
   no cadastro do sistema).

## Testes obrigatórios
- `AikLayout`: polling inicia no mount, para no unmount (fake timers +
  spy em `syncFromFile`).
- `AikConversationPanel`: alterna `conversationId` corretamente entre modo
  sistema e modo tarefa; troca de `taskId` remonta o pacote de conversa.

## Critérios de aceitação
- [ ] CA-20, CA-22, CA-23, CA-25 (mecanismo de polling em uso real)

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/routes/aik/aik-layout.test.tsx src/components/features/aik/aik-conversation-panel.test.tsx
```

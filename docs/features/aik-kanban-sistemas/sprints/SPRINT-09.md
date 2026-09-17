# SPRINT-09 — Kanban de fases

## Objetivo
Tela de fases de um sistema, com coluna sempre derivada das tarefas
filhas — nunca arrastável manualmente.

## Depende de
SPRINT-02 (`aik-routes.tsx`), SPRINT-06 (`aik-board-store`)

## Onda
4

## Arquivos previstos
- `src/routes/aik/aik-phases-board.tsx` — alterar — reescreve o stub
  criado pelo SPRINT-02 (único sprint que toca este arquivo depois do
  SPRINT-02, sem editar `aik-routes.tsx`)
- `src/components/features/aik/delete-phase-confirm-dialog.tsx` — criar —
  mesmo padrão de `delete-task-confirm-dialog.tsx`, bloqueia exclusão se
  alguma tarefa filha tem run vivo (SPEC §4 — decisão sujeita a esta
  aprovação; se removida do escopo, o diálogo vira confirmação simples)
- `src/routes/aik/aik-phases-board.test.tsx` — criar

## Passos de implementação
1. `AikPhasesBoard` resolve `systemId` de `useParams()`, renderiza
   `phasesBySystemId[systemId]` nas 4 colunas fixas
   (`backlog|in_progress|in_review|done`).
2. Card de fase **não registra sensor de drag** (nenhum `useSortable`/
   `useDraggable`) — não é item arrastável (CA-08).
3. Clicar numa fase navega para `/<systemId>/fases/<phaseId>`.
4. `DeletePhaseConfirmDialog`: conta tarefas filhas; se alguma tem
   `linkedConversationId` com `system.activeAgentTaskId === task.id`
   (run vivo), desabilita o botão de confirmar com mensagem explicando que
   é preciso `stopAgent` primeiro.

## Testes obrigatórios
- Coluna de cada fase reflete a agregação do store (não recalculada aqui —
  só lida do store, confiando no SPRINT-06).
- Card de fase não inicia drag (ausência de handler, CA-08).
- Exclusão bloqueada quando há run vivo; liberada quando não há (CA-09).

## Critérios de aceitação
- [ ] CA-05, CA-06, CA-08, CA-09

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/routes/aik/aik-phases-board.test.tsx
```

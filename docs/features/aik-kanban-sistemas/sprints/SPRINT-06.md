# SPRINT-06 — Store do quadro AIK

## Objetivo
Implementar `useAikBoardStore` com toda a máquina de estados de sistema,
fase e tarefa — o núcleo de regras de negócio do AIK.

## Depende de
SPRINT-01 (tipos, `wouldCreateCycle`), SPRINT-03 (`aik-board-file.api.ts`),
SPRINT-04 (`aik-pipeline.api.ts`)

## Onda
3

## Arquivos previstos
- `src/stores/aik-board-store.ts` — criar — `AikBoardState`,
  `AikBoardActions` completo (SPEC §2.3)
- `src/stores/aik-board-store.test.ts` — criar

## Passos de implementação
1. Estado: `systems`, `phasesBySystemId`, `tasksBySystemId`,
   `errorBySystemId` (SPEC §2.3).
2. CRUD de sistema/fase/tarefa conforme assinaturas de SPEC §2.3.
3. `moveTask`: reindexação via `reindexAfterMove` de
   `src/utils/kanban-tree.ts:33`, adaptado trocando `parentId` por
   `phaseId`. Toda mutação de tarefa recalcula a coluna da fase-pai pelas
   regras (a)-(e) do TECH §3 (RF-09) como efeito síncrono da mesma chamada.
4. `createTask`/`updateTask`: rejeitam gravação de `blockedByTaskId` que
   formaria ciclo, usando `wouldCreateCycle` do SPRINT-01 (CA-27).
5. `startAgent`: falha local (`{ok:false,error:"already_running"}`) sem
   round-trip se `system.activeAgentTaskId` já ocupado por outra tarefa;
   em sucesso chama `startAikAgentTask` (SPRINT-04), seta
   `linkedConversationId`, `columnId="in_progress"`,
   `activeAgentTaskId=taskId`, adiciona `AikTimelineEntry{kind:"run_started"}`.
6. `stopAgent`: aborta o run (mecanismo existente de parada de conversa),
   zera `activeAgentTaskId`, devolve a tarefa ao topo de `backlog`,
   registra `run_stopped`.
7. `approveTask`/`returnTask`: só permitidos com `columnId==="in_review"`;
   `returnTask` envia o feedback como mensagem na conversa vinculada
   (não cria conversa nova).
8. `syncFromFile`: no-op silencioso para `workspaceRef.kind==="cloud"`;
   para `"local"`, chama `readAikSystemFile`/`mergeAikSystemFiles`
   (SPRINT-03), popula `errorBySystemId` em falha sem lançar.
9. `startPolling(systemId)`: `setInterval` de 4000ms chamando
   `syncFromFile`, pausado por `document.visibilityState`, devolve `stop()`.

## Testes obrigatórios
- Os 5 casos de agregação de coluna de fase (RF-09 a-e), um teste cada
  (CA-07).
- `startAgent` bloqueado por `activeAgentTaskId` ocupado, sem chamar
  `startAikAgentTask` (CA-11, mock/spy confirmando zero chamadas).
- `stopAgent` devolve ao topo de `backlog` (CA-13).
- `startAgent` chama `startAikAgentTask` sempre com o `system`/`phase`
  resolvidos a partir do `task.phaseId`/`task.systemId` do próprio card,
  nunca de outro sistema (CA-21, spy em `startAikAgentTask`).
- `approveTask`/`returnTask`: rejeitam fora de `in_review`; `returnTask`
  entrega feedback na conversa vinculada existente (CA-17, CA-18).
- `wouldCreateCycle` bloqueia gravação de `blockedByTaskId` circular
  (CA-27, integrado ao store).
- `syncFromFile` cloud é no-op; local aplica merge e popula erro em falha
  sem lançar (CA-39).
- `startPolling`: dispara a cada 4s enquanto visível, pausa com
  `visibilitychange`, `stop()` cancela (fake timers).

## Critérios de aceitação
- [ ] CA-07, CA-11, CA-13, CA-17, CA-18, CA-19 (gravação), CA-21 (metade
      "local" — `startAgent` chama `startAikAgentTask` do SPRINT-04 sempre
      com o `system` do próprio card, nunca outro; a metade "cloud" já está
      coberta pelo SPRINT-04), CA-25, CA-27, CA-33 (não refaz sync ao
      trocar nível já carregado), CA-38, CA-39

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/stores/aik-board-store.test.ts
```

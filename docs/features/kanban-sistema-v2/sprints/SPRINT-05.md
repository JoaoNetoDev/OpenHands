# SPRINT-05 — Fluxo de validação humano/agente

## Objetivo
Coluna "pending_validation", aprovar/reprovar, contrato do agente na mensagem inicial.

## Depende de
SPRINT-04

## Onda
3

## Arquivos previstos
- `src/types/kanban.ts` — alterar — `"pending_validation"` em `KanbanColumnId`, `rejectionReason?` em `KanbanTask`
- `src/components/features/kanban/approve-reject-buttons.tsx` — criar
- `src/components/features/kanban/approve-reject-buttons.test.tsx` — criar
- `src/components/features/kanban/kanban-task-drawer.tsx` — alterar — inclui `ApproveRejectButtons`
- `src/api/kanban-pipeline.api.ts` — alterar — `buildFeatdevelopInitialMessage` inclui contrato de `board.json` + motivo de rejeição
- `src/api/kanban-pipeline.api.test.ts` — alterar

## Passos de implementação
1. Estender `KanbanColumnId`/`KanbanTask` (SPEC §2.7).
2. `ApproveRejectButtons`: Aprovar → `columnId: "done"`; Reprovar → exige motivo, `columnId: "todo"` + `rejectionReason`.
3. `buildFeatdevelopInitialMessage`: parágrafo de motivo de rejeição quando presente; parágrafo de contrato de `board.json` quando `task.linkedConversationId` indica card de pipeline.

## Testes obrigatórios
- CA-09, CA-10, CA-11 (regressão de tamanho de mensagem).

## Critérios de aceitação
- [ ] CA-09, CA-10, CA-11.

## Comandos de verificação
```bash
npm run make-i18n && npm run typecheck
npx vitest run src/components/features/kanban/approve-reject-buttons.test.tsx src/api/kanban-pipeline.api.test.ts
npm run lint
```

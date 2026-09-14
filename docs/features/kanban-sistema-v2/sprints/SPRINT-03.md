# SPRINT-03 — Checklist

## Objetivo
Checklist reutilizável em qualquer nível (quadro ou tarefa).

## Depende de
SPRINT-02 (precisa de `KanbanBoard`/`boardId` já existindo)

## Onda
2

## Arquivos previstos
- `src/types/kanban.ts` — alterar — `KanbanChecklistItem`, `checklist?` em `KanbanBoard`/`KanbanTask`
- `src/components/features/kanban/checklist-panel.tsx` — criar
- `src/components/features/kanban/checklist-panel.test.tsx` — criar
- `src/components/features/kanban/kanban-task-drawer.tsx` — alterar — inclui `ChecklistPanel`
- `src/components/features/kanban/board-detail-panel.tsx` — criar — inclui `ChecklistPanel` pro quadro
- `src/i18n/declaration.ts`, `src/i18n/translation.json` — alterar

## Passos de implementação
1. Tipo `KanbanChecklistItem` (SPEC §2.5).
2. `ChecklistPanel`: adicionar (input+Enter), marcar (checkbox), remover.
3. Integrar no drawer de tarefa e num novo painel de detalhe de quadro (aberto a partir de `board-list.tsx`).

## Testes obrigatórios
- CA-06.

## Critérios de aceitação
- [ ] CA-06.

## Comandos de verificação
```bash
npm run make-i18n && npm run typecheck
npx vitest run src/components/features/kanban/checklist-panel.test.tsx
npm run lint
```

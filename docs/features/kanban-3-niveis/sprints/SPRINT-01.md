# SPRINT-01 — Modelo de dados e store

## Objetivo
Ter `KanbanTask`, `collectDescendantIds`/`reindexAfterMove` e `useKanbanBoardStore` prontos e testados, sem UI.

## Depende de
nenhuma

## Onda
1

## Arquivos previstos
- `src/types/kanban.ts` — criar
- `src/utils/kanban-tree.ts` — criar
- `src/utils/kanban-tree.test.ts` — criar
- `src/stores/kanban-board-store.ts` — criar
- `src/stores/kanban-board-store.test.ts` — criar
- `package.json` — alterar — adicionar `uuid` a `dependencies` se ainda não usado localmente (já está — só confirmar import)

## Passos de implementação
1. Criar `KanbanTask`/`KanbanColumnId` (TECH §2.2).
2. Implementar `collectDescendantIds` com guarda de `Set` de visitados (SPEC §2.2) e `reindexAfterMove`.
3. Implementar `useKanbanBoardStore` com `persist`, incluindo `trySet` com detecção de falha de escrita (SPEC §2.3).

## Testes obrigatórios
- `collectDescendantIds`: sem filhos, 1 nível, 3 níveis, id inexistente, ciclo de `parentId`, auto-referência.
- Store: criar/editar/mover/excluir com cascata; isolamento entre `workspaceId`s; `trySet` disparando toast quando `localStorage.setItem` lança.

## Critérios de aceitação
- [ ] CA-05, CA-08, CA-09, CA-10.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/utils/kanban-tree.test.ts src/stores/kanban-board-store.test.ts
```

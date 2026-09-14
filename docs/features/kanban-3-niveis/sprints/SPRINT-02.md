# SPRINT-02 — Componentes de board e drag-and-drop

## Objetivo
Colunas, cards e drag-and-drop funcionando sobre a store da SPRINT-01, num board isolado de nível único (sem drawer ainda).

## Depende de
SPRINT-01

## Onda
2

## Arquivos previstos
- `package.json` — alterar — adicionar `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- `src/components/features/kanban/kanban-column.tsx` — criar
- `src/components/features/kanban/kanban-card.tsx` — criar
- `src/components/features/kanban/create-task-modal.tsx` — criar
- `src/components/features/kanban/delete-task-confirm-dialog.tsx` — criar

## Passos de implementação
1. Adicionar as dependências `@dnd-kit/*` e rodar `npm install`.
2. Implementar `KanbanColumn` (`useDroppable`) e `KanbanCard` (`useSortable`), usando `@heroui/react` `Card`/`Button`/`Chip`.
3. Implementar `CreateTaskModal` e `DeleteTaskConfirmDialog` conforme SPEC §2.4.

## Testes obrigatórios
- Render de coluna vazia vs. com cards.
- `DeleteTaskConfirmDialog` mostra contagem correta de descendentes.
- Drag-and-drop simulado via eventos de sensor do `@dnd-kit` move o card entre colunas na store.

## Critérios de aceitação
- [ ] CA-02, CA-05, CA-06, CA-07.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/components/features/kanban
```

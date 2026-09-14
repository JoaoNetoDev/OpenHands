# SPRINT-02 — Múltiplos quadros + migração de schema

## Objetivo
Quadros como camada de agrupamento, com migração segura dos dados existentes.

## Depende de
nenhuma (independente da SPRINT-01, mas ambas tocam `kanban-board-store.ts`/tipos — checar conflito na integração)

## Onda
1

## Arquivos previstos
- `src/types/kanban.ts` — alterar — `KanbanBoard`, `boardId`/`updatedAt` em `KanbanTask`
- `src/stores/kanban-board-store.ts` — alterar — `boardsByWorkspaceId`/`tasksByBoardId`, migração `version: 2`
- `src/stores/kanban-board-store.test.ts` — alterar — testes de migração e isolamento por `boardId`
- `src/routes/board-list.tsx` — criar
- `src/routes/board-list.test.tsx` — criar
- `src/routes/kanban-board.tsx` — alterar — resolve `boardId` da URL
- `src/routes.ts` — alterar
- `src/i18n/declaration.ts`, `src/i18n/translation.json` — alterar

## Passos de implementação
1. Estender tipos (SPEC §2.4).
2. Migração `version: 2` do `persist` (TECH §2.4): estado v1 (`tasksByWorkspaceId`) vira um quadro "Padrão" por workspace.
3. Ações de quadro na store: `createBoard`/`renameBoard`/`deleteBoard`.
4. `board-list.tsx`: lista de quadros do workspace ativo, criar/renomear/excluir (reaproveitando o padrão de confirmação de `delete-task-confirm-dialog.tsx`, SPEC §5).
5. `kanban-board.tsx` passa a resolver `boardId` da rota.
6. `routes.ts`: `board` vira `board-list.tsx`; `board/:boardId` vira o board de 3 níveis.

## Testes obrigatórios
- CA-04, CA-05.

## Critérios de aceitação
- [ ] CA-04, CA-05.

## Comandos de verificação
```bash
npm run make-i18n && npm run typecheck
npx vitest run src/stores/kanban-board-store.test.ts src/routes/board-list.test.tsx src/routes/kanban-board.test.tsx
npm run lint
```

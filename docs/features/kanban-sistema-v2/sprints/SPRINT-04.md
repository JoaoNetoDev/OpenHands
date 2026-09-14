# SPRINT-04 — Persistência de board em arquivo (base do fluxo de validação)

## Objetivo
`board.json` lido/escrito com segurança, merge tarefa-a-tarefa, cache local com write-behind.

## Depende de
SPRINT-02

## Onda
2

## Arquivos previstos
- `src/api/kanban-board-file.api.ts` — criar
- `src/api/kanban-board-file.api.test.ts` — criar
- `src/stores/kanban-board-store.ts` — alterar — `syncFromFile`, `debouncedWriteBoardFile` disparado em toda mutação

## Passos de implementação
1. `parseBoardFile`/`readBoardFile`/`writeBoardFile`/`mergeBoardFiles` conforme SPEC §2.6, incluindo o cross-check de `boardId` órfão e o bloqueio explícito de backend Cloud.
2. Debounce de 800ms na store; falha vira toast (`KANBAN$BOARD_FILE_SAVE_ERROR`).
3. `syncFromFile` chamado ao entrar em `board-list.tsx`/`kanban-board.tsx`.

## Testes obrigatórios
- CA-07, CA-08, CA-08b, CA-12.
- Reaproveitar os payloads adversariais já usados em `kanban-sintering.api.test.ts`/`kanban-pipeline.api.test.ts` (aspas, backticks, `$()`, `..`, espaço no path) contra `readBoardFile`/`writeBoardFile`.

## Critérios de aceitação
- [ ] CA-07, CA-08, CA-08b, CA-12.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/api/kanban-board-file.api.test.ts src/stores/kanban-board-store.test.ts
npm run lint
```

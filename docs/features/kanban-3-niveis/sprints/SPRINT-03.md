# SPRINT-03 — Rota, drawer entre níveis e navegação

## Objetivo
Board completo acessível em `/board`, com navegação entre os 3 níveis via drawer.

## Depende de
SPRINT-02

## Onda
3

## Arquivos previstos
- `src/routes/kanban-board.tsx` — criar
- `src/routes/kanban-board.test.tsx` — criar
- `src/components/features/kanban/kanban-task-drawer.tsx` — criar
- `src/routes.ts` — alterar
- `src/components/features/sidebar/sidebar.tsx` — alterar
- `src/i18n/declaration.ts`, `src/i18n/translation.json` — alterar

## Passos de implementação
1. Criar `kanban-board.tsx`: resolve workspace ativo, renderiza nível 1, estado vazio (RF-10) e estado "sem workspace ativo" (SPEC §4).
2. Criar `KanbanTaskDrawer` reaproveitando `KanbanColumn`/`KanbanCard` escopados a `getChildren(workspaceId, parentId)`.
3. Registrar rota e entrada de navegação.
4. Adicionar chaves i18n (`KANBAN$*`) e rodar `npm run make-i18n`.

## Testes obrigatórios
- Fluxo completo CA-01 a CA-04, CA-11.
- CA-12 documentado como checklist manual (não roda em CI).

## Critérios de aceitação
- [ ] CA-01, CA-03, CA-04, CA-11.

## Comandos de verificação
```bash
npm run make-i18n
npm run typecheck
npx vitest run src/routes/kanban-board.test.tsx
npm run lint
```

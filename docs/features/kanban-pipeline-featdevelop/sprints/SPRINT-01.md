# SPRINT-01 — Slug, modelo de dados e leitura de documentos

## Objetivo
`isValidFeatureSlug`, extensão de `KanbanTask`/`KanbanColumnId`, e `readFeatureDoc`/`listFeatureSprintFiles` prontos e testados.

## Depende de
kanban-3-niveis (tipo `KanbanTask`) e kanban-card-contexto-arquivos (`escapeSingleQuoted` de `kanban-sintering.api.ts`)

## Onda
1

## Arquivos previstos
- `src/types/kanban.ts` — alterar
- `src/utils/kanban-slug.ts` — criar
- `src/utils/kanban-slug.test.ts` — criar
- `src/api/kanban-pipeline.api.ts` — criar (só `readFeatureDoc`/`listFeatureSprintFiles` nesta sprint)
- `src/api/kanban-pipeline.api.test.ts` — criar (parte de leitura)

## Passos de implementação
1. Estender `KanbanColumnId`/`KanbanTask` (SPEC §2.1/TECH §2.1).
2. Implementar `isValidFeatureSlug` (TECH §2.2).
3. Implementar `readFeatureDoc`/`listFeatureSprintFiles` com revalidação interna de slug (TECH §2.3, correção pós-review).

## Testes obrigatórios
- CA-05, CA-06, CA-07.

## Critérios de aceitação
- [ ] CA-05, CA-06, CA-07.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/utils/kanban-slug.test.ts src/api/kanban-pipeline.api.test.ts
```

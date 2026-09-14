# SPRINT-02 — Rodar agente e presets de coluna

## Objetivo
`startFeatdevelopConversation` (com o campo `app_conversation_id` correto) e os dois presets de coluna funcionando.

## Depende de
SPRINT-01

## Onda
2

## Arquivos previstos
- `src/api/kanban-pipeline.api.ts` — alterar — adicionar `startFeatdevelopConversation`, `buildFeatdevelopInitialMessage`
- `src/api/kanban-pipeline.api.test.ts` — alterar — testes de criação de conversa
- `src/components/features/kanban/kanban-column-presets.ts` — criar
- `src/components/features/kanban/kanban-column-presets.test.ts` — criar
- `src/routes/kanban-board.tsx`, `src/components/features/kanban/kanban-column.tsx` — alterar

## Passos de implementação
1. Implementar `startFeatdevelopConversation`/`buildFeatdevelopInitialMessage` (TECH §2.3, com `app_conversation_id`).
2. Implementar `getColumnsForTask` (SPEC §2.7).
3. Adaptar `kanban-board.tsx`/`kanban-column.tsx` para iterar `getColumnsForTask` por card em vez de um conjunto fixo global.

## Testes obrigatórios
- CA-02, CA-03, CA-04.

## Critérios de aceitação
- [ ] CA-02, CA-03, CA-04.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/api/kanban-pipeline.api.test.ts src/components/features/kanban/kanban-column-presets.test.ts
```

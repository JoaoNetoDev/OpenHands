# SPRINT-01 — Escrita segura no workspace

## Objetivo
`sinterizeTask` e as funções de escape/comando prontas e testadas adversarialmente, sem UI.

## Depende de
kanban-3-niveis (SPRINT-01, tipo `KanbanTask` e store) e sistema-settings-menu (SPRINT-02, `RichTextInput` não usado ainda nesta sprint, mas confirma a allowlist HTML reaproveitada em `buildMarkdown`)

## Onda
1

## Arquivos previstos
- `src/types/kanban.ts` — alterar — `KanbanTaskAttachment`, campos novos em `KanbanTask`
- `src/api/kanban-sintering.api.ts` — criar
- `src/api/kanban-sintering.api.test.ts` — criar

## Passos de implementação
1. Estender `KanbanTask` (SPEC §2.1/TECH §2.1).
2. Implementar `escapeSingleQuoted`, `buildWriteFileCommand` (com `dirname` entre aspas duplas), `toBase64`, `buildMarkdown`, `sinterizeTask` (TECH §2.2, SPEC §2.2).
3. Escrever os testes adversariais executando o comando de fato num diretório temporário (não só inspeção de string).

## Testes obrigatórios
- Todos os casos do TECH §9.
- CA-08, CA-09.

## Critérios de aceitação
- [ ] CA-05, CA-06, CA-08, CA-09.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/api/kanban-sintering.api.test.ts
```

# SPRINT-03 — Botão de sinterizar e i18n

## Objetivo
Ação "Sinterizar" completa no card, com estado de habilitação correto e i18n.

## Depende de
SPRINT-01, SPRINT-02

## Onda
3

## Arquivos previstos
- `src/components/features/kanban/sinterize-button.tsx` — criar
- `src/components/features/kanban/sinterize-button.test.tsx` — criar
- `src/components/features/kanban/kanban-task-drawer.tsx` — alterar — inclui `sinterize-button`
- `src/i18n/declaration.ts`, `src/i18n/translation.json` — alterar

## Passos de implementação
1. Implementar `SinterizeButton` (SPEC §2.5): checagem de backend Cloud, chamada a `sinterizeTask`, toasts, indicador `lastSinteredAt`.
2. Integrar ao drawer.
3. Adicionar chaves i18n e rodar `npm run make-i18n`.

## Testes obrigatórios
- CA-03, CA-04, CA-06, CA-07.

## Critérios de aceitação
- [ ] CA-03, CA-04, CA-06, CA-07.

## Comandos de verificação
```bash
npm run make-i18n
npm run typecheck
npx vitest run src/components/features/kanban/sinterize-button.test.tsx
npm run lint
```

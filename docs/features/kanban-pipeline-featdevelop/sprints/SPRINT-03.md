# SPRINT-03 — UI do card: slug, botão de agente, painel de documentos

## Objetivo
Card de Nível 1 completo com os três componentes visíveis e i18n.

## Depende de
SPRINT-01, SPRINT-02

## Onda
3

## Arquivos previstos
- `src/components/features/kanban/feature-slug-input.tsx` — criar
- `src/components/features/kanban/run-agent-button.tsx` — criar
- `src/components/features/kanban/feature-docs-panel.tsx` — criar
- `src/components/features/kanban/kanban-task-drawer.tsx` — alterar
- `src/i18n/declaration.ts`, `src/i18n/translation.json` — alterar

## Passos de implementação
1. Implementar `FeatureSlugInput`, `RunAgentButton`, `FeatureDocsPanel` (SPEC §2.4-2.6).
2. Integrar os três no drawer, condicionados a `task.level === 1`.
3. Adicionar chaves i18n e rodar `npm run make-i18n`.

## Testes obrigatórios
- CA-01 (fluxo completo de UI).
- Regressão: card de Nível 2/3 nunca mostra os componentes novos.

## Critérios de aceitação
- [ ] CA-01.

## Comandos de verificação
```bash
npm run make-i18n
npm run typecheck
npx vitest run src/components/features/kanban
npm run lint
```

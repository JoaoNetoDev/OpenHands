# SPRINT-02 — Contexto e anexos no card

## Objetivo
Card ganha os dois campos de contexto e a lista de anexos, sem o botão de sinterizar ainda.

## Depende de
SPRINT-01

## Onda
2

## Arquivos previstos
- `src/components/features/kanban/card-context-panel.tsx` — criar
- `src/components/features/kanban/card-attachments.tsx` — criar
- `src/components/features/kanban/card-attachments.test.tsx` — criar
- `src/components/features/kanban/kanban-task-drawer.tsx` — alterar — inclui `card-context-panel` e `card-attachments`

## Passos de implementação
1. Implementar `CardContextPanel` reaproveitando `RichTextInput` do sub-projeto 1 (SPEC §2.3).
2. Implementar `CardAttachments` com validação de tamanho (256 KB) e nome (SPEC §2.4).
3. Integrar os dois no `kanban-task-drawer.tsx` existente.

## Testes obrigatórios
- CA-01, CA-02.

## Critérios de aceitação
- [ ] CA-01, CA-02.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/components/features/kanban/card-attachments.test.tsx
```

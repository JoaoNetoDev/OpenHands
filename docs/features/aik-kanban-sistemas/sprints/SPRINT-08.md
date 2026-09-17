# SPRINT-08 — Kanban de sistemas

## Objetivo
Tela raiz do AIK: cadastro, listagem em kanban e exclusão de sistemas.

## Depende de
SPRINT-02 (`aik-routes.tsx`), SPRINT-06 (`aik-board-store`)

## Onda
4

## Arquivos previstos
- `src/routes/aik/aik-systems-board.tsx` — alterar — reescreve o stub
  criado pelo SPRINT-02 (único sprint que toca este arquivo depois do
  SPRINT-02, sem editar `aik-routes.tsx`)
- `src/components/features/aik/aik-system-form.tsx` — criar — cadastro:
  nome, backend (`getRegisteredBackends()`), workspace/repositório
  conforme `backend.kind` (`useLocalWorkspaces()` para local,
  `useGitRepositories()` para cloud — nunca os dois campos ao mesmo tempo)
- `src/components/features/aik/delete-system-confirm-dialog.tsx` — criar —
  confirmação com contagem de fases + tarefas descendentes (SPEC §5, CA-30)
- `src/routes/aik/aik-systems-board.test.tsx` — criar
- `src/components/features/aik/aik-system-form.test.tsx` — criar

## Passos de implementação
1. `AikSystemsBoard`: 3 colunas fixas `ativo | pausado | arquivado`
   (Q1/TECH §3), cards mostrando contagem de `in_progress`/`in_review` e
   status do último health check do backend (RF-03).
2. Clicar num card navega para `/<systemId>` (CA-29).
3. `AikSystemForm`: alterna o segundo campo (`useLocalWorkspaces` vs.
   `useGitRepositories`) conforme `backend.kind` do backend selecionado;
   avisa (não bloqueia) se o workspace/path já está associado a outro
   sistema existente no store (caso de borda SPEC §4 — sujeito à aprovação
   desta fase de sprints; se removido do escopo do build, este passo 3 vira
   opcional sem afetar os demais).
4. `DeleteSystemConfirmDialog`: mostra `phasesBySystemId[id].length +
   tasksBySystemId[id].length`.

## Testes obrigatórios
- Card mostra contagens corretas e navega ao clicar (CA-29).
- Form local só lista `useLocalWorkspaces()`; form cloud só lista
  `useGitRepositories()` (CA-03).
- Exclusão mostra contagem e remove sistema + fases + tarefas do store
  (CA-30).

## Critérios de aceitação
- [ ] CA-01 (metade "renderiza AikSystemsBoard"), CA-03, CA-04, CA-29,
      CA-30, CA-39 (sistema em erro isolado não quebra a lista)

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/routes/aik/aik-systems-board.test.tsx src/components/features/aik/aik-system-form.test.tsx
```

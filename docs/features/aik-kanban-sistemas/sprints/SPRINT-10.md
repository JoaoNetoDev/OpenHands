# SPRINT-10 — Kanban de tarefas e execução

## Objetivo
Tela de tarefas de uma fase: CRUD, drag, Executar/Parar, Aprovar/Devolver,
indicador de run vivo e arquivos alterados.

## Depende de
SPRINT-02 (`aik-routes.tsx`), SPRINT-06 (`aik-board-store`), SPRINT-05
(`AikTimeline`)

## Onda
4

## Arquivos previstos
- `src/routes/aik/aik-tasks-board.tsx` — alterar — reescreve o stub
  criado pelo SPRINT-02 (único sprint que toca este arquivo depois do
  SPRINT-02, sem editar `aik-routes.tsx`)
- `src/components/features/aik/aik-task-card.tsx` — criar — props
  `{ task: AikTask; onOpen: (task: AikTask) => void }` (SPEC §2.6)
- `src/routes/aik/aik-tasks-board.test.tsx` — criar
- `src/components/features/aik/aik-task-card.test.tsx` — criar

## Passos de implementação
1. `AikTasksBoard` resolve `systemId`/`phaseId` de `useParams()`,
   renderiza `tasksBySystemId[systemId].filter(t => t.phaseId === phaseId)`
   nas 4 colunas, com drag via `@dnd-kit` (mesmo padrão de
   `kanban-board.tsx:74-78`, incluindo `KeyboardSensor` para RNF-06).
2. `AikTaskCard`: mostra prioridade, indicador de bloqueio quando
   `blockedByTaskId` aponta pra tarefa não `done` (desabilita só Executar,
   não o drag), botão Executar/Parar conforme
   `task.linkedConversationId`/`system.activeAgentTaskId`, indicador de run
   vivo alimentado pelo stream de conversa quando o painel está aberto, e
   `task.lastRunFilesChanged` como lista.
3. Executar desabilitado com motivo visível quando
   `system.activeAgentTaskId` já ocupado por outra tarefa (CA-11).
4. Detalhe da tarefa (drawer ou navegação — a definir na implementação, sem
   modal-sobre-modal): título, descrição, checklist, `<AikTimeline
   entries={task.timeline}/>`, Aprovar/Devolver visíveis só quando
   `columnId==="in_review"`.

## Testes obrigatórios
- Drag persiste `columnId`+`order`; mesma transição alcançável via teclado
  (CA-08, CA-37).
- Executar habilitado só com `executorType==="agent"` + `agentBriefing` +
  backend acessível, e desabilitado com motivo quando outro run está ativo
  (CA-10, CA-11).
- Indicador de run vivo e arquivos alterados renderizam a partir do estado
  do store (CA-14, CA-15).
- Timeline exibe entradas na ordem correta (CA-19, delegando a
  `AikTimeline` do SPRINT-05).

## Critérios de aceitação
- [ ] CA-08, CA-10, CA-11, CA-12, CA-14, CA-15, CA-19, CA-37

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/routes/aik/aik-tasks-board.test.tsx src/components/features/aik/aik-task-card.test.tsx
```

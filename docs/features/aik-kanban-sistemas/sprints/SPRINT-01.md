# SPRINT-01 — Tipos do AIK e detecção de ciclo de dependência

## Objetivo
Dar aos demais sprints um vocabulário de tipos comum e o utilitário de
detecção de ciclo em `blockedByTaskId`, sem nenhuma dependência de UI ou
store.

## Depende de
nenhuma

## Onda
1

## Arquivos previstos
- `src/types/aik.ts` — criar — `AikColumnId`, `AikSystemColumnId`,
  `AikWorkspaceRef` (`local`/`cloud`), `AikSystem`, `AikPhase`, `AikTask`,
  `AikTimelineEntry`, `AikSystemFile`, `AikErrorType` (SPEC §2.2/§2.3, TECH §3)
- `src/utils/aik-dependency-graph.ts` — criar — detecção de ciclo em
  `blockedByTaskId`, adaptado de `collectDescendantIds`
  (`src/utils/kanban-tree.ts:10-26`) trocando `parentId` pelo grafo de
  bloqueio
- `src/utils/aik-dependency-graph.test.ts` — criar

## Passos de implementação
1. Definir os tipos em `src/types/aik.ts` exatamente como especificado em
   TECH §3 / SPEC §2.2, importando `KanbanChecklistItem` de
   `src/types/kanban.ts:22` sem redefinir.
2. Implementar `wouldCreateCycle(tasks: AikTask[], taskId: string,
   candidateBlockedByTaskId: string): boolean` por BFS a partir de
   `candidateBlockedByTaskId` seguindo `blockedByTaskId`, retornando `true`
   se `taskId` é alcançado (formaria ciclo).
3. Cobrir autorreferência (`candidateBlockedByTaskId === taskId`) e grafo
   desconectado.

## Testes obrigatórios
- `aik-dependency-graph.test.ts`: ciclo direto, ciclo indireto (A→B→C→A),
  autorreferência, sem ciclo, grafo desconectado.

## Critérios de aceitação
- [ ] CA-27: `blockedByTaskId` circular é detectado (função pura, testada
      isoladamente aqui; a rejeição na gravação é responsabilidade do
      SPRINT-06).

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/utils/aik-dependency-graph.test.ts
```

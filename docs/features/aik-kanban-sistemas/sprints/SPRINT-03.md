# SPRINT-03 — Persistência de arquivo do sistema

## Objetivo
Ler, escrever e fundir `.openhands/aik/system.json` de um workspace local,
sem depender de store nem de UI.

## Depende de
SPRINT-01 (tipos `AikSystemFile`, `AikErrorType`)

## Onda
2

## Arquivos previstos
- `src/api/aik-board-file.api.ts` — criar — `buildAikFilePath`,
  `readAikSystemFile`, `writeAikSystemFile`, `mergeAikSystemFiles`
  (SPEC §2.4)
- `src/api/aik-board-file.api.test.ts` — criar

## Passos de implementação
1. `buildAikFilePath(workspacePath)` → `` `${workspacePath}/.openhands/aik/system.json` ``.
2. `readAikSystemFile`/`writeAikSystemFile`: mesmo mecanismo de
   `src/api/kanban-board-file.api.ts` — `cat --` / `buildWriteFileCommand`
   via `AgentServerRuntimeService.executeCommand`, com o guard de
   `errorType:"cloud_unsupported"` quando `getActiveBackend().backend.kind
   === "cloud"` (mesmo padrão de `kanban-board-file.api.ts:162-164`).
3. `mergeAikSystemFiles(local, remote)`: funde `phases` e `tasks` por `id`,
   comparando `updatedAt` de cada item — generalização uniforme da metade
   "por-task" de `mergeBoardFiles` (`kanban-board-file.api.ts:116-146`) para
   as duas coleções (SPEC §2.4, precisão do algoritmo real documentada ali).
   Item presente só de um lado é sempre mantido.
4. `writeAikSystemFile` relê o arquivo antes de escrever e aplica o merge
   (mesma sequência de `kanban-board-file.api.ts:200-224`).

## Testes obrigatórios
- Leitura/escrita local com sucesso.
- `cloud_unsupported` sem tentar o comando quando backend é cloud.
- `mergeAikSystemFiles`: item só em `local` sobrevive; item só em `remote`
  sobrevive; item nos dois lados mantém o de `updatedAt` mais recente
  (casos de `phases` e de `tasks` separadamente).
- Falha de parse (JSON malformado / `version` desconhecida) devolve
  `errorType:"parse_error"` sem lançar.

## Critérios de aceitação
- [ ] CA-24, CA-26, CA-35 (teste unitário: `AikSystemFile` serializado por
      `writeAikSystemFile` nunca inclui `Backend.apiKey`), CA-39 (metade
      "arquivo corrompido")

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/api/aik-board-file.api.test.ts
```

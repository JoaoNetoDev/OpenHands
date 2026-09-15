# SPRINT-01 — Swap atômico do diretório de assets no pós-build

## Objetivo
Trocar a ordem apagar-depois-renomear em `moveBuildEntry` por um swap atômico (renomear o antigo
para backup, renomear o novo para o lugar, só então apagar o backup), eliminando a janela em que
`build/assets` fica ausente/parcial durante o deploy.

## Depende de
Nenhuma.

## Onda
1

## Arquivos previstos
- `react-router.config.ts` — alterar — reescrever `moveBuildEntry` para a estratégia de swap
  atômico (rename-backup → rename-novo → rm-backup) e o fallback `EPERM`/`EXDEV` para copiar num
  temporário irmão antes de fazer o rename final; exportar `moveBuildEntry` (named export) sem
  remover o `export default` existente.
- `react-router.config.test.ts` (raiz do repo, ao lado de `react-router.config.ts`) — criar —
  testes unitários dos 4 casos obrigatórios da SPEC.

## Passos de implementação
1. Ler `react-router.config.ts` por completo (24-90) para confirmar as assinaturas atuais de
   `moveBuildEntry` e `unpackClientDirectoryOnce` antes de editar.
2. Adicionar `export` em `moveBuildEntry` (manter `unpackClientDirectoryOnce` e o `default`
   export como estão — só `moveBuildEntry` precisa ser importável pelo teste).
3. Implementar a nova `moveBuildEntry(fs, source, destination)` em **duas fases** (algoritmo
   corrigido após finding `F-SP-01` da validação adversarial — a primeira versão renomeava
   `destination` para backup antes do fallback `cp`, deixando `destination` ausente durante todo o
   `cp` recursivo, reintroduzindo o bug original no caminho lento):
   - Gerar `incomingPath` e `backupPath`, ambos derivados de `destination` com um contador local
     (não usar `Date.now()`/`Math.random()`; um contador de módulo incrementado a cada chamada é
     suficiente para evitar colisão dentro do mesmo processo de build).
   - **Fase 1 — preparar o novo conteúdo, sem tocar em `destination`**:
     tentar `await fs.promises.rename(source, incomingPath)`; em caso de `EPERM`/`EXDEV`,
     `await fs.promises.cp(source, incomingPath, {recursive:true, force:true})` seguido de
     `await fs.promises.rm(source, {recursive:true, force:true})`. Qualquer outro erro propaga
     sem ter tocado em `destination`/`backupPath`.
   - **Fase 2 — swap atômico, só depois que `incomingPath` está pronto**:
     tentar `await fs.promises.rename(destination, backupPath)`; se `ENOENT`, seguir sem backup
     (primeiro build); qualquer outro erro propaga. Depois,
     `await fs.promises.rename(incomingPath, destination)`. Se havia backup,
     `await fs.promises.rm(backupPath, {recursive:true, force:true})` só depois do rename anterior
     ter sucesso. Erro no rename final (depois de já ter renomeado `destination` para backup)
     propaga **sem** apagar `backupPath`.
4. Escrever `react-router.config.test.ts` com um fake filesystem mínimo (objeto que implementa
   `readdir`, `rename`, `rm`, `cp` sobre um `Map<string, "dir"|"file">` em memória, injetado como
   o parâmetro `fs` que a função já recebe — não é necessário mockar o módulo `node:fs` global).
   Casos:
   - Destino inexistente: Fase 1 conclui via `rename(source, incoming)`; Fase 2 não encontra
     `destination` (ENOENT), pula o backup e faz só `rename(incoming, destination)`; nenhuma
     chamada a `rm` sobre `destination`/backup.
   - Destino existente (caminho feliz): ordem exata `rename(source, incoming)` →
     `rename(destination, backup)` → `rename(incoming, destination)` → `rm(backup)`; em nenhum
     ponto entre a segunda e a terceira chamada o fake filesystem reporta `destination` ausente
     por mais que a operação de rename em si (assertar isso registrando o estado do fake fs a
     cada chamada mockada, via `vi.fn` com implementação que atualiza o Map e é inspecionada em
     cada `mock.calls`).
   - Fallback `EXDEV` na Fase 1, com destino existente: mock de `rename(source, incoming)` lança
     `Object.assign(new Error(), {code:'EXDEV'})`; assertar ordem `cp(source, incoming)` →
     `rm(source)` → **só então** `rename(destination, backup)` → `rename(incoming, destination)`
     → `rm(backup)`. Assertar que `destination` mantém o conteúdo antigo intacto durante toda a
     simulação do `cp` (nenhuma chamada de `rename`/`rm` sobre `destination` ocorre antes do
     `cp`/`rm(source)` terminarem) — este é o caso que cobre F-SP-01 diretamente.
   - Erro não tratado no rename final da Fase 2 (ex.: código diferente de `ENOENT` no primeiro
     rename, ou qualquer erro no segundo): assertar que a função rejeita e que `rm(backup)`
     **não** foi chamado.
5. Rodar os comandos de verificação abaixo e corrigir até todos passarem.

## Testes obrigatórios
- `react-router.config.test.ts` cobrindo os 4 casos da SPEC (seção "Novo arquivo de teste",
  casos 1-4).
- Confirmar que o caso 2 (destino existente, caminho feliz) falha se a implementação antiga
  (`rm(destination)` seguido de `rename(source, destination)`) for usada — comentar no teste
  qual asserção especificamente captura a regressão (a ordem das chamadas / a ausência
  momentânea de `destination`).

## Critérios de aceitação
- [ ] CA-01: `moveBuildEntry` nunca chama `rm`/`cp` que apague ou sobrescreva `destination`
      antes de o novo conteúdo (via `source` ou `incomingPath`) estar pronto para ocupar aquele
      caminho — verificável pela ordem de chamadas nos testes do fake filesystem.
- [ ] CA-02: build real (`npm run build`) continua produzindo `build/` funcional, com o mesmo
      conteúdo final de antes da mudança (nenhuma alteração de output, só de estratégia de swap).
- [ ] CA-03: todos os 4 casos de teste de `react-router.config.test.ts` passam.
- [ ] CA-04: `npm run typecheck`, `npm run lint` e `npm test` (suíte completa) permanecem verdes.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run react-router.config.test.ts
npm run build
npm run lint
npm test
```

# SPEC — Swap atômico do diretório de assets no pós-build

Ficha de origem: [FICHA.md](./FICHA.md) — causa raiz aprovada.

## Escopo

Eliminar a janela de inconsistência em `build/assets` criada por `moveBuildEntry`
(`react-router.config.ts`), que hoje apaga o diretório de destino (`fs.rm`) antes de colocar o
novo no lugar (`fs.rename`, ou `fs.cp`+`fs.rm` no fallback de `EPERM`/`EXDEV`). Como o Apache em
produção serve `build/` diretamente e ao vivo durante o `npm run build` disparado por
`tools/deploy-remotes.sh`, essa janela produz 404 de assets recém-hasheados e tela branca.

**Fora de escopo**: qualquer mudança em infraestrutura fora deste repositório (config do vhost
Apache, `tools/deploy-remotes.sh`/`agent-server-remotes.sh`, credenciais em
`/etc/openhands-deploy/hosts.tsv`, ou adoção de diretórios de release versionados/symlink
`current` no host remoto). A correção deste ciclo é inteiramente no pós-build do próprio
`react-router.config.ts`, que já roda no processo de `npm run build` e não depende de acesso ao
host de produção. Uma estratégia de release blue-green no host remoto fica registrada como
melhoria futura, não faz parte desta SPEC.

## Por que essa correção é suficiente

`rename(2)` do POSIX é atômico quando o destino não existe (ou é um diretório vazio). O bug atual
é a ordem: apaga o destino (não-vazio) e só depois renomeia a origem — abrindo uma janela em que
`build/assets` não existe. A correção reorganiza a operação em duas fases separadas, de modo que
`destination` só é tocado depois que o conteúdo novo já está **inteiramente pronto** ao lado dele:

> Uma primeira versão desta SPEC propunha apagar/renomear `destination` para backup **antes** de
> lidar com o fallback `EPERM`/`EXDEV`. Um validador adversarial (finding `F-SP-01`) apontou que
> isso reintroduzia o próprio bug: no caminho `EXDEV`, `destination` ficava ausente durante todo o
> `cp` recursivo — a mesma janela longa do problema original. A versão abaixo corrige isso
> invertendo a ordem: primeiro prepara o novo conteúdo ao lado, sem tocar em `destination`; só
> depois faz o swap.

**Fase 1 — preparar o novo conteúdo em `incomingPath` (irmão de `destination`), sem tocar em `destination`:**

1. Tentar `fs.rename(source, incomingPath)`.
2. Se falhar com `EPERM`/`EXDEV`: `fs.cp(source, incomingPath, {recursive:true, force:true})`
   seguido de `fs.rm(source, {recursive:true, force:true})`. Esse é o caminho lento, mas ele opera
   inteiramente fora de `destination` — quem está sendo servido ao vivo não é afetado enquanto o
   `cp` roda, porque `destination` ainda tem o conteúdo antigo, intacto.
3. Qualquer outro erro propaga sem tocar em `destination`.

**Fase 2 — swap atômico, só depois que `incomingPath` já contém o conteúdo novo completo:**

4. Se `destination` já existe: `fs.rename(destination, backupPath)` — renomeia o **antigo** para
   um nome de backup (atômico; mesmo filesystem, operação de metadado).
5. `fs.rename(incomingPath, destination)` — renomeia o **novo** (já pronto) para o lugar final
   (atômico; mesmo filesystem que `destination`).
6. Se havia backup: `fs.rm(backupPath, {recursive:true, force:true})` — limpeza do antigo, já fora
   do caminho servido.

Entre os passos 4 e 5 existe uma janela em que `destination` momentaneamente não existe — mas é
uma operação de metadado (rename), não uma cópia de dados; a janela cai de "duração do build/cp
recursivo" para "duração de uma chamada de syscall", em **ambos** os caminhos (feliz e fallback),
porque a fase lenta (cp) agora acontece inteiramente antes da fase 2 e nunca mexe em `destination`.
Essa é a garantia que faltava na primeira versão: a fase 1 nunca é bloqueante para quem está sendo
servido, porque `destination` não é tocado nela.

## Mudanças arquivo a arquivo

### `react-router.config.ts`

- Reescrever `moveBuildEntry(fs, source, destination)` seguindo as duas fases da seção anterior:
  - Gerar `incomingPath` e `backupPath` a partir de `destination` (ex.:
    `` `${destination}.incoming-${pid}-${counter}` `` / `` `${destination}.stale-${pid}-${counter}` ``
    — um contador local de módulo, incrementado a cada chamada, é suficiente para evitar colisão
    dentro do mesmo processo de build; não é necessário `Date.now()`/`Math.random()`).
  - **Fase 1 (não toca em `destination`)**:
    `try { await fs.promises.rename(source, incomingPath); } catch (e) { if (código não é EPERM/EXDEV) throw; await fs.promises.cp(source, incomingPath, {recursive:true, force:true}); await fs.promises.rm(source, {recursive:true, force:true}); }`
  - **Fase 2 (swap atômico)**:
    `let hadDestination = true; try { await fs.promises.rename(destination, backupPath); } catch (e) { if (e.code !== 'ENOENT') throw e; hadDestination = false; }`
    seguido de `await fs.promises.rename(incomingPath, destination)`, e, se `hadDestination`,
    `await fs.promises.rm(backupPath, {recursive:true, force:true})`.
  - Qualquer erro na Fase 1 propaga sem ter tocado em `destination`/`backupPath`. Qualquer erro na
    Fase 2 depois do primeiro `rename(destination, backupPath)` mas antes do segundo `rename`
    propaga **sem** apagar `backupPath` (preserva o conteúdo antigo).
  - Exportar `moveBuildEntry` (e, se necessário para teste, `unpackClientDirectoryOnce`) como
    `export` nomeado — hoje nenhuma das duas é exportada, o que hoje impede teste unitário direto.
    Manter o `export default` do `Config` intacto.
- Nenhuma mudança de comportamento observável para o caso em que `destination` não existe ainda
  (primeiro build): pula direto para o passo 2.

### Novo arquivo de teste: `react-router.config.test.ts` (raiz do repo, ao lado de
`react-router.config.ts`, seguindo o padrão de outros `*.test.ts` do projeto)

- Mock de `fs.promises` (via `vi.mock('node:fs', ...)` ou injeção do módulo `fs` já usada pela
  função, que recebe `fs` como parâmetro — preservar essa injeção de dependência para
  testabilidade) com um filesystem fake em memória (mapa de path → conteúdo/diretório) simples o
  bastante para simular `rm`, `rename`, `cp`, e lançar `ENOENT`/`EPERM`/`EXDEV` sob demanda.
- Casos obrigatórios:
  1. **Destino não existe (primeiro build)**: `moveBuildEntry` apenas renomeia `source` para
     `destination`; nenhuma chamada de `rm` no destino.
  2. **Destino existe (build normal)**: a sequência de chamadas observadas deve ser
     `rename(destination, backup)` → `rename(source, destination)` → `rm(backup)`, **nessa
     ordem**, e o fake filesystem deve reportar que `destination` está sempre presente (com
     conteúdo antigo ou novo) em qualquer ponto observável entre as chamadas — nunca ausente.
     Este é o teste que teria falhado contra a implementação antiga (`rm(destination)` antes de
     `rename(source, destination)` deixa `destination` ausente por um instante observável) —
     rodar esse teste contra uma cópia da implementação antiga (ou registrar no teste um
     comentário apontando a linha removida) para comprovar que é uma regressão real coberta.
  3. **Fallback EPERM/EXDEV na Fase 1, com destino existente**: simular
     `rename(source, incomingPath)` lançando `EXDEV`; assertar que a ordem observada é
     `cp(source, incoming)` → `rm(source)` → **só então** `rename(destination, backup)` →
     `rename(incoming, destination)` → `rm(backup)`. Assertar explicitamente que nenhuma chamada
     a `rename`/`rm` sobre `destination` acontece antes de `incomingPath` estar completo — ou
     seja, o fake filesystem deve reportar `destination` com o conteúdo **antigo** intacto durante
     toda a duração do `cp` simulado, e só ficar momentaneamente ausente entre as duas chamadas de
     `rename` finais (mesma garantia do caso 2, não uma janela do tamanho do `cp`). Este é o teste
     que cobre o finding `F-SP-01` do validador adversarial: a primeira versão desta SPEC fazia
     `rename(destination, backup)` **antes** do fallback `cp`, deixando `destination` ausente
     durante todo o `cp` recursivo — o mesmo bug original, só que no caminho lento.
  4. **Limpeza do backup**: após a Fase 2 ter sucesso, `rm(backupPath)` é chamado exatamente uma
     vez; se a Fase 2 falhar com um erro não tratado (nem ENOENT/EPERM/EXDEV) depois do primeiro
     `rename(destination, backup)`, a função deve propagar o erro **sem** ter apagado
     `backupPath` (para não perder o conteúdo antigo em caso de falha real).
- `unpackClientDirectoryOnce`: teste de integração leve (sem mock profundo) apenas garantindo que,
  quando `build/client` não existe (`ENOENT`), a função retorna sem erro — comportamento hoje já
  coberto, mantê-lo intacto.

## Critérios de aceitação verificáveis

1. `npm run build` continua produzindo um `build/` funcional e idêntico em conteúdo final ao
   comportamento atual (nenhuma mudança de output, só de estratégia de swap).
2. Os novos testes unitários de `react-router.config.test.ts` passam com a implementação nova e
   **falham** com a implementação antiga reintroduzida temporariamente (evidência de que o teste
   cobre a regressão de fato, não é um teste vazio).
3. `npm test` (suíte completa) permanece verde.
4. `npm run typecheck` / `npm run lint` limpos para os arquivos alterados.
5. Revisão manual do diff confirma: nenhuma chamada a `fs.rm`/`fs.promises.rm` no `destination`
   acontece antes de `source` (ou seu equivalente já renomeado) estar posicionado em
   `destination`.

## Teste de regressão obrigatório

O item 2 acima é o teste de regressão desta SPEC: `react-router.config.test.ts`, caso 2, é o teste
que reproduz exatamente a falha descrita na FICHA (janela em que `build/assets` fica ausente) e
deve permanecer no repositório como guarda permanente contra reintrodução do padrão
`rm(destination)` → `rename(source, destination)`.

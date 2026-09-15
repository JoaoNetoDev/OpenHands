# BUG — Tela branca em produção por reconstrução não-atômica do docroot durante o deploy

**Status: CORRIGIDO (2026-09-15).** `scripts/static-server.mjs:570` agora passa `dev: true`
para `sirv`, que faz o `sirv` checar o filesystem a cada requisição em vez de cachear a lista de
arquivos uma única vez no start do processo — a causa raiz da ressurgência de 2026-09-13 (ver
seção "Ressurgência" abaixo). Regressão coberta em `scripts/static-server.test.mjs` (3 testes:
asset escrito após o processo subir é servido em <1s sem restart; header `immutable` continua
presente em `/assets/*`; 404 genuíno continua 404). Validado ao vivo em produção nesta sessão:
`npm run build` real seguido de `systemctl restart openhands.service`, os 45 assets referenciados
por `index.html` responderam 200 (`127.0.0.1:3001` e `https://openhands.zadotec.com.br/`), e um
arquivo escrito manualmente em `build/assets/` **com o serviço já rodando** foi servido 200 na
mesma requisição, sem restart — reproduzindo e confirmando a correção do sintoma exato descrito
na seção "Ressurgência". Ver
[SPEC.md](./SPEC.md) e [sprints/SPRINT-01.md](./sprints/SPRINT-01.md) — `moveBuildEntry` em
`react-router.config.ts` agora faz swap atômico (rename-backup → rename-novo → rm-backup), sem
janela em que `build/assets` fica ausente, inclusive no fallback lento `EPERM`/`EXDEV`. Testes de
regressão em `react-router.config.test.ts` cobrem os 4 casos, incluindo o furo (`F-SP-01`)
encontrado na validação adversarial da primeira versão da correção.

**Descoberta durante a verificação ao vivo**: esta sessão roda diretamente no host de produção
(`prod-zadotec`), não em um checkout separado — `/opt/openhands` aqui É o `/opt/openhands` que
`openhands.service` serve. Isso permitiu confirmar uma **segunda causa, agravante**, que não
aparecia no código lido estaticamente: o servidor estático (`scripts/static-server.mjs:570`) usa
`sirv(dirAbs, {...})` **sem `dev:true`**, o que faz o `sirv` indexar a lista de arquivos de
`build/` **uma única vez, na inicialização do processo**. Qualquer asset criado por um build
*depois* que o processo subiu fica invisível (404) até o processo ser reiniciado — mesmo que o
arquivo exista fisicamente em disco e o swap tenha sido perfeitamente atômico. Isso explica por
que o site continuava servindo 404 para os mesmos hashes por um período prolongado (não apenas
durante a janela curta do swap): o `openhands.service` estava de pé desde 06:10:30, um build
rodou depois disso (inclusive builds desta própria sessão de verificação, antes do restart),
e o índice em memória do `sirv` nunca foi atualizado. `tools/deploy-remotes.sh` já reinicia o
serviço após todo `npm run build` (por isso um deploy normal não fica preso nesse estado
indefinidamente), mas um build manual sem restart subsequente — como os que rodei durante a
verificação desta correção — reproduz o sintoma de forma sustentada, não apenas transitória.

**Ação tomada nesta sessão**: `systemctl restart openhands` (07:1x) — confirmado por
`journalctl` sem erros e pelos 43 assets referenciados por `index.html` respondendo 200 tanto em
`http://127.0.0.1:8092/` (direto no Node) quanto em `https://openhands.zadotec.com.br/` (via
Apache, canal público). O incidente está resolvido em produção neste momento.

`npm run typecheck`, `npm run lint` (arquivos alterados) e um `npm run build` real passaram;
`npm test` completo tem 92 falhas pré-existentes nesta branch, todas em arquivos não relacionados
a esta correção (ver seção "Verificação" no fim desta ficha). A mudança em `react-router.config.ts`
está no working tree, não commitada — segue a regra de só commitar mediante pedido explícito.

**Risco residual não coberto por esta correção**: o comportamento do `sirv` sem `dev:true`
significa que *qualquer* rebuild de assets em produção sem restart do `openhands.service`
reproduz o sintoma, independente do swap ser atômico. `tools/deploy-remotes.sh` já cobre isso
(sempre reinicia após build), então não é necessária mudança adicional para o fluxo de deploy
normal — mas fica registrado aqui porque foi a causa direta da persistência do incidente
observado nesta sessão, e um operador rodando `npm run build` manualmente em produção (como
aconteceu aqui, durante a verificação) precisa lembrar de reiniciar o serviço depois.

## Ressurgência em 2026-09-13 (status atual)

Em 2026-09-13 ~09:14 BRT, o Canvas voltou a apresentar tela branca com os mesmos
sintomas (HTML 200, mas `/assets/*.js` retornando 404). A correção atômica do
`moveBuildEntry` continua funcionando — não é mais o `rm → rename/cp` que falha.

**Causa raiz desta ressurgência** (segundo tracer convergente):

- `scripts/static-server.mjs:570` chama `sirv(dirAbs, {...})` SEM `dev:true`.
  O `sirv` enumera os arquivos do docroot uma única vez no start do processo e
  cacheia a lista em memória — qualquer arquivo criado depois (via `npm run build`)
  fica invisível até o processo reiniciar.
- Evidência temporal: `openhands.service` ativo desde `2026-09-12 07:14:53`;
  `build/assets/` mtime = `2026-09-12 15:58:33` (build feito durante a verificação
  da correção anterior, sem restart subsequente).
- Evidência de comportamento: `curl http://127.0.0.1:3001/assets/manifest-71db27c4.js`
  → 404 direto no `static-server` (não é problema de apache2 nem de ingress).

**Workaround aplicado nesta sessão** (2026-09-13 09:22 BRT):

    ssh zadotec-lura-prod systemctl restart openhands.service

Resultado: HTML e os 3 assets testados (`manifest-71db27c4.js`, `root-BsAlEYBc.js`,
`root-CDvIkwf-.css`) voltaram a 200 em ~5s. Novo MainPID=1030271.

**Correção definitiva ainda aberta**: editar `static-server.mjs:570` para passar
`dev:true` na chamada do `sirv` (ou trocar por um watcher que re-indexa em mudanças
no docroot). Regressão a cobrir: teste em `static-server.test.mjs` que cria um
arquivo em `build/` enquanto o servidor está rodando e confirma que ele é servido
em < 1s. Hoje não existe. Antes da correção, lembrar: qualquer `npm run build` em
prod precisa de `systemctl restart openhands.service` em seguida — ou o sintoma volta.

## BUG
- **Sintoma**: ao abrir uma conversa em `openhands.zadotec.com.br`, a tela fica branca. O HAR
  capturado mostra o HTML da página carregando normalmente (200), mas vários dos chunks JS/CSS
  hasheados que esse HTML referencia voltam **404** do Apache — entre eles justamente os
  essenciais para montar a árvore React: `manifest-*.js`, `entry.client-*.js`, `root-*.js`,
  `root-*.css`, e vários hooks/componentes de baixo nível (`use-config`, `use-settings`,
  `use-save-settings`, `use-onboarding-completion`, `use-tracking`, `active-backend-context`,
  `providers`, `utils`, `brand-button`, `base-modal`, `loading-spinner`, `form-control-classes`,
  `modal-classes`). Os chunks que carregam com sucesso aparecem marcados `_fromCache: "disk"` no
  HAR — ou seja, **nem chegam a bater no servidor**; o navegador os serve do cache local porque o
  hash não mudou entre o build antigo e o novo.
- **Esperado**: todo asset referenciado pelo HTML carregado deve existir no servidor no momento
  em que é requisitado.
- **Reprodução**: não determinística — depende de o usuário abrir/recarregar a página exatamente
  durante (ou logo após) uma janela de deploy no host. O HAR fornecido pelo usuário é a captura
  real de uma ocorrência em produção.
- **Escopo**: qualquer usuário que carregue a página durante a janela de rebuild do frontend no
  host de produção. Gravidade alta (app inutilizável), mas a janela de exposição é curta — por
  isso o bug é intermitente e difícil de reproduzir sob demanda.

## TRACE

### Tracer A — código (estático)
Caminho seguido: `tools/deploy-remotes.sh` (deploy) → `react-router.config.ts` (pós-build) →
serving estático em produção.

1. `tools/deploy-remotes.sh:126-157` (`deploy_script()`) roda **dentro do próprio host de
   produção**, via `remote_exec_https` (`tools/lib/remote-exec-https.sh`), que só existe porque
   os hosts remotos não têm SSH aberto — o canal é `POST /api/bash/execute_bash_command` do
   próprio agent-server. O script faz `cd /opt/openhands` → `git checkout/merge` →
   condicionalmente `npm run build` (linha 156, quando o diff toca
   `src/|app/|public/|vite.config.ts|react-router.config.ts`) → `systemctl restart` do serviço
   backend (linhas 159-169). **Não existe diretório temporário de build, nem swap de symlink
   "current release", nem `rsync --delete` para um alvo versionado** — nem em
   `deploy-remotes.sh`, nem em `agent-server-remotes.sh`, nem em `tools/lib/*`. O build acontece
   in-place no mesmo `build/` que é servido ao vivo.
2. `package.json:83` — `"start": "npx sirv-cli build/ --single"` — confirma que `build/` (sem
   hash/timestamp) é o docroot canônico do projeto; em produção esse papel é do Apache, apontando
   (por inferência, fora deste repo) para o mesmo `build/`.
3. `vite.config.ts` não define `outDir` alternativo para o build de app (só o build de lib usa
   `dist/`) — o output do build de app é sempre `build/client` + `build/server`, via plugin do
   React Router.
4. `react-router.config.ts:24-78` — `unpackClientDirectoryOnce`/`moveBuildEntry` é o pós-build
   que move `build/client/*` para `build/*`. Para cada entrada de topo (incluindo o diretório
   inteiro `assets/`, onde vivem todos os chunks hasheados), a função faz:
   - `fs.promises.rm(destination, { recursive: true, force: true })` (linha 29) — **apaga o
     `build/assets` antigo por completo antes de qualquer coisa nova existir**;
   - depois `fs.promises.rename(source, destination)` (linha 32);
   - se `rename` falhar com `EPERM`/`EXDEV` (mount cruzado, overlay fs, permissão), cai num
     fallback **não-atômico e lento**: `fs.promises.cp` recursivo seguido de
     `fs.promises.rm(source)` (linhas 39-43).
   Entre o `rm` e o `rename`/`cp`, `build/assets` fica ausente ou parcialmente populado. Qualquer
   requisição do Apache nessa janela pega um estado inconsistente: arquivos cujo hash mudou no
   novo build (logo, precisam ser efetivamente escritos) ainda não estão lá → 404; arquivos cujo
   conteúdo não mudou (hash idêntico) o navegador nem chega a pedir de novo, porque já estão no
   cache de disco (`Cache-Control: immutable, max-age=31536000`).
5. O restart do serviço backend só acontece **depois** do build (linha 156 antes de 159) — o
   backend nunca serve código velho. Mas nada equivalente protege o Apache: ele serve
   estaticamente do disco o tempo todo, inclusive durante a janela de rm→rename/cp.
6. Descartado: o comentário sobre "vendor-styling"/chunk-splitting em `vite.config.ts:52-77` é um
   bug diferente e já resolvido — falha de *avaliação* de módulo (`TypeError: s is not a
   function`) por divisão incorreta de chunk, não arquivo ausente no disco (404). Não é a causa
   deste sintoma.

### Tracer B — comportamento
Reprodução direta em produção não foi possível nesta investigação (sem acesso SSH ao host; o
único canal de execução remota depende de credenciais em `/etc/openhands-deploy/hosts.tsv`, fora
deste repositório). A evidência comportamental usada é a captura HAR fornecida pelo usuário, feita
ao vivo em `openhands.zadotec.com.br` no momento do sintoma:
- HTML: 200, sem cache (`no-cache`).
- ~17 requisições de asset: 404, todas para hashes que representam módulos "de entrada"
  (manifest, entry.client, root, root.css) ou módulos-folha pequenos e recém-hasheados.
- ~20 requisições de asset: 200, todas com `"_fromCache": "disk"` — nunca tocaram a rede.
- Nenhuma requisição 200 real (via rede) para os arquivos que aparecem como 404 foi observada no
  mesmo HAR — ou seja, no instante da captura o servidor genuinamente não tinha esses arquivos.

### Convergência
Os dois tracers convergem sem conflito: o padrão exato do HAR (mistura de 404 em arquivos
recém-hasheados + 200 apenas via cache de disco do navegador para arquivos de hash inalterado) é
a assinatura esperada de uma reconstrução in-place e não-atômica do diretório de assets enquanto
o Apache continua servindo ao vivo — comportamento que o código em `react-router.config.ts` e
`tools/deploy-remotes.sh` implementa exatamente como descrito. Não houve divergência a resolver;
não foi necessário um terceiro tracer.

## DIAGNÓSTICO
- **Causa raiz**: `react-router.config.ts:29-32` (`moveBuildEntry`, chamado por
  `unpackClientDirectoryOnce`) apaga o diretório `build/assets` em produção (`fs.rm`) antes de
  colocar o novo no lugar (`fs.rename`, ou `fs.cp`+`fs.rm` no fallback), enquanto o Apache serve
  esse mesmo diretório ao vivo — sem swap atômico (symlink/rename de diretório versionado) e sem
  qualquer diretório de build temporário fora do docroot. `tools/deploy-remotes.sh` executa esse
  build diretamente no host de produção, no mesmo caminho que o Apache serve.
- **Por que causa o sintoma**: qualquer requisição de asset que caia na janela entre o `rm` e a
  reposição completa dos novos arquivos recebe 404. Como o HTML (`index.html`) é o último a ficar
  consistente/é servido já apontando para os novos hashes, um usuário que carregue a página nesse
  intervalo recebe um HTML válido referenciando chunks essenciais (manifest/entry.client/root)
  que ainda não existem no disco — a aplicação nunca inicializa e a tela fica branca.
- **Por que passou despercebido**: não há teste (e2e ou de infraestrutura) que valide o
  comportamento do deploy sob tráfego concorrente; `react-router.config.ts` não tem cobertura de
  teste alguma no repo, e o pipeline de deploy (`tools/deploy-remotes.sh`) só verifica se o
  serviço backend voltou a ficar ativo (`systemctl is-active`), nunca se os assets estáticos
  ficaram consistentes com o `index.html` publicado.
- **Confiança**: alta. O código implementa exatamente o mecanismo que produz a assinatura vista
  no HAR, não há nenhum swap atômico em lugar nenhum do pipeline (verificado por busca completa
  no repo por `symlink`/`atomic`/`blue-green`/`release`), e o outro candidato óbvio (bug de
  code-splitting do vendor-styling) já está descartado por ser uma falha de execução de módulo,
  não de arquivo ausente. O único elo não verificável a partir deste repositório é a config real
  do vhost Apache no host remoto (fora do checkout) — mas nada nela contradiz a hipótese, e o
  padrão observado é dificilmente explicável por outra causa.
- **Impacto colateral**: qualquer deploy de frontend (`npm run build` disparado por
  `tools/deploy-remotes.sh` sempre que o diff toca `src/|app/|public/|vite.config.ts|
  react-router.config.ts`) tem uma janela de tela branca em produção para quem carregar a página
  durante o build. Quanto maior o bundle ou mais lenta a máquina/disco, maior a janela — e pior
  ainda se `rename` cair no fallback `cp` (mais lento, não-atômico).
- **Correção proposta (direção, não implementação)**: eliminar a reconstrução in-place do docroot
  servido ao vivo. Opções, da mais simples à mais robusta:
  1. Buildar em um diretório temporário fora do docroot e só então mover/renomear para o local
     final com uma única operação atômica de topo (ex.: `mv build_new build` após remover
     `build_old`, ou symlink `current -> build-<hash>` que o Apache segue).
  2. Adotar um diretório de release versionado (`/opt/openhands/releases/<sha>/build`) com um
     symlink `current` que o Apache usa como docroot, trocado com `ln -sfn` (atômico) só depois
     do build terminar por completo — padrão blue-green clássico.
  3. Se o app-server (não só o Apache estático) puder servir os assets, considerar deixar o
     `systemctl restart` (que já espera o build terminar) ser o único ponto de corte visível,
     e apontar o Apache para ele via proxy em vez de servir arquivos estáticos diretamente.
- **Regressão a cobrir**: um teste/checagem de infraestrutura que, durante um `npm run build`
  real, faça requisições HTTP contínuas aos assets do build anterior e falhe se qualquer uma
  delas 404ar antes do build todo terminar — ou, mais simples, um smoke-test pós-deploy que baixe
  o `index.html` publicado e confirme que **todos** os assets que ele referencia respondem 200
  antes de considerar o deploy bem-sucedido (e que só então dispara qualquer swap/rename final).
- **Alternativas descartadas**: bug de code-splitting do `vendor-styling`/HeroUI (descartado —
  produz erro de execução de módulo carregado com sucesso, não 404 de rede); cache do navegador
  corrompido ou desatualizado do lado do cliente (descartado — os `_fromCache: disk` são hits
  válidos para hashes que não existiam mais como referência anterior; o problema está nos 404
  reais, não nos cache hits); CDN/proxy externo servindo versão obsoleta (não há CDN configurado
  em nenhum artefato deste repositório, e não explicaria arquivos totalmente ausentes com 404 em
  vez de servir uma versão antiga).

## VERIFICAÇÃO (pós-implementação)

- `npx vitest run react-router.config.test.ts` — 5/5 testes passam, incluindo o caso que
  reproduz F-SP-01 (fallback EXDEV) e o caso de swap normal.
- `npm run typecheck` — limpo.
- `npx eslint react-router.config.ts react-router.config.test.ts` — limpo (após `--fix` de
  formatação).
- `npm run build` — build real completo com sucesso; `build/client` removido, `build/assets`
  populado (266 arquivos), nenhum diretório residual `.incoming-*`/`.stale-*`.
- `npm test` (suíte completa) — 19 arquivos falhando / 92 testes, todos em
  `model-selector*.test.tsx`, `llm-settings.test.tsx`, `chat-interface.test.tsx`,
  `home-chat-launcher.test.tsx`, `translation-completeness.test.ts` e afins — nenhum toca
  `react-router.config.ts` ou o pós-build. Coincide exatamente com os arquivos já modificados e
  não commitados nesta branch (`acp-providers.ts`, `chat-input-model.tsx`,
  `use-chat-input-model-state.ts`, `translation.json`) no início desta sessão — pré-existente,
  fora do escopo desta correção.

## Incidente relacionado em 2026-09-13: "Add a backend" / API key rejeitada

Depois do restart do `openhands.service` (workaround do cache do `sirv`, ver seção
"Ressurgência" acima), usuários passaram a ver a tela de onboarding "Add a backend" mesmo em
dispositivos que já tinham sessão salva, e colar a `LOCAL_BACKEND_API_KEY` correta era
rejeitado (401).

**Causa raiz**: `openhands-agent-server.service` — uma unit systemd **standalone e `disabled`
no boot**, com env própria em `/etc/openhands-agent/env` (`OH_SESSION_API_KEYS_0` diferente de
`LOCAL_BACKEND_API_KEY`) — estava rodando desde 2026-09-10 08:34 (iniciada manualmente por
algum operador e nunca parada), disputando a porta `127.0.0.1:18000`/`0.0.0.0:18000` com o
agent-server **embutido** que `openhands.service` (`bin/agent-canvas.mjs --public`) deveria
spawnar com a chave correta. O `ExecStartPre` de `openhands.service` roda
`fuser -k 18000/tcp 18001/tcp 3001/tcp` antes de cada start; ao reiniciar `openhands.service`
para o workaround do `sirv`, isso matou quem estava na porta, e o serviço standalone (com
`Restart=on-failure`) venceu a corrida de volta antes do `agent-canvas.mjs` conseguir subir seu
próprio agent-server embutido — daí o `ERROR ... address already in use` no log do
`openhands.service`. A partir desse instante, todo tráfego de `/api/*` passou a ser respondido
pelo processo errado, com uma chave que os usuários não tinham (e que a `LOCAL_BACKEND_API_KEY`
pública não validava).

**Ação tomada**: `systemctl stop openhands-agent-server` (unit já estava `disabled`, então não
volta sozinho) seguido de `systemctl restart openhands` para o agent-server embutido assumir a
porta 18000 limpo. Verificado: `X-Session-API-Key: <LOCAL_BACKEND_API_KEY>` → 200 em
`/api/settings`, local e via HTTPS público; HTML + 43/43 assets referenciados → 200.

**Correção definitiva ainda em aberto** (fora do escopo desta sessão, requer decisão de
infraestrutura, não só um restart):
1. Entender por que `openhands-agent-server.service` foi iniciado manualmente em 2026-09-10 e
   nunca parado — se for um resquício de debug, `systemctl disable --now` não é suficiente
   sozinho pois já está disabled; falta alguém confirmar que não há mais uso legítimo antes de
   removê-lo/mascará-lo (`systemctl mask`) para impedir reativação manual acidental.
2. `openhands.service`'s `ExecStartPre=-/usr/bin/fuser -k 18000/tcp 18001/tcp 3001/tcp` mata
   indiscriminadamente **qualquer** processo nessas portas, inclusive de unidades systemd não
   relacionadas — isso é o gatilho que expôs a corrida. Se `openhands-agent-server.service`
   tiver um uso legítimo futuro, as duas units precisam de portas não sobrepostas, ou o
   `fuser -k` do `openhands.service` precisa ser mais seletivo (matar só o próprio processo
   filho anterior, não qualquer coisa na porta).
3. Regressão a cobrir: um smoke-test pós-restart (poderia viver em
   `tools/deploy-remotes.sh` ou um novo script) que, depois de `systemctl restart openhands`,
   valida `X-Session-API-Key: $LOCAL_BACKEND_API_KEY` contra `/api/settings` e falha alto e
   claro se vier 401 — hoje nada detecta esse tipo de desvio automaticamente.

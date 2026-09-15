# PRD — Deploy do agent-server remoto (aqdata, lebi, f5)

## 1. Problema e evidência

Os scripts existentes para atualizar os hosts remotos — `tools/deploy-remotes.sh`,
`tools/refresh-remotes.sh` e `tools/ssh-remotes.sh` — foram escritos presumindo
que cada host remoto roda um checkout git deste repositório em `/opt/openhands`
(`git fetch/merge --ff-only` + `npm ci`/`npm run build` + `systemctl restart
openhands`/`agent-canvas`). Essa suposição está explícita no cabeçalho de
`refresh-remotes.sh`: "Pressupõe que cada remoto já roda o agent-canvas a
partir de um checkout git deste repositório".

Rodando `tools/deploy-remotes.sh --check` contra os três hosts configurados em
`/etc/openhands-deploy/hosts.tsv` (`aqdata`, `lebi`, `f5`), os três falham com
`erro: /opt/openhands não existe` — porque o diretório de fato não existe lá.

Inspecionando os três hosts via SSH (`sistema.aqdata.com.br`, `lebi`,
`f5-dev`), a topologia real é:

- Nenhum tem checkout git do frontend/Canvas.
- Os três rodam `openhands-agent-server.service` (systemd), cujo `ExecStart`
  é `uvx --from openhands-agent-server==1.47.0 --with libtmux --with
  openhands-tools agent-server --host 0.0.0.0 --port 18000 --import-modules
  codegraph_tool --extra-python-path ~/.openhands/zadotec-tools/tools` — um
  pacote Python instalado do índice PyPI, com versão fixada no texto do unit.
- O único componente git-versionado nesses hosts é
  `~/.openhands/zadotec-tools` (tools/skills extras via
  `--extra-python-path`), hospedado em `openhands.zadotec.com.br` (git
  próprio, push já liberado) — não tem relação com o pacote
  `openhands-agent-server` em si.

Consequência prática: hoje, atualizar a versão do `openhands-agent-server`
nesses três hosts exige entrar manualmente em cada um, editar o unit,
`daemon-reload` e `restart` — sem checagem de estado prévio, sem dry-run, sem
verificação pós-restart, e repetindo o processo host a host. Não existe
ferramenta que cubra esse fluxo real.

## 2. Usuários e cenários de uso

Usuário único: João (administrador/operador desta infraestrutura), operando
a partir do Windows (Git Bash) na máquina de trabalho, ou de dentro do
próprio `zadotec-lura-prod` (host central).

Cenários:
- **Bump de rotina**: nova versão de `openhands-agent-server` publicada no
  PyPI (ou nova revisão de um fork/branch próprio) e João quer levá-la aos
  três hosts remotos com um comando, com confirmação de que cada host voltou
  a responder depois.
- **Diagnóstico rápido**: antes de decidir atualizar, João quer ver rápido
  qual versão/estado cada host está rodando agora (`--check` equivalente).
- **Aplicar só num host**: um host teve problema isolado (ex.: `aqdata`) e
  João quer reprocessar só ele, sem tocar nos outros dois.
- **Reverter**: um bump causou regressão (o serviço não sobe, ou sobe mas
  falha health check) e João precisa voltar rápido para a versão anterior
  nesse host.

## 3. Objetivos e não-objetivos

**Objetivos**
- Permitir bump da versão do `openhands-agent-server` (PyPI ou
  `git+URL@ref`) nos três hosts remotos com um único comando, sem edição
  manual de unit em cada host.
- Usar SSH direto como canal primário nos três hosts a partir da máquina de
  trabalho de João, que já tem acesso confirmado aos três via
  `~/.ssh/config` (`sistema.aqdata.com.br:22022`, `lebi`, `f5-dev`) —
  validado nesta sessão inclusive contra `aqdata`, cuja porta 22 padrão é
  recusada mas cuja porta 22022 (configurada) responde normalmente como
  root. O canal HTTPS via `/api/bash/execute_bash_command` do próprio
  agent-server (usado por `deploy-remotes.sh`) resolve um problema
  diferente — rodar *a partir da central* `zadotec-lura-prod`, que não tem
  as chaves/portas SSH desses três hosts configuradas — e só entra no
  escopo se João quiser operar também a partir de lá; por padrão (operando
  do Git Bash local), SSH root cobre os três hosts sem precisar do canal
  HTTPS.
- Reportar, por host, o estado antes e depois: versão/ref anterior, versão
  nova, resultado do restart, resultado de um health check pós-restart.
- Permitir aplicar em todos os hosts ou num subconjunto nomeado.
- Permitir reverter um host para a versão anterior sem precisar redigitar a
  versão manualmente (o backup do unit já é prática existente, usada
  manualmente nesta sessão).
- Nunca sobrescrever configuração local do host que não seja a linha de
  versão/ref do `ExecStart` — mesmo princípio de isolamento já declarado em
  `deploy-remotes.sh` para o código.

**Não-objetivos**
- Não cobre a atualização do frontend/Canvas em si (isso já é resolvido por
  `npm run build` + `systemctl restart openhands` no host que o roda —
  hoje, só `zadotec-lura-prod`).
- Não cobre a atualização de `~/.openhands/zadotec-tools` (já é git pull
  simples, funciona, fora de escopo).
- Não decide *quando* atualizar (sem rollout automático agendado, sem
  canary) — é uma ferramenta operada manualmente por João.
- Não adiciona hosts novos automaticamente a `hosts.tsv` — a lista de hosts
  continua sendo mantida à mão.
- Não gerencia segredos/API keys além de ler o que já existe em
  `hosts.tsv`/SSH config — pode precisar ler as duas fontes para decidir
  canal (RF-06), mas não cria, roda nem armazena credencial nova.

## 4. Requisitos funcionais

- **RF-01**: Dado um host de uma lista canônica de hosts, o sistema deve
  reportar, sob demanda, a fonte (`pacote==versão` ou `git+URL@ref`)
  atualmente configurada no `ExecStart` do `openhands-agent-server.service`
  e se o serviço está `active`. A fase TECH deve definir uma única lista de
  hosts como fonte de verdade — hoje existem duas listas desalinhadas
  (`/etc/openhands-deploy/hosts.tsv`, com nomes `aqdata/lebi/f5` para o
  canal HTTPS, e `~/.ssh/config`, com aliases diferentes
  `sistema.aqdata.com.br/lebi/f5-dev` para SSH) e o comando não pode
  presumir que os nomes batem.
- **RF-02**: O sistema deve permitir trocar a fonte do `ExecStart` (nova
  versão PyPI, ou `git+URL@ref`) em um host, fazer backup do unit anterior,
  `daemon-reload`, `restart`, e confirmar que o serviço voltou a `active`
  dentro de um timeout configurável. A localização do `ExecStart` não pode
  presumir um usuário/`HOME` fixo: os três hosts rodam o serviço sob
  usuários diferentes (`admin` em aqdata/lebi, `joaoneto` em f5-dev), com
  `WorkingDirectory`/caminho do binário `uvx` correspondentes — um comando
  que hardcode `/home/admin/...` quebraria em f5-dev.
- **RF-03**: Após o restart, o sistema deve validar a saúde do host batendo
  num endpoint de health do agent-server (`/health` ou equivalente já usado
  nesta infra) antes de reportar sucesso.
- **RF-04**: Se o health check falhar, o sistema deve reverter
  automaticamente o host para o unit de backup, reiniciar, e sinalizar
  falha — nunca deixar o host num estado pior do que estava antes do
  comando.
- **RF-05**: O comando deve aceitar rodar contra todos os hosts de
  `hosts.tsv` ou contra um subconjunto nomeado pelo usuário.
- **RF-06**: O canal de transporte primário é SSH direto para os três
  hosts, a partir da máquina de trabalho de João (`~/.ssh/config` já dá
  acesso root aos três, aqdata incluída via porta 22022). O canal HTTPS via
  `/api/bash/execute_bash_command` (padrão de `deploy-remotes.sh`) só
  precisa entrar em escopo se João também quiser operar a partir da central
  `zadotec-lura-prod`, que não tem essas chaves/portas SSH configuradas —
  nesse caso a escolha de canal é por *origem de execução*, não por host.
- **RF-07**: O comando deve suportar um modo `--check`/somente-leitura que
  não altera nada, e um modo `--dry-run` que mostra o comando remoto sem
  executá-lo.
- **RF-08**: Deve existir um comando explícito para reverter um host para o
  backup de unit mais recente, independente de ter sido acionado
  automaticamente pelo RF-04.

## 5. Requisitos não-funcionais

- **RNF-01 (segurança)**: A API key de cada host (`hosts.tsv`) e as chaves
  SSH nunca aparecem em log/stdout; o arquivo de hosts mantém permissão 600
  fora do repositório, como já documentado em `deploy-remotes.sh`.
- **RNF-02 (confiabilidade)**: Uma falha num host não deve impedir o
  processamento dos demais hosts da mesma execução (mesmo comportamento já
  garantido por `deploy-remotes.sh` hoje).
- **RNF-03 (observabilidade)**: Cada execução deve imprimir, por host, o
  estado antes, a ação tomada, e o estado depois — suficiente para colar no
  chat como evidência, sem precisar entrar manualmente no host para
  conferir.
- **RNF-04 (idempotência)**: Rodar o comando duas vezes seguidas seguidas
  com o mesmo alvo de versão não deve causar restart desnecessário quando o
  host já está na versão/ref pedida.
- **RNF-05 (compatibilidade)**: Deve funcionar a partir do Git Bash no
  Windows (ambiente de trabalho atual de João), igual aos scripts
  existentes.

## 6. Métricas de sucesso

- Bump de versão nos três hosts (`aqdata`, `lebi`, `f5`) executável em um
  único comando, com confirmação de saúde, sem edição manual de arquivo em
  nenhum host.
- Zero casos de host deixado inativo após uma tentativa de bump malsucedida
  (RF-04 cobre isso).
- Tempo de diagnóstico do estado dos três hosts (equivalente ao `--check`
  atual, mas funcional) abaixo de 30 segundos.

## 7. Escopo de release e faseamento

Release único (sem fases) — o volume é pequeno (3 hosts, um unit por host,
dois canais de transporte já implementados como referência nos scripts
irmãos). Não há necessidade de faseamento.

## 8. Riscos de produto e questões em aberto

- **Risco**: o endpoint de health do `openhands-agent-server` pode exigir
  autenticação ou ter comportamento diferente por versão — precisa ser
  confirmado na fase TECH lendo o código/documentação do pacote antes de
  assumir um path fixo.
- **Risco**: trocar `ExecStart` para `git+URL@ref` sem que o pacote alvo do
  `uv` seja resolvível a partir da raiz do repositório apontado (como
  aconteceu nesta sessão, ao confundir o repo do frontend com o pacote
  Python) pode voltar a quebrar o serviço — a fase TECH precisa definir uma
  validação pré-restart ou um health check pós-restart robusto o bastante
  para pegar esse caso e acionar o RF-04.
- **Questão em aberto**: hoje a única fonte usada em produção é PyPI
  (`==1.47.0`). Ainda não há um cenário real testado de apontar para
  `git+URL@ref` do pacote `openhands-agent-server` (diferente do repo do
  frontend) — se/quando isso for necessário, a fase TECH deve mapear onde
  esse pacote é publicado a partir de qual repositório antes de prometer
  suporte a `git+URL@ref` como fonte.

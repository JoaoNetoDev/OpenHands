# TECH — Deploy do agent-server remoto (aqdata, lebi, f5)

## 1. Estado atual da arquitetura nos pontos tocados

- `tools/deploy-remotes.sh:1-15` — canal HTTPS via
  `POST /api/bash/execute_bash_command` do próprio agent-server, justificado
  no cabeçalho como necessário porque "os remotos não têm SSH acessível a
  partir da central" (`deploy-remotes.sh:5-6`). Isso é verdade só quando se
  roda *a partir da central* `zadotec-lura-prod` — não é uma propriedade do
  host em si (achado do validador do PRD, F-PRD-01).
- `tools/deploy-remotes.sh:98-120` — `remote_exec()` implementa o transporte
  HTTPS: serializa o script em base64, faz `POST` com header
  `X-Session-API-Key`, decodifica e roda via `bash` no remoto.
- `tools/deploy-remotes.sh:74-91` — lê `/etc/openhands-deploy/hosts.tsv`
  (formato `nome|url|api_key`, um host por linha). Confirmado no host:
  `-rw------- 1 root root 335 ... hosts.tsv`, linhas `aqdata`, `lebi`, `f5`.
- `tools/refresh-remotes.sh:1-20` — canal SSH, cabeçalho explícito: "Pressupõe
  que cada remoto já roda o agent-canvas a partir de um checkout git deste
  repositório" — premissa que não vale para nenhum dos 3 hosts-alvo desta
  feature (confirmado: nenhum tem `/opt/openhands`).
- `tools/ssh-remotes.sh:39` — lê hosts de
  `${OPENHANDS_SSH_HOSTS:-$(dirname "$0")/remotes.tsv}`; esse arquivo **não
  existe** hoje em `/opt/openhands/tools/` (confirmado: `remotes.tsv: No
  such file or directory`). (`ssh-remotes.sh:29-33` são só os comentários de
  exemplo de formato no cabeçalho, não o código que lê a variável.) O canal SSH real usado nesta sessão foi via
  `~/.ssh/config` da máquina de trabalho, com aliases `sistema.aqdata.com.br`
  (porta 22022), `lebi`, `f5-dev` — nomes que **não batem** com
  `aqdata`/`lebi`/`f5` do `hosts.tsv`.
- Nos três hosts-alvo, `/etc/systemd/system/openhands-agent-server.service`
  tem `ExecStart=<prefixo-bin>/uvx --from openhands-agent-server==1.47.0
  --with libtmux --with openhands-tools agent-server --host 0.0.0.0 --port
  18000 --import-modules codegraph_tool --extra-python-path
  <HOME>/.openhands/zadotec-tools/tools`, confirmado por `systemctl cat` em
  cada host nesta sessão. Diferença real entre hosts: `User=admin` /
  `Group=admin` / `WorkingDirectory=/home/admin` em aqdata e lebi;
  `User=joaoneto` / `WorkingDirectory=/home/joaoneto` em f5-dev — logo o
  prefixo do binário `uvx` (`/home/admin/.local/bin/uvx` vs.
  `/home/joaoneto/.local/bin/uvx`) varia por host.
- O agent-server expõe `/health`, `/alive`, `/ready` sem autenticação na
  porta 18000 local (confirmado via `curl 127.0.0.1:18000/health` → 200,
  `/api/health` → 404, validado pelo validador do PRD).
- Erro real já reproduzido nesta sessão: apontar `--from` para
  `git+https://github.com/JoaoNetoDev/OpenHands@<branch>` (o repo do
  frontend, sem `pyproject.toml`/`setup.py` na raiz) falha com `error:
  Failed to resolve --with requirement ... does not appear to be a Python
  project`, e o serviço entra em crash-loop (`status=1/FAILURE`, restart
  automático do systemd repetindo o erro). Confirma que qualquer troca de
  `--from` precisa de validação pós-restart real, não só "`systemctl
  is-active` no instante seguinte" (na primeira checagem depois do restart
  o serviço ainda aparecia `active`/`activating`, e só falhava alguns
  segundos depois, durante a resolução do `uv`).

## 2. Arquitetura proposta

Um script novo, `tools/agent-server-remotes.sh`, canal SSH como transporte
primário, mais um arquivo de mapeamento de hosts versionado no repo (sem
segredo) que reconcilia os nomes canônicos com os aliases de
`~/.ssh/config`:

```
tools/agent-hosts.tsv          # versionado, SEM segredo — nome canônico -> alvo SSH
  aqdata|sistema.aqdata.com.br
  lebi|lebi
  f5|f5-dev
```

Responsabilidades do script:

1. **Descoberta de estado** (`--check`): para cada host, via SSH, extrai a
   linha `ExecStart=` do unit, reporta a fonte atual (`pacote==versão` ou
   `git+URL@ref`), o usuário/`HOME` do serviço, e `systemctl is-active`.
2. **Atualização** (`--set-version PKG==VER` ou `--set-ref
   git+URL[@ref][#subdirectory=...]`): por host —
   a. lê o unit atual, extrai `User=`/`WorkingDirectory=` para montar o
      caminho correto do `uvx` (nunca hardcoda `/home/admin`);
   b. copia o unit para `<unit>.bak.<epoch>` (mesmo padrão manual usado
      nesta sessão para o rollback real que já aconteceu);
   c. substitui **só** o token que segue `--from ` — **não** via `sed`
      regex (rejeitado: um valor `git+https://host/org/repo@ref#subdirectory=path`
      contém `/`, `#` e potencialmente `&`, que quebram ou corrompem
      qualquer delimitador comum de `sed s///` e o caractere `&` do lado da
      substituição é interpretado por `sed` como "padrão casado inteiro" —
      testado e reproduzido: corrompe a linha e mistura valor antigo com
      novo). Implementação robusta: ler a linha `ExecStart=` inteira, fazer
      *word-splitting* nela (os tokens do `ExecStart` são separados por
      espaço simples, sem espaços dentro de nenhum valor hoje — confirmado
      nos 3 units reais), localizar o índice do array cujo valor é
      `--from`, substituir o índice seguinte pelo novo valor, e rejuntar o
      array com espaço. Isso preserva qualquer flag customizada de um host
      sem depender de regex/escaping de metacaracteres;
   d. `systemctl daemon-reload && systemctl restart
      openhands-agent-server`;
   e. faz *poll* de `GET http://127.0.0.1:18000/health` por SSH (com
      `curl -sf`, ou fallback para `systemctl is-active` se `curl` não
      existir no host) a cada 2s até um timeout configurável (default 60s,
      folga acima dos ~15-20s observados nesta sessão entre restart e o
      `uv` terminar de resolver/instalar uma fonte git);
   f. se o health check não passar dentro do timeout, restaura
      automaticamente o `.bak` mais recente, repete
      `daemon-reload`+`restart`, e finaliza o host com status `FALHOU
      (revertido)` — nunca deixa o host propositalmente pior do que estava.
3. **Rollback explícito** (`--rollback`): mesma restauração do passo 2.f,
   mas disparada sob demanda para um host específico, independente de ter
   havido uma tentativa de update na mesma execução (cobre o cenário "bump
   de ontem causou problema silencioso, quero voltar agora").
4. **Escopo de hosts**: todos os hosts de `agent-hosts.tsv` por padrão, ou
   um subconjunto nomeado nos argumentos posicionais — mesma convenção de
   CLI dos scripts irmãos (`deploy-remotes.sh aqdata lebi`).
5. **Canal alternativo HTTPS** (`--channel https`): reusa a função
   `remote_exec()` de `deploy-remotes.sh:98-120` como biblioteca (extraída
   para `tools/lib/remote-exec-https.sh` e importada por ambos os scripts,
   para não duplicar a lógica de base64+POST), lendo credenciais de
   `/etc/openhands-deploy/hosts.tsv` pelo mesmo nome canônico de
   `agent-hosts.tsv`. Só necessário se o script rodar a partir de
   `zadotec-lura-prod` (sem as chaves SSH do João) — não é o modo padrão.

## 3. Modelo de dados e migrações

Não há banco de dados. Dois arquivos texto:

- `tools/agent-hosts.tsv` (novo, versionado): `nome|alvo_ssh`. Sem segredo
  — `alvo_ssh` é só o alias/hostname que já existe em `~/.ssh/config`;
  autenticação continua 100% por chave SSH do agente do usuário.
- `/etc/openhands-deploy/hosts.tsv` (já existe, inalterado no formato):
  continua sendo a fonte de credencial do canal HTTPS opcional. A ligação
  entre os dois é só o campo `nome`, que passa a ser obrigatoriamente igual
  nos dois arquivos (`aqdata`, `lebi`, `f5`) — documentado no cabeçalho do
  script novo para não repetir a divergência de nomes encontrada nesta
  sessão.

## 4. Contratos

CLI do script novo (mesma convenção de flags dos irmãos):

```
tools/agent-server-remotes.sh --check [host...]
tools/agent-server-remotes.sh --set-version openhands-agent-server==1.48.0 [host...]
tools/agent-server-remotes.sh --set-ref "git+https://github.com/<org>/<repo>@<ref>#subdirectory=<path>" [host...]
tools/agent-server-remotes.sh --rollback [host...]
tools/agent-server-remotes.sh --dry-run --set-version ... [host...]
tools/agent-server-remotes.sh --channel https --set-version ... [host...]

Flags:
  --check                 só reporta estado, não altera nada
  --dry-run               mostra o comando remoto sem executar
  --set-version <spec>    troca --from para "pacote==versão" (PyPI)
  --set-ref <spec>        troca --from para "git+URL[@ref][#subdirectory=...]"
  --rollback              restaura o .bak mais recente do unit em cada host
  --channel ssh|https     transporte a usar (default: ssh)
  --timeout <s>           timeout do health check pós-restart (default: 60)
  --hosts-file <path>     override de tools/agent-hosts.tsv
```

Saída por host, uma linha de resumo + bloco de detalhe, no padrão já usado
por `deploy-remotes.sh` (`log`/`ok`/`err` coloridos em stderr): nome do
host, ação, fonte antes → depois, resultado do health check, e se houve
rollback automático.

Código de saída: `0` só se todos os hosts processados tiveram sucesso —
mesma convenção de `deploy-remotes.sh` (conta falhas, sai `1` se
`failures > 0`).

## 5. Alternativas consideradas

- **Manter canal HTTPS como primário** (como o PRD original propunha antes
  da correção do validador): rejeitada como *padrão* porque adiciona uma
  superfície de execução-arbitrária-como-root via HTTP para um caso em que
  SSH com chave dedicada já funciona e é mais restrito por design (a API key
  do agent-server dá `execute_bash_command` irrestrito; a chave SSH já é
  esse mesmo nível de acesso, mas é o mecanismo padrão de administração
  desses hosts). Mantido como opção (`--channel https`) para o caso real de
  rodar a partir da central.
- **Reescrever `refresh-remotes.sh` no lugar** de criar um script novo:
  rejeitada — `refresh-remotes.sh` continua válido para seu propósito
  original (hosts que rodam checkout git do frontend, se algum dia
  existirem); misturar os dois modelos no mesmo script aumentaria a
  complexidade condicional sem necessidade, já que os conjuntos de hosts
  são disjuntos hoje.
- **`sed` na linha inteira do `ExecStart`** em vez de só no token após
  `--from`: rejeitada — um host pode ter flags extras específicas (já visto
  nesta sessão: `--extra-python-path` aponta para `HOME` diferente por
  host), então regravar a linha toda exigiria reconstruir todas as flags e
  arriscaria descartar uma customização local, violando o princípio "nunca
  sobrescrever configuração local" já estabelecido em
  `deploy-remotes.sh:11-15`.
- **`sed s/.../.../` mesmo só no token isolado**: testada e rejeitada —
  reproduzido que um valor `git+URL@ref#subdirectory=path` (o próprio caso
  de uso do `--set-ref`) quebra qualquer delimitador comum de `sed`
  (`/`, `#`, `|` sem blindagem) e que um `&` no valor de substituição é
  interpretado por `sed` como "padrão casado", corrompendo a linha. Trocado
  por *word-splitting* + substituição de índice de array (§2.2.c), que não
  depende de nenhum caractere do valor ser "seguro" para regex.
- **Sem backup/rollback automático, só reportar erro**: rejeitada —
  contraria RF-04 do PRD, e o incidente desta própria sessão (troca de
  `--from` quebrando os 3 hosts) mostrou que o tempo entre "restart" e
  "falha visível" pode passar de um `systemctl is-active` ingênuo rodado
  cedo demais.

## 6. Segurança, permissões e privacidade

- Nenhuma credencial nova é introduzida. SSH usa a chave já configurada no
  agente do usuário; o canal HTTPS opcional usa a API key já existente em
  `/etc/openhands-deploy/hosts.tsv` (permissão 600, fora do repo).
- `tools/agent-hosts.tsv` é seguro para versionar: contém só nomes e
  aliases SSH, nenhum segredo.
- O script nunca imprime a API key HTTPS em stdout/stderr (mesma garantia
  de `deploy-remotes.sh`, que só usa a key no header HTTP).
- Toda operação de escrita (`--set-version`/`--set-ref`/`--rollback`) exige
  SSH root (ou `sudo` via SSH) no host de destino — sem elevação de
  privilégio nova em relação ao que já existe.

## 7. Performance e escala

Escala fixa e pequena (3 hosts, crescimento incremental improvável no curto
prazo). Sem otimização necessária além de paralelizar as chamadas SSH entre
hosts (nice-to-have, não crítico — hoje `deploy-remotes.sh` roda sequencial
e isso nunca foi um problema reportado).

## 8. Observabilidade

- Saída estruturada por host no stdout/stderr da própria execução (não há
  infra de log centralizado para esses scripts hoje — mesmo padrão dos
  scripts irmãos).
- O estado "antes" de cada operação (fonte do `ExecStart`, resultado do
  `systemctl is-active`) é sempre impresso antes de qualquer alteração,
  para servir de evidência colável no chat, como já vem sendo feito
  manualmente nesta sessão.

## 8.1 Gate de código (estado da base antes de planejar em cima dela)

- `npm run lint`/`npm run typecheck` do projeto não foram rodados: esta
  feature só adiciona/altera scripts bash em `tools/`, não toca em
  `src/`/TypeScript, e a árvore de `/opt/openhands` já tem mudanças não
  commitadas de outra frente de trabalho em andamento — rodar o lint do
  projeto inteiro misturaria escopo sem checar nada relevante para esta
  feature.
- `shellcheck` **não está instalado** no host `zadotec-lura-prod`
  (confirmado: `which shellcheck` não encontra o binário). É uma
  dependência da estratégia de teste estático do §9 — precisa ser instalado
  (`apt install shellcheck` ou equivalente) antes ou durante a sprint que
  criar os scripts novos, ou o teste estático fica sem essa camada.

## 9. Estratégia de testes

- **Unitário/estático**: `shellcheck` nos scripts novos e nos alterados
  (mesma prática implícita dos scripts existentes, que já são POSIX-ish
  cuidadosos com `set -euo pipefail`).
- **Integração real controlada**: `--check` e `--dry-run` contra os 3 hosts
  reais antes de qualquer `--set-version`/`--set-ref` real — não há
  ambiente de staging para esses hosts, então o teste de integração É
  contra produção, por isso o RF-04 (rollback automático) é o mecanismo de
  segurança, não um "nice to have".
- **Teste do caminho de falha**: validar deliberadamente o cenário já
  reproduzido nesta sessão (apontar `--set-ref` para uma fonte que falha a
  resolver `--with`) num host e confirmar que o rollback automático
  devolve o serviço a `active` sozinho, sem intervenção manual — este é o
  teste de aceite mais importante da feature inteira.

## 10. Rollout, feature flag e rollback

Sem feature flag — é uma ferramenta operacional, não um comportamento de
produto exposto a usuário final. Rollout: o script fica disponível em
`tools/` assim que mergeado; primeiro uso real recomendado é `--check` nos
3 hosts (somente leitura) para validar a extração do `ExecStart` antes de
qualquer `--set-version` real. Rollback da própria feature (não do agent-
server): reverter o commit, os scripts atuais continuam existindo e
utilizáveis manualmente como hoje.

## 11. Rastreabilidade PRD → TECH

| Requisito PRD | Onde é atendido |
|---|---|
| RF-01 | §2.1 (`--check`), `agent-hosts.tsv` como lista canônica (§3) |
| RF-02 | §2.2.a-d (edição do `--from`, backup, restart) |
| RF-03 | §2.2.e (poll de `/health`) |
| RF-04 | §2.2.f (rollback automático em falha do health check) |
| RF-05 | §2.4 (todos os hosts ou subconjunto nomeado) |
| RF-06 | §2 (SSH primário) + §2.5 (`--channel https` opcional) |
| RF-07 | §4 (flags `--check`, `--dry-run`) |
| RF-08 | §2.3 (`--rollback` explícito) |
| RNF-01 | §6 (nenhuma credencial nova, nunca logada) |
| RNF-02 | §4 (código de saída conta falhas por host, não aborta os demais) |
| RNF-03 | §8 (estado antes/depois sempre impresso) |
| RNF-04 | §2.2 (comparar fonte atual vs. alvo antes de agir — não fica explícito acima: ver nota) |
| RNF-05 | §1/§2 (bash puro, compatível com Git Bash, mesma base dos scripts existentes) |

**Nota de idempotência (RNF-04)**: o passo 2.b-d só deve rodar se a fonte
extraída no passo 2.a já for diferente do alvo pedido; se for igual, o
script reporta "já está em `<fonte>`" e pula backup/restart — evita
restart desnecessário ao repetir o comando com o mesmo alvo.

# SPEC — Deploy do agent-server remoto (aqdata, lebi, f5)

## 1. Resumo e escopo

Criar `tools/agent-server-remotes.sh` (script bash novo) para inspecionar,
atualizar, e reverter a fonte (`--from`) do `openhands-agent-server` nos
units systemd dos três hosts remotos, via SSH primário, com backup e
rollback automático em falha de health check. Extrair o transporte HTTPS de
`deploy-remotes.sh` para uma lib compartilhada, para oferecer `--channel
https` sem duplicar código. Criar `tools/agent-hosts.tsv` como lista
canônica de hosts versionada.

Fora do escopo (reafirmando o PRD): frontend/Canvas, `zadotec-tools`,
rollout agendado/canary.

## 2. Desenho detalhado por componente

### 2.1 `tools/agent-hosts.tsv` (novo, arquivo de dados)

```
# nome|alvo_ssh  — alvo_ssh é um Host de ~/.ssh/config (ou usuário@host[:porta])
aqdata|sistema.aqdata.com.br
lebi|lebi
f5|f5-dev
```

### 2.2 `tools/lib/remote-exec-https.sh` (novo)

Extrai a função `remote_exec()` hoje inline em `deploy-remotes.sh:97-131`
(comentário-cabeçalho em 97, `remote_exec() {` em 98, fecha em 131; a linha
133 é o cabeçalho de comentário da *próxima* seção, `check_script()`, e não
deve ser tocada) para uma lib fonteável por ambos os scripts. Assinatura
preservada:

```bash
# remote_exec_https <name> <url> <key> <script> [timeout_seconds]
# stdout/stderr do remoto são ecoados; retorna o exit code do script remoto.
remote_exec_https() { ... }   # corpo idêntico ao remote_exec() atual
```

`deploy-remotes.sh` passa a ter, logo após o shebang/comentários:
```bash
source "$(dirname "$0")/lib/remote-exec-https.sh"
```
e sua função local `remote_exec()` é removida (linhas 97-131 do arquivo
atual — a linha 133, `# --- scripts remotos`, é preservada intacta),
substituída pela chamada a `remote_exec_https`. Nenhuma mudança de
comportamento para quem já usa `deploy-remotes.sh` — mesmos parâmetros,
mesmo protocolo.

### 2.3 `tools/agent-server-remotes.sh` (novo, script principal)

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/remote-exec-https.sh"

CHANNEL="ssh"            # ssh | https
HOSTS_FILE="$(dirname "$0")/agent-hosts.tsv"
HTTPS_CONFIG="${OPENHANDS_DEPLOY_HOSTS:-/etc/openhands-deploy/hosts.tsv}"
TIMEOUT=60                # health check timeout, segundos
ACTION=""                 # check | set-version | set-ref | rollback
NEW_FROM=""
DRY_RUN=0
HOSTS=()                  # filtro posicional

# --- parsing (mesma convenção de flags de deploy-remotes.sh) ---
parse_args() { ... }      # popula as variáveis acima a partir de argv

# --- carregamento de hosts ---
# load_ssh_hosts -> preenche array global SSH_HOSTS["<name>"]="<alvo_ssh>"
#   lendo HOSTS_FILE, ignorando linhas em branco/comentário (mesmo parsing
#   de deploy-remotes.sh:141-149 para o formato nome|valor).
load_ssh_hosts() { ... }

# load_https_hosts -> preenche HTTPS_URL["<name>"] e HTTPS_KEY["<name>"]
#   lendo HTTPS_CONFIG no mesmo formato nome|url|key de deploy-remotes.sh.
#   Só chamada quando CHANNEL=https.
load_https_hosts() { ... }

# --- transporte ---
# ssh_exec <name> <script> -> ssh -o BatchMode=yes -o ConnectTimeout=15
#   "${SSH_HOSTS[$name]}" bash -s <<< "$script"; propaga exit code.
ssh_exec() { ... }

# exec_on <name> <script> -> despacha para ssh_exec ou remote_exec_https
#   conforme $CHANNEL; interface única usada pelo resto do script.
exec_on() { ... }

# --- leitura/edição do unit ---
# get_execstart_line <name> -> stdout: a linha ExecStart= crua do unit,
#   via `exec_on <name> "systemctl cat openhands-agent-server.service |
#   grep '^ExecStart='"`. Falha (exit != 0) se o unit não existir ou a
#   linha não for encontrada.
get_execstart_line() { ... }

# extract_from_value <execstart_line> -> stdout: só o valor que segue
#   "--from " no ExecStart (o token seguinte, sem espaços). Implementado
#   por word-splitting em bash (read -ra), NÃO por sed/regex — ver TECH §2.2.c
#   e §5 para o porquê (sed quebra com "/", "#" e "&" no valor de
#   git+URL@ref#subdirectory=...). Aborta com mensagem clara se o token
#   "--from" não existir na linha.
extract_from_value() { ... }

# build_new_execstart_line <execstart_line> <new_from_value> -> stdout: a
#   linha ExecStart= reconstruída com o token após "--from" substituído,
#   preservando prefixo, ordem e o CONTEÚDO de todos os demais tokens
#   (inclusive --extra-python-path específico de cada host). LIMITAÇÃO
#   CONHECIDA: por usar word-splitting (`read -ra`) e rejuntar com espaço
#   simples, espaçamento múltiplo pré-existente entre tokens é normalizado
#   para um espaço — testado e confirmado nos 3 ExecStart= reais (nenhum
#   tem espaço duplo hoje, então não afeta o caso real atual), mas a
#   garantia é "todo token preservado com espaçamento normalizado para
#   simples", não "bytes idênticos exceto o token trocado". Implementação: 
#     prefix="${line%%=*}="; rest="${line#*=}"
#     read -ra tokens <<< "$rest"
#     for i in "${!tokens[@]}"; do
#       [ "${tokens[$i]}" = "--from" ] && tokens[$((i+1))]="$new_from_value" && break
#     done
#     printf '%s%s\n' "$prefix" "$(IFS=' '; echo "${tokens[*]}")"
build_new_execstart_line() { ... }

# --- backup e escrita ---
# backup_unit <name> -> roda no remoto:
#   cp /etc/systemd/system/openhands-agent-server.service{,.bak.$(date +%s)}
#   stdout: caminho do backup criado (para log e para rollback explícito).
backup_unit() { ... }

# write_execstart <name> <new_execstart_line> -> substitui só a linha
#   ExecStart= do unit no remoto (via um script remoto que localiza a linha
#   por prefixo `ExecStart=` e a reescreve, preservando todas as outras
#   linhas do unit intactas — não usa sed na linha inteira do arquivo, usa
#   um script Python de 5 linhas rodado no remoto via exec_on, que lê o
#   arquivo, troca só a linha cujo prefixo é "ExecStart=", e escreve de
#   volta — evita qualquer problema de escaping de shell/sed no arquivo
#   final).
write_execstart() { ... }

# reload_and_restart <name> -> exec_on <name> "systemctl daemon-reload &&
#   systemctl restart openhands-agent-server"
reload_and_restart() { ... }

# --- verificação de saúde ---
# health_check <name> <timeout_seconds> -> faz poll a cada 2s, via
#   `exec_on <name> "curl -sf -o /dev/null -w '%{http_code}' --max-time 3
#   http://127.0.0.1:18000/health"`, até obter "200" ou estourar o timeout.
#   Retorna 0 se saudável dentro do prazo, 1 caso contrário.
health_check() { ... }

# --- rollback ---
# latest_backup <name> -> exec_on <name> "ls -t
#   /etc/systemd/system/openhands-agent-server.service.bak.* 2>/dev/null |
#   head -1"; vazio se não houver nenhum.
latest_backup() { ... }

# rollback_host <name> -> localiza latest_backup; se vazio, reporta erro
#   "sem backup para reverter" e retorna 1; senão copia o backup de volta
#   por cima do unit ativo, reload_and_restart, e roda health_check com o
#   mesmo timeout — reporta sucesso/falha final.
rollback_host() { ... }

# --- orquestração por host ---
# process_check <name>       -> get_execstart_line + extract_from_value +
#                                status systemd; só imprime, não altera nada.
# process_update <name>      -> get_execstart_line; extract_from_value;
#   se já igual a $NEW_FROM: imprime "já está em <valor>" e retorna 0 sem
#   tocar em nada (idempotência, RNF-04);
#   senão: backup_unit; build_new_execstart_line; write_execstart;
#   reload_and_restart; health_check;
#     se saudável: reporta sucesso (fonte antes -> depois);
#     se não saudável: rollback_host; reporta "FALHOU (revertido)".
# process_rollback <name>    -> rollback_host, sempre, independente de
#                                update anterior na mesma execução.
process_check() { ... }
process_update() { ... }
process_rollback() { ... }

# --- main loop ---
# Itera SSH_HOSTS (ou o subconjunto de $HOSTS), despachando para
# process_check / process_update / process_rollback conforme $ACTION;
# conta falhas; código de saída 0 só se todas as ações tiveram sucesso
# (mesma convenção de deploy-remotes.sh:190-217 — accumula `failures`,
# sai 1 se `failures > 0`).
main() { ... }
main "$@"
```

### 2.4 `write_execstart` — script Python remoto exato

Executado via `exec_on <name> "<script>"`. O `<script>` é o wrapper de
shell abaixo — a linha nova é lida do **stdin do processo Python via
heredoc**, nunca de `argv` (argv de qualquer processo é visível a outros
usuários do host via `ps aux`/`/proc`, e o valor pode conter
`git+URL@ref#subdirectory=...`; stdin não fica exposto dessa forma). O
`write_execstart` local monta o script combinado (bash + heredoc + python3
embutido) e passa o conjunto para `exec_on`, que por sua vez o leva ao
remoto em base64 (mesmo padrão de `remote_exec_https`/
`deploy-remotes.sh:109-112` — o base64 protege o *script inteiro* de
escaping de shell na viagem local→remoto; o heredoc, já dentro do remoto,
é quem entrega a linha nova ao Python sem passar por argv):

```bash
# script remoto montado por write_execstart(), com <NEW_LINE_B64> já
# substituído pelo caller antes de ir para exec_on:
python3 - <<'PYEOF'
import base64, sys
path = "/etc/systemd/system/openhands-agent-server.service"
new_line = base64.b64decode("<NEW_LINE_B64>").decode().rstrip("\n")
with open(path) as f:
    lines = f.readlines()
out, replaced = [], False
for ln in lines:
    if ln.startswith("ExecStart="):
        out.append(new_line + "\n")
        replaced = True
    else:
        out.append(ln)
if not replaced:
    sys.stderr.write("ExecStart= não encontrado no unit\n")
    sys.exit(1)
with open(path, "w") as f:
    f.writelines(out)
PYEOF
```

`<NEW_LINE_B64>` é o resultado de `base64` sobre a linha construída por
`build_new_execstart_line` — nunca interpolado cru em nenhuma camada de
shell (local, `exec_on`, ou remota), eliminando qualquer necessidade de
escaping de `/`, `#`, `@` ou espaços em qualquer ponto do pipeline.

## 3. Fluxo principal passo a passo

**`--set-version openhands-agent-server==1.48.0 aqdata lebi`** (SSH,
default):

1. `load_ssh_hosts` lê `agent-hosts.tsv`, filtra para `aqdata` e `lebi`.
2. Para cada host, `process_update`:
   a. `get_execstart_line` → linha crua.
   b. `extract_from_value` → ex. `openhands-agent-server==1.47.0`.
   c. Compara com `openhands-agent-server==1.48.0` — diferente, prossegue.
   d. `backup_unit` → cria `.bak.<epoch>`, imprime o caminho.
   e. `build_new_execstart_line` monta a nova linha completa.
   f. `write_execstart` grava via script Python remoto (base64).
   g. `reload_and_restart`.
   h. `health_check` faz poll até 60s.
   i. Sucesso → imprime `aqdata: openhands-agent-server==1.47.0 ->
      openhands-agent-server==1.48.0, saudável em Ns`.
3. Código de saída 0 se os dois hosts tiveram sucesso.

## 4. Fluxos de erro

- **Health check nunca fica saudável** (reprodução real desta sessão, com
  uma fonte `git+` sem `pyproject.toml`): passo `h` retorna 1 ao estourar o
  timeout → `rollback_host` é chamado automaticamente → restaura o
  `.bak.<epoch>` do passo `d` → `reload_and_restart` de novo → novo
  `health_check` (mesmo timeout) para confirmar que o rollback realmente
  recuperou o serviço → reporta `FALHOU (revertido): <motivo>`. Código de
  saída do host conta como falha, mas o serviço remoto termina ativo na
  versão anterior.
- **`get_execstart_line` não encontra `ExecStart=`** (unit ausente/diferente
  do esperado): aborta o host imediatamente com erro claro, sem tentar
  backup — não há o que reverter porque nada foi alterado.
- **`extract_from_value` não encontra o token `--from`**: aborta o host
  antes de qualquer escrita — mesmo racional acima.
- **SSH indisponível para um host** (rede fora, chave revogada): `ssh_exec`
  propaga o exit code de conexão do OpenSSH (comumente 255); o host é
  contado como falha e os demais hosts da execução continuam (RNF-02).
- **`--rollback` sem backup disponível**: `latest_backup` retorna vazio →
  `rollback_host` reporta erro explícito `sem backup para reverter em
  <host>` e não tenta nenhuma escrita.

## 5. Casos de borda

- **Concorrência**: duas execuções simultâneas do script contra o mesmo
  host podem colidir no `backup_unit` (dois backups quase idênticos) e no
  restart. Não há lock distribuído nesta versão — mitigação: o script
  imprime, antes de agir, o estado lido (`get_execstart_line`), então uma
  colisão fica visível no log de ambas as execuções; documentar no
  `--help` que é responsabilidade do operador não rodar duas instâncias em
  paralelo contra o mesmo host. Fora de escopo resolver com lock (PRD não
  pede uso concorrente).
- **Dados legados / unit sem `--from`**: coberto no fluxo de erro acima —
  aborta sem alterar.
- **Limite: `--set-version`/`--set-ref` com valor vazio**: `parse_args`
  valida que o argumento não é vazio antes de entrar no loop principal;
  erro imediato, nenhum host é tocado.
- **Entrada inválida: `--set-ref` sem prefixo `git+`**: o script não valida
  sintaticamente o valor de `--from` (o `uv`/`uvx` é quem sabe validar isso
  de fato, e tentativas de replicar essa validação arriscam rejeitar algo
  válido) — a validação real acontece no `health_check` pós-restart, que
  pegaria uma fonte inválida da mesma forma que pegou o caso real
  reproduzido nesta sessão (`git+` apontando para repo sem
  `pyproject.toml`).
- **Múltiplas ocorrências de `--from`**: nunca observado nos 3 units reais;
  `build_new_execstart_line` substitui apenas a primeira ocorrência (usa
  `break` após o primeiro match) — comportamento determinístico e
  documentado, não um bug silencioso.

## 6. Mudanças arquivo a arquivo

| Arquivo | Ação | O que muda |
|---|---|---|
| `tools/agent-hosts.tsv` | criar | lista canônica nome↔alvo SSH (§2.1) |
| `tools/lib/remote-exec-https.sh` | criar | `remote_exec_https()` extraída de `deploy-remotes.sh:98-133` |
| `tools/deploy-remotes.sh` | alterar | remove `remote_exec()` inline (linhas 97-133 atuais), adiciona `source` da lib (§2.2); nenhuma mudança de flags/comportamento externo |
| `tools/agent-server-remotes.sh` | criar | script principal (§2.3, §2.4) |
| `tools/agent-server-remotes.test.sh` | criar | teste unitário das funções puras de string (§8) |

`docs/features/deploy-agent-server-remotos/` (PRD.md, TECH.md, SPEC.md,
sprints/, overview.html) é meta-documentação do próprio pipeline
`/featdevelop` — produzida pelas fases anteriores (esta cadeia de
documentos), não é um artefato de implementação e por isso **não entra na
partição de sprints da Fase 4** (que cobre só código/config a
implementar). Fica fora da tabela de cobertura de sprints por design, não
por omissão.

## 7. Critérios de aceitação

- **CA-01** (RF-01): `agent-server-remotes.sh --check` imprime, para cada
  host de `agent-hosts.tsv`, a fonte atual do `--from` e o estado
  `active`/`inactive` do serviço, sem alterar nada — verificável rodando
  contra os 3 hosts reais e comparando com `systemctl cat` manual.
- **CA-02** (RF-02, RF-06): `agent-server-remotes.sh --set-version
  openhands-agent-server==<versão-atual+0>` (mesma versão já rodando) roda
  sem erro e sem restart, confirmando idempotência antes de testar o
  caminho de mudança real.
- **CA-03** (RF-02, RF-03): `agent-server-remotes.sh --set-version
  openhands-agent-server==<versão-válida-diferente>` num host de teste
  troca a fonte, reinicia, e reporta sucesso só depois do `health_check`
  responder `200` em `/health` — verificável comparando o `ExecStart` antes
  e depois via SSH manual.
- **CA-04** (RF-04): forçar uma fonte inválida (reprodução do incidente
  desta sessão: `git+` para um repo sem `pyproject.toml` na raiz) num host
  de teste resulta em rollback automático — o serviço termina `active` na
  fonte anterior, sem intervenção manual, e o script reporta `FALHOU
  (revertido)`.
- **CA-05** (RF-05): `agent-server-remotes.sh --check aqdata` processa só
  `aqdata`, confirmado por não haver nenhuma linha de log para `lebi`/`f5`
  na saída.
- **CA-06** (RF-07): `--dry-run` imprime os comandos que seriam executados
  em cada host sem executar nenhum (nenhuma mudança real no `ExecStart` nem
  restart) — verificável comparando o `ExecStart` antes e depois do
  `--dry-run` (deve ser idêntico).
- **CA-07** (RF-08): `agent-server-remotes.sh --rollback <host>` restaura o
  backup mais recente e reporta sucesso, mesmo sem ter havido um
  `--set-version`/`--set-ref` na mesma execução (usando um backup deixado
  por uma execução anterior).
- **CA-08** (RNF-01): nenhuma execução do script (incluindo `--channel
  https`) imprime a API key do `hosts.tsv` em stdout/stderr — verificável
  por inspeção do código e por grep na saída capturada de uma execução
  real.
- **CA-09** (RNF-02): rodando contra `aqdata lebi f5` com um host
  propositalmente inacessível (ex. SSH derrubado só nesse host), os outros
  dois hosts ainda são processados e reportam resultado — verificável pelo
  log da execução.
- **CA-10** (RF-02, edge case da SPEC §5): `build_new_execstart_line`
  aplicada a uma linha real contendo um valor `git+https://host/org/
  repo@ref#subdirectory=path` (com `/`, `#`, `@`) produz uma linha
  `ExecStart=` válida e completa — teste unitário isolado da função, sem
  precisar de host real, cobrindo exatamente o caso que quebrava com `sed`
  (achado do validador do TECH).
- **CA-11** (RNF-03): toda execução com `--set-version`/`--set-ref` imprime,
  para cada host processado, uma linha de resumo no formato `<host>:
  <fonte-antes> -> <fonte-depois>, <resultado>` — verificável por grep na
  saída capturada, não só "olhando" o log.
- **CA-12** (RNF-05): `agent-server-remotes.sh --check` roda sem erro a
  partir do Git Bash no Windows (ambiente de trabalho real de João) —
  verificação manual única antes do primeiro uso real, sem precisar de CI
  Windows dedicado.

## 8. Plano de testes

- **Unidade** (sem SSH, roda local): funções puras de string —
  `extract_from_value`, `build_new_execstart_line` — testadas contra as 3
  linhas `ExecStart=` reais capturadas nesta sessão (aqdata, lebi, f5-dev)
  mais um caso sintético com valor `git+URL@ref#subdirectory=path`
  (cobre CA-10). Rodável via um script de teste bash simples
  (`tools/agent-server-remotes.test.sh`) que faz `source` do script
  principal só para expor as funções e roda asserts com `[ "$got" =
  "$want" ]`.
- **Estático**: `shellcheck` nos 4 arquivos bash novos/alterados — depende
  da instalação prévia no host, já sinalizada como pendência no TECH §8.1.
- **Integração real** (contra produção, não há staging — mesmo racional do
  TECH §9): sequência manual documentada no `docs/features/.../SPEC.md`
  (esta seção) para rodar antes de considerar a feature "pronta":
  1. `--check` nos 3 hosts.
  2. `--set-version` com a mesma versão já ativa (idempotência, CA-02).
  3. `--dry-run --set-version <versão-diferente>` e confirmar que nada
     mudou (CA-06).
  4. Em UM host de teste (não os 3 de uma vez): `--set-ref` para uma fonte
     deliberadamente inválida, confirmar rollback automático (CA-04) —
     este é o teste de aceite mais crítico da feature, replicando o
     incidente real desta sessão de forma controlada.
  5. `--rollback` explícito nesse mesmo host, confirmando CA-07.

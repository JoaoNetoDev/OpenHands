#!/usr/bin/env bash
# agent-server-remotes.sh — inspeciona, atualiza e reverte a fonte (--from)
# do openhands-agent-server nos units systemd dos hosts remotos.
#
# --check [host...]   reporta a fonte atual e o estado do serviço.
# --set-version <pkg==ver> [host...]  troca --from para um pacote PyPI.
# --set-ref <git+URL@ref[#subdirectory=path]> [host...]  troca --from para
#                      uma referência git.
# --rollback [host...] restaura o backup mais recente do unit.
# --dry-run            combinável com --check/--set-version/--set-ref (não
#                      altera nada de fato: nenhum comando de escrita roda).
#
# Uso:
#   ./tools/agent-server-remotes.sh --check                # todos os hosts
#   ./tools/agent-server-remotes.sh --check aqdata lebi     # só esses hosts
#   ./tools/agent-server-remotes.sh --set-version openhands-agent-server==1.48.0 aqdata
#   ./tools/agent-server-remotes.sh --set-ref 'git+https://...@ref' aqdata
#   ./tools/agent-server-remotes.sh --rollback aqdata
#
# Hosts: tools/agent-hosts.tsv (canal ssh, default) ou
# $OPENHANDS_DEPLOY_HOSTS (canal https, formato de deploy-remotes.sh).
set -euo pipefail

# shellcheck source=tools/lib/remote-exec-https.sh
source "$(dirname "$0")/lib/remote-exec-https.sh"

CHANNEL="ssh"            # ssh | https
HOSTS_FILE="$(dirname "$0")/agent-hosts.tsv"
HTTPS_CONFIG="${OPENHANDS_DEPLOY_HOSTS:-/etc/openhands-deploy/hosts.tsv}"
TIMEOUT=60                # health check / comando remoto, segundos
ACTION=""                 # check | set-version | set-ref | rollback
NEW_FROM=""
DRY_RUN=0
HOSTS=()                  # filtro posicional

UNIT_PATH="/etc/systemd/system/openhands-agent-server.service"
UNIT_NAME="openhands-agent-server.service"
SERVICE_NAME="openhands-agent-server"
HEALTH_URL="http://127.0.0.1:18000/health"

declare -A SSH_HOSTS
declare -A HTTPS_URL
declare -A HTTPS_KEY

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$1" "$2" >&2; }
ok()   { printf '\033[1;32m[%s]\033[0m %s\n' "$1" "$2" >&2; }
err()  { printf '\033[1;31m[%s]\033[0m %s\n' "$1" "$2" >&2; }

usage() { grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,24p'; exit 1; }

# --- parsing (mesma convenção de flags de deploy-remotes.sh) ---
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --check) ACTION="check"; shift ;;
      --set-version) ACTION="set-version"; NEW_FROM="${2:-}"; shift 2 ;;
      --set-ref) ACTION="set-ref"; NEW_FROM="${2:-}"; shift 2 ;;
      --rollback) ACTION="rollback"; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --channel) CHANNEL="${2:-}"; shift 2 ;;
      --timeout) TIMEOUT="${2:-}"; shift 2 ;;
      -h|--help) usage ;;
      -*) err "args" "flag desconhecida: $1"; usage ;;
      *) HOSTS+=("$1"); shift ;;
    esac
  done

  case "$ACTION" in
    check) : ;;
    set-version|set-ref)
      [ -n "$NEW_FROM" ] || { err "args" "--$ACTION requer um valor não vazio"; exit 1; }
      ;;
    rollback) : ;;
    "")
      err "args" "nenhuma ação informada; use --check, --set-version, --set-ref ou --rollback."
      usage
      ;;
    *)
      err "args" "ação desconhecida: $ACTION"
      exit 1
      ;;
  esac
}

# --- carregamento de hosts ---
# load_ssh_hosts -> preenche SSH_HOSTS["<name>"]="<alvo_ssh>" lendo
#   HOSTS_FILE, ignorando linhas em branco/comentário (formato nome|valor).
load_ssh_hosts() {
  [ -f "$HOSTS_FILE" ] || { err "hosts" "arquivo não encontrado: $HOSTS_FILE"; exit 1; }
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "$line" | sed 's/[[:space:]]*$//')"
    [ -n "$line" ] || continue
    IFS=$'\t|' read -r name target <<< "$line"
    name="$(echo "$name" | xargs)"; target="$(echo "$target" | xargs)"
    [ -n "$name" ] && [ -n "$target" ] || { err "hosts" "linha inválida: $line"; continue; }
    SSH_HOSTS["$name"]="$target"
  done < "$HOSTS_FILE"
}

# load_https_hosts -> preenche HTTPS_URL["<name>"] e HTTPS_KEY["<name>"]
#   lendo HTTPS_CONFIG no formato nome|url|key. Só chamada quando CHANNEL=https.
load_https_hosts() {
  [ -f "$HTTPS_CONFIG" ] || { err "hosts" "arquivo não encontrado: $HTTPS_CONFIG"; exit 1; }
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "$line" | sed 's/[[:space:]]*$//')"
    [ -n "$line" ] || continue
    IFS=$'\t|' read -r name url key <<< "$line"
    name="$(echo "$name" | xargs)"; url="$(echo "$url" | xargs)"; key="$(echo "$key" | xargs)"
    [ -n "$name" ] && [ -n "$url" ] && [ -n "$key" ] || { err "hosts" "linha inválida: $line"; continue; }
    HTTPS_URL["$name"]="$url"
    HTTPS_KEY["$name"]="$key"
  done < "$HTTPS_CONFIG"
}

# --- transporte ---
# ssh_exec <name> <script> -> propaga exit code. Honra DRY_RUN da mesma
#   forma que remote_exec_https: não roda nada, só imprime o script.
ssh_exec() {
  local name="$1" script="$2"
  if [ "$DRY_RUN" = "1" ]; then
    echo "--- (dry-run) comando que seria executado em $name ---"
    echo "$script"
    echo "--- fim ---"
    return 0
  fi
  local target="${SSH_HOSTS[$name]}"
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$target" bash -s <<< "$script"
}

# exec_on <name> <script> -> despacha para ssh_exec ou remote_exec_https
#   conforme $CHANNEL; interface única usada pelo resto do script.
exec_on() {
  local name="$1" script="$2"
  if [ "$CHANNEL" = "https" ]; then
    remote_exec_https "$name" "${HTTPS_URL[$name]}" "${HTTPS_KEY[$name]}" "$script" "$TIMEOUT"
  else
    ssh_exec "$name" "$script"
  fi
}

# exec_on_always <name> <script> -> como exec_on, mas ignora DRY_RUN (usado
#   por leituras puras que nunca devem ser suprimidas pelo dry-run: ver
#   get_execstart_line, latest_backup, health_check, status systemd).
exec_on_always() {
  local name="$1" script="$2"
  local saved_dry_run="$DRY_RUN"
  DRY_RUN=0
  local out rc
  out="$(exec_on "$name" "$script")"
  rc=$?
  DRY_RUN="$saved_dry_run"
  printf '%s' "$out"
  return "$rc"
}

# --- leitura/edição do unit ---
# get_execstart_line <name> -> stdout: a linha ExecStart= crua do unit.
#   Leitura pura: nunca é afetada por --dry-run.
get_execstart_line() {
  local name="$1"
  local line rc
  line="$(exec_on_always "$name" "systemctl cat $UNIT_NAME | grep '^ExecStart='")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    err "$name" "não foi possível ler o unit $UNIT_NAME"
    return 1
  fi
  [ -n "$line" ] || { err "$name" "linha ExecStart= não encontrada no unit"; return 1; }
  printf '%s\n' "$line"
}

# extract_from_value <execstart_line> -> stdout: só o valor que segue
#   "--from " no ExecStart. Word-splitting (read -ra), NÃO sed/regex — sed
#   quebra com "/", "#" e "&" em valores git+URL@ref#subdirectory=...
extract_from_value() {
  local line="$1"
  local rest tokens=()
  rest="${line#*=}"
  read -ra tokens <<< "$rest"
  local i
  for i in "${!tokens[@]}"; do
    if [ "${tokens[$i]}" = "--from" ]; then
      if [ -n "${tokens[$((i+1))]+x}" ]; then
        printf '%s\n' "${tokens[$((i+1))]}"
        return 0
      fi
      break
    fi
  done
  err "extract_from_value" "token --from não encontrado na linha: $line"
  return 1
}

# build_new_execstart_line <execstart_line> <new_from_value> -> stdout: a
#   linha ExecStart= reconstruída com o token após --from substituído.
#   LIMITAÇÃO CONHECIDA: espaçamento múltiplo pré-existente é normalizado
#   para espaço simples (ver SPEC §2.3/§5).
build_new_execstart_line() {
  local line="$1" new_from_value="$2"
  local prefix rest tokens=()
  prefix="${line%%=*}="
  rest="${line#*=}"
  read -ra tokens <<< "$rest"
  local found=0 i
  for i in "${!tokens[@]}"; do
    if [ "${tokens[$i]}" = "--from" ]; then
      if [ -z "${tokens[$((i+1))]+x}" ]; then
        err "build_new_execstart_line" "token --from sem valor seguinte na linha: $line"
        return 1
      fi
      tokens[$((i+1))]="$new_from_value"
      found=1
      break
    fi
  done
  if [ "$found" != "1" ]; then
    err "build_new_execstart_line" "token --from não encontrado na linha: $line"
    return 1
  fi
  printf '%s%s\n' "$prefix" "$(IFS=' '; echo "${tokens[*]}")"
}

# --- backup e escrita ---
# backup_unit <name> -> cria um .bak.<epoch> do unit no remoto; stdout: o
#   caminho do backup criado. Respeita --dry-run (não cria nada nesse caso,
#   só reporta o que faria via exec_on/ssh_exec's próprio dry-run).
backup_unit() {
  local name="$1"
  local script="ts=\$(date +%s); bak=\"$UNIT_PATH.bak.\$ts\"; cp \"$UNIT_PATH\" \"\$bak\" && echo \"\$bak\""
  local out rc
  out="$(exec_on "$name" "$script")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    err "$name" "falha ao criar backup do unit"
    return 1
  fi
  printf '%s' "$out"
}

# write_execstart <name> <new_execstart_line> -> substitui só a linha
#   ExecStart= do unit no remoto via script Python (SPEC §2.4). O valor
#   NUNCA passa por argv em nenhuma camada — só por stdin/heredoc, em
#   base64 (o base64 protege o script inteiro na viagem local->remoto via
#   exec_on; o heredoc, já no remoto, entrega a linha ao Python).
write_execstart() {
  local name="$1" new_line="$2"
  local new_line_b64
  new_line_b64="$(printf '%s' "$new_line" | base64 | tr -d '\n')"
  local script
  script=$(cat <<EOF
python3 - <<'PYEOF'
import base64, sys
path = "$UNIT_PATH"
new_line = base64.b64decode("$new_line_b64").decode().rstrip("\n")
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
EOF
)
  exec_on "$name" "$script"
}

# reload_and_restart <name> -> systemctl daemon-reload && restart.
reload_and_restart() {
  local name="$1"
  exec_on "$name" "systemctl daemon-reload && systemctl restart $SERVICE_NAME"
}

# --- verificação de saúde ---
# health_check <name> <timeout_seconds> -> poll a cada 2s via curl; 0 se
#   saudável dentro do prazo, 1 caso contrário. Leitura pura: nunca afetada
#   por --dry-run (senão nunca vira "saudável" durante um --dry-run de
#   update, mas update não chama health_check sob dry-run mesmo — este
#   guard é defensivo/para uso isolado da função).
health_check() {
  local name="$1" timeout_seconds="${2:-$TIMEOUT}"
  local script="curl -sf -o /dev/null -w '%{http_code}' --max-time 3 $HEALTH_URL 2>/dev/null || true"
  local waited=0
  while [ "$waited" -lt "$timeout_seconds" ]; do
    local code
    code="$(exec_on_always "$name" "$script" || true)"
    if [ "$code" = "200" ]; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# --- rollback ---
# latest_backup <name> -> caminho do .bak.* mais recente; vazio se nenhum.
latest_backup() {
  local name="$1"
  exec_on_always "$name" "ls -t $UNIT_PATH.bak.* 2>/dev/null | head -1 || true"
}

# rollback_host <name> -> restaura o backup mais recente, reload_and_restart,
#   e roda health_check para confirmar a recuperação.
rollback_host() {
  local name="$1"
  local bak
  bak="$(latest_backup "$name")"
  if [ -z "$bak" ]; then
    err "$name" "sem backup para reverter"
    return 1
  fi
  log "$name" "revertendo para backup: $bak"
  if ! exec_on "$name" "cp \"$bak\" \"$UNIT_PATH\""; then
    err "$name" "falha ao restaurar backup $bak"
    return 1
  fi
  if [ "$DRY_RUN" = "1" ]; then
    ok "$name" "(dry-run) rollback simulado, nenhuma mudança real"
    return 0
  fi
  reload_and_restart "$name"
  if health_check "$name" "$TIMEOUT"; then
    ok "$name" "rollback concluído, serviço saudável (backup: $bak)"
    return 0
  else
    err "$name" "rollback restaurou o unit mas o serviço não ficou saudável"
    return 1
  fi
}

# --- orquestração por host ---
# process_check <name> -> get_execstart_line + extract_from_value + status
#   systemd; só imprime, não altera nada.
process_check() {
  local name="$1"
  log "$name" "consultando estado..."
  local execstart from_value active
  if ! execstart="$(get_execstart_line "$name")"; then
    return 1
  fi
  if ! from_value="$(extract_from_value "$execstart")"; then
    return 1
  fi
  active="$(exec_on_always "$name" "systemctl is-active $SERVICE_NAME 2>&1 || true")"
  ok "$name" "from=$from_value estado=$active"
  return 0
}

# process_update <name> -> compara fonte atual vs. NEW_FROM (idempotência,
#   RNF-04); se igual, não toca em nada. Senão: backup, escreve, reinicia,
#   verifica saúde; se não saudável, rollback automático.
process_update() {
  local name="$1"
  local execstart from_value
  if ! execstart="$(get_execstart_line "$name")"; then
    return 1
  fi
  if ! from_value="$(extract_from_value "$execstart")"; then
    return 1
  fi

  if [ "$from_value" = "$NEW_FROM" ]; then
    ok "$name" "$from_value -> $from_value, já está em $NEW_FROM (nenhuma ação)"
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    local new_line
    if ! new_line="$(build_new_execstart_line "$execstart" "$NEW_FROM")"; then
      return 1
    fi
    log "$name" "(dry-run) $from_value -> $NEW_FROM"
    backup_unit "$name" >/dev/null
    write_execstart "$name" "$new_line" >/dev/null
    reload_and_restart "$name" >/dev/null
    ok "$name" "$from_value -> $NEW_FROM, dry-run (nenhuma mudança real)"
    return 0
  fi

  local bak
  if ! bak="$(backup_unit "$name")"; then
    return 1
  fi
  log "$name" "backup criado: $bak"

  local new_line
  if ! new_line="$(build_new_execstart_line "$execstart" "$NEW_FROM")"; then
    return 1
  fi

  if ! write_execstart "$name" "$new_line"; then
    err "$name" "falha ao escrever novo ExecStart"
    return 1
  fi

  if ! reload_and_restart "$name"; then
    err "$name" "falha ao reiniciar o serviço, tentando rollback"
    rollback_host "$name" || true
    err "$name" "$from_value -> $NEW_FROM, FALHOU (revertido)"
    return 1
  fi

  if health_check "$name" "$TIMEOUT"; then
    ok "$name" "$from_value -> $NEW_FROM, saudável"
    return 0
  else
    err "$name" "health check falhou, revertendo"
    if rollback_host "$name"; then
      err "$name" "$from_value -> $NEW_FROM, FALHOU (revertido)"
    else
      err "$name" "$from_value -> $NEW_FROM, FALHOU (revertido: também falhou)"
    fi
    return 1
  fi
}

# process_rollback <name> -> rollback_host, sempre, independente de update
#   anterior na mesma execução.
process_rollback() {
  local name="$1"
  rollback_host "$name"
}

# --- main loop ---
main() {
  parse_args "$@"

  if [ "$CHANNEL" = "https" ]; then
    load_https_hosts
  else
    load_ssh_hosts
  fi

  local -a names=()
  if [ "${#HOSTS[@]}" -gt 0 ]; then
    names=("${HOSTS[@]}")
  else
    if [ "$CHANNEL" = "https" ]; then
      names=("${!HTTPS_URL[@]}")
    else
      names=("${!SSH_HOSTS[@]}")
    fi
  fi

  local -i failures=0
  local name
  for name in "${names[@]}"; do
    case "$ACTION" in
      check)
        process_check "$name" || failures+=1
        ;;
      set-version|set-ref)
        process_update "$name" || failures+=1
        ;;
      rollback)
        process_rollback "$name" || failures+=1
        ;;
      *)
        err "$name" "ação não suportada: $ACTION"
        failures+=1
        ;;
    esac
  done

  [ "$failures" -eq 0 ]
}

# Guarda para permitir `source` deste arquivo a partir do teste unitário
# (agent-server-remotes.test.sh) sem disparar main/parse_args/exit.
if [ "${AGENT_SERVER_REMOTES_SOURCED:-0}" != "1" ]; then
  main "$@"
fi

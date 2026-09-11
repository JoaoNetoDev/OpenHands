#!/usr/bin/env bash
# agent-server-remotes.sh — inspeciona, atualiza e reverte a fonte (--from)
# do openhands-agent-server nos units systemd dos hosts remotos.
#
# NESTA SPRINT (SPRINT-02): só o caminho de leitura é funcional.
#   --check [host...]   reporta a fonte atual e o estado do serviço.
#   --dry-run           combinável com --check (não altera nada de qualquer
#                        forma nesta sprint, já que não há caminho de escrita).
#
# --set-version / --set-ref / --rollback ainda NÃO estão implementados —
# saem com erro claro. Serão completados na SPRINT-03.
#
# Uso:
#   ./tools/agent-server-remotes.sh --check                # todos os hosts
#   ./tools/agent-server-remotes.sh --check aqdata lebi     # só esses hosts
#
# Hosts: tools/agent-hosts.tsv (canal ssh, default) ou
# $OPENHANDS_DEPLOY_HOSTS (canal https, formato de deploy-remotes.sh).
# shellcheck disable=SC2034
# NEW_FROM: populado por parse_args nesta sprint, consumido pelas ações de
# escrita da SPRINT-03. DRY_RUN: lido por remote_exec_https() em
# lib/remote-exec-https.sh (outro arquivo, invisível ao shellcheck aqui).
set -euo pipefail

# shellcheck source=tools/lib/remote-exec-https.sh
source "$(dirname "$0")/lib/remote-exec-https.sh"

CHANNEL="ssh"            # ssh | https
HOSTS_FILE="$(dirname "$0")/agent-hosts.tsv"
HTTPS_CONFIG="${OPENHANDS_DEPLOY_HOSTS:-/etc/openhands-deploy/hosts.tsv}"
TIMEOUT=60                # health check / comando remoto, segundos
ACTION=""                 # check | set-version | set-ref | rollback
# shellcheck disable=SC2034  # usado pelas ações de escrita da SPRINT-03; já
# populado por parse_args nesta sprint para não reabrir a assinatura depois.
NEW_FROM=""
# shellcheck disable=SC2034  # lido por remote_exec_https() em lib/remote-exec-https.sh
DRY_RUN=0
HOSTS=()                  # filtro posicional

declare -A SSH_HOSTS
declare -A HTTPS_URL
declare -A HTTPS_KEY

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$1" "$2" >&2; }
ok()   { printf '\033[1;32m[%s]\033[0m %s\n' "$1" "$2" >&2; }
err()  { printf '\033[1;31m[%s]\033[0m %s\n' "$1" "$2" >&2; }

usage() { grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,20p'; exit 1; }

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
    set-version|set-ref|rollback)
      err "args" "--$ACTION ainda não implementado nesta sprint (SPRINT-02 só cobre --check); ficará pronto na SPRINT-03."
      exit 1
      ;;
    "")
      err "args" "nenhuma ação informada; use --check nesta sprint."
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
# ssh_exec <name> <script> -> propaga exit code.
ssh_exec() {
  local name="$1" script="$2"
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

# --- leitura/edição do unit ---
# get_execstart_line <name> -> stdout: a linha ExecStart= crua do unit.
#   Leitura pura: nunca é afetada por --dry-run (dry-run só suprime
#   comandos que ALTERAM o remoto; get_execstart_line não altera nada, então
#   força DRY_RUN=0 localmente ao redor da chamada — sem isso, o canal https
#   (remote_exec_https) devolveria o texto "seria executado" em vez da
#   linha real, quebrando --check --dry-run).
get_execstart_line() {
  local name="$1"
  local line
  local saved_dry_run="$DRY_RUN"
  DRY_RUN=0
  line="$(exec_on "$name" "systemctl cat openhands-agent-server.service | grep '^ExecStart='")"
  local rc=$?
  DRY_RUN="$saved_dry_run"
  if [ "$rc" -ne 0 ]; then
    err "$name" "não foi possível ler o unit openhands-agent-server.service"
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
  local saved_dry_run="$DRY_RUN"
  DRY_RUN=0
  active="$(exec_on "$name" "systemctl is-active openhands-agent-server 2>&1 || true")"
  DRY_RUN="$saved_dry_run"
  ok "$name" "from=$from_value estado=$active"
  return 0
}

process_update() {
  err "$1" "--set-version/--set-ref ainda não implementado nesta sprint"
  return 1
}

process_rollback() {
  err "$1" "--rollback ainda não implementado nesta sprint"
  return 1
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
      *)
        err "$name" "ação não suportada nesta sprint: $ACTION"
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

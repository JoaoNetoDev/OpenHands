#!/usr/bin/env bash
# clone-profiles.sh — replica os LLM profiles e Agent profiles deste OpenHands
# (local) para um ou mais Agent Servers remotos, via a REST API do agent-server
# (/api/profiles e /api/agent-profiles), usando o header X-Session-API-Key.
#
# Uso:
#   ./clone-profiles.sh add   <nome> <host> <api-key>   # salva um alvo em /etc/openhands/clone-targets.conf
#   ./clone-profiles.sh list                             # lista alvos salvos
#   ./clone-profiles.sh remove <nome>                    # remove um alvo salvo
#   ./clone-profiles.sh run    [nome...] [--dry-run] [--include-acp]
#                                                         # clona pros alvos salvos (ou só os citados)
#   ./clone-profiles.sh run --host <host> --key <api-key> [--dry-run] [--include-acp]
#                                                         # clona pra um alvo avulso, sem salvar
#
# ACP profiles (ex.: "default"/Claude Code) dependem de login/CLI local na
# máquina onde rodam — por padrão são pulados (a estrutura não carrega
# credencial). Use --include-acp para clonar a estrutura mesmo assim (o alvo
# remoto vai precisar da própria autenticação/login configurada depois).
set -euo pipefail

CONF_DIR="/etc/openhands"
CONF_FILE="$CONF_DIR/clone-targets.conf"
LOCAL_ENV_FILE="/etc/default/openhands"

log()  { printf '%s\n' "$*" >&2; }
die()  { log "erro: $*"; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "comando '$1' não encontrado"; }
require_cmd curl
require_cmd jq

load_local() {
  [ -f "$LOCAL_ENV_FILE" ] || die "$LOCAL_ENV_FILE não encontrado"
  LOCAL_PORT=$(grep -E '^PORT=' "$LOCAL_ENV_FILE" | tail -1 | cut -d= -f2-)
  LOCAL_KEY=$(grep -E '^LOCAL_BACKEND_API_KEY=' "$LOCAL_ENV_FILE" | tail -1 | cut -d= -f2-)
  LOCAL_HOST="http://127.0.0.1:${LOCAL_PORT:-8092}"
  [ -n "$LOCAL_KEY" ] || die "LOCAL_BACKEND_API_KEY vazio em $LOCAL_ENV_FILE"
}

# ---- gerenciamento de alvos salvos -----------------------------------------

cmd_add() {
  local name="$1" host="$2" key="$3"
  [ -n "$name" ] && [ -n "$host" ] && [ -n "$key" ] || die "uso: add <nome> <host> <api-key>"
  mkdir -p "$CONF_DIR"
  touch "$CONF_FILE"
  chmod 600 "$CONF_FILE"
  grep -v "^${name}|" "$CONF_FILE" > "$CONF_FILE.tmp" 2>/dev/null || true
  printf '%s|%s|%s\n' "$name" "$host" "$key" >> "$CONF_FILE.tmp"
  mv "$CONF_FILE.tmp" "$CONF_FILE"
  chmod 600 "$CONF_FILE"
  log "✓ alvo '$name' salvo ($host)"
}

cmd_list() {
  [ -f "$CONF_FILE" ] || { log "(nenhum alvo salvo ainda — use: $0 add <nome> <host> <api-key>)"; return; }
  awk -F'|' '{printf "  %-20s %s\n", $1, $2}' "$CONF_FILE"
}

cmd_remove() {
  local name="$1"
  [ -n "$name" ] || die "uso: remove <nome>"
  [ -f "$CONF_FILE" ] || die "nenhum alvo salvo"
  grep -v "^${name}|" "$CONF_FILE" > "$CONF_FILE.tmp" || true
  mv "$CONF_FILE.tmp" "$CONF_FILE"
  log "✓ alvo '$name' removido"
}

# ---- clone ------------------------------------------------------------------

api_get() { # host key path [extra-header]
  curl -sS -f -H "X-Session-API-Key: $2" ${4:+-H "$4"} "$1$3"
}
api_post() { # host key path json-body
  curl -sS -f -X POST -H "X-Session-API-Key: $2" -H "Content-Type: application/json" \
    -d "$4" "$1$3"
}

clone_llm_profiles() {
  local dry="$1" t_name="$2" t_host="$3" t_key="$4"
  local names
  names=$(api_get "$LOCAL_HOST" "$LOCAL_KEY" "/api/profiles" | jq -r '.profiles[].name')
  [ -n "$names" ] || { log "  (nenhum LLM profile local para clonar)"; return; }
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    local detail config body
    detail=$(api_get "$LOCAL_HOST" "$LOCAL_KEY" "/api/profiles/$(jq -rn --arg n "$name" '$n|@uri')" "X-Expose-Secrets: plaintext")
    config=$(printf '%s' "$detail" | jq '.config')
    body=$(jq -n --argjson llm "$config" '{llm: $llm, include_secrets: true}')
    if [ "$dry" = "1" ]; then
      log "  [dry-run] LLM profile '$name' -> $t_name"
      continue
    fi
    if api_post "$t_host" "$t_key" "/api/profiles/$(jq -rn --arg n "$name" '$n|@uri')" "$body" >/dev/null; then
      log "  ✓ LLM profile '$name' -> $t_name"
    else
      log "  ✗ LLM profile '$name' -> $t_name (falhou)"
    fi
  done <<< "$names"
}

clone_agent_profiles() {
  local dry="$1" t_name="$2" t_host="$3" t_key="$4" include_acp="$5"
  local names
  names=$(api_get "$LOCAL_HOST" "$LOCAL_KEY" "/api/agent-profiles" | jq -r '.profiles[].name')
  [ -n "$names" ] || { log "  (nenhum agent profile local para clonar)"; return; }
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    local detail profile kind body
    detail=$(api_get "$LOCAL_HOST" "$LOCAL_KEY" "/api/agent-profiles/$(jq -rn --arg n "$name" '$n|@uri')")
    profile=$(printf '%s' "$detail" | jq '.profile')
    kind=$(printf '%s' "$profile" | jq -r '.agent_kind')
    if [ "$kind" = "acp" ] && [ "$include_acp" != "1" ]; then
      log "  ⚠ agent profile '$name' é ACP (ex.: Claude Code) — pulado (credencial/login não é clonável; use --include-acp para copiar só a estrutura)"
      continue
    fi
    body=$(printf '%s' "$profile" | jq 'del(.id, .revision, .schema_version)')
    if [ "$dry" = "1" ]; then
      log "  [dry-run] agent profile '$name' ($kind) -> $t_name"
      continue
    fi
    if api_post "$t_host" "$t_key" "/api/agent-profiles/$(jq -rn --arg n "$name" '$n|@uri')" "$body" >/dev/null; then
      log "  ✓ agent profile '$name' ($kind) -> $t_name"
    else
      log "  ✗ agent profile '$name' ($kind) -> $t_name (falhou — confira se os LLM profiles referenciados já existem no alvo)"
    fi
  done <<< "$names"
}

clone_to_target() {
  local dry="$1" include_acp="$2" t_name="$3" t_host="$4" t_key="$5"
  log "== $t_name ($t_host) =="
  clone_llm_profiles   "$dry" "$t_name" "$t_host" "$t_key"
  clone_agent_profiles "$dry" "$t_name" "$t_host" "$t_key" "$include_acp"
}

cmd_run() {
  load_local
  local dry=0 include_acp=0
  local -a wanted=()
  local adhoc_host="" adhoc_key=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      --include-acp) include_acp=1 ;;
      --host) shift; adhoc_host="$1" ;;
      --key) shift; adhoc_key="$1" ;;
      *) wanted+=("$1") ;;
    esac
    shift
  done

  if [ -n "$adhoc_host" ]; then
    [ -n "$adhoc_key" ] || die "--host requer --key"
    clone_to_target "$dry" "$include_acp" "adhoc" "$adhoc_host" "$adhoc_key"
    return
  fi

  [ -f "$CONF_FILE" ] || die "nenhum alvo salvo. Use: $0 add <nome> <host> <api-key>"
  while IFS='|' read -r name host key; do
    [ -n "$name" ] || continue
    if [ ${#wanted[@]} -gt 0 ]; then
      local match=0
      for w in "${wanted[@]}"; do [ "$w" = "$name" ] && match=1; done
      [ "$match" = "1" ] || continue
    fi
    clone_to_target "$dry" "$include_acp" "$name" "$host" "$key"
  done < "$CONF_FILE"
}

# ---- main --------------------------------------------------------------

cmd="${1:-}"; shift || true
case "$cmd" in
  add)    cmd_add "$@" ;;
  list)   cmd_list "$@" ;;
  remove) cmd_remove "$@" ;;
  run)    cmd_run "$@" ;;
  *)
    cat >&2 <<EOF
Uso:
  $0 add <nome> <host> <api-key>     # salva um backend remoto
  $0 list                             # lista backends salvos
  $0 remove <nome>                    # remove um backend salvo
  $0 run [nome...] [--dry-run] [--include-acp]
  $0 run --host <host> --key <api-key> [--dry-run] [--include-acp]
EOF
    exit 1
    ;;
esac

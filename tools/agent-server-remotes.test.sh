#!/usr/bin/env bash
# agent-server-remotes.test.sh — teste unitário de extract_from_value e
# build_new_execstart_line. Sem SSH, sem rede. Fixtures: as 3 linhas
# ExecStart= reais (aqdata, lebi, f5-dev) capturadas via SSH, mais um caso
# sintético com git+URL@ref#subdirectory=path (CA-10).
set -uo pipefail

# Fonteamos só para expor as funções puras (extract_from_value,
# build_new_execstart_line), sem disparar main/parse_args/exit. O script
# principal guarda a chamada de `main "$@"` no fim do arquivo atrás de
# AGENT_SERVER_REMOTES_SOURCED=1, setado aqui antes do source.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_SERVER_REMOTES_SOURCED=1
export AGENT_SERVER_REMOTES_SOURCED
# shellcheck source=tools/agent-server-remotes.sh
source "$SCRIPT_DIR/agent-server-remotes.sh"

pass=0
fail=0

assert_eq() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    printf 'ok   - %s\n' "$desc"
    pass=$((pass + 1))
  else
    printf 'FAIL - %s\n  got:  %q\n  want: %q\n' "$desc" "$got" "$want"
    fail=$((fail + 1))
  fi
}

assert_fail() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf 'FAIL - %s (esperava falha, mas teve sucesso)\n' "$desc"
    fail=$((fail + 1))
  else
    printf 'ok   - %s\n' "$desc"
    pass=$((pass + 1))
  fi
}

# --- fixtures reais (capturadas via SSH em 2026-09-11) ---
AQDATA_LINE='ExecStart=/home/handsagent/.local/bin/uvx --from openhands-agent-server==1.46.0 --with libtmux --with openhands-tools agent-server --host 0.0.0.0 --port 18000'
LEBI_LINE='ExecStart=/home/admin/.local/bin/uvx --from openhands-agent-server==1.47.0 --with libtmux --with openhands-tools agent-server --host 0.0.0.0 --port 18000 --import-modules codegraph_tool --extra-python-path /home/admin/.openhands/zadotec-tools/tools'
F5_LINE='ExecStart=/home/joaoneto/.local/bin/uvx --from openhands-agent-server==1.47.0 --with libtmux --with openhands-tools agent-server --host 0.0.0.0 --port 18000 --import-modules codegraph_tool --extra-python-path /home/joaoneto/.openhands/zadotec-tools/tools'
# caso sintético (CA-10): valor com "/", "#", "@"
GITREF_LINE='ExecStart=/home/x/.local/bin/uvx --from openhands-agent-server==1.47.0 --with libtmux --with openhands-tools agent-server --host 0.0.0.0 --port 18000'
GITREF_VALUE='git+https://github.com/org/repo@ref#subdirectory=agent-server'

echo "== extract_from_value =="
assert_eq "aqdata: extrai versão" "$(extract_from_value "$AQDATA_LINE")" "openhands-agent-server==1.46.0"
assert_eq "lebi: extrai versão"   "$(extract_from_value "$LEBI_LINE")"   "openhands-agent-server==1.47.0"
assert_eq "f5: extrai versão"     "$(extract_from_value "$F5_LINE")"    "openhands-agent-server==1.47.0"
assert_fail "sem --from: falha" extract_from_value "ExecStart=/usr/bin/foo --bar baz"

echo "== build_new_execstart_line =="
assert_eq "aqdata: troca versão, preserva prefixo/sufixo" \
  "$(build_new_execstart_line "$AQDATA_LINE" "openhands-agent-server==1.48.0")" \
  "ExecStart=/home/handsagent/.local/bin/uvx --from openhands-agent-server==1.48.0 --with libtmux --with openhands-tools agent-server --host 0.0.0.0 --port 18000"

assert_eq "lebi: troca versão, preserva --extra-python-path" \
  "$(build_new_execstart_line "$LEBI_LINE" "openhands-agent-server==1.48.0")" \
  "ExecStart=/home/admin/.local/bin/uvx --from openhands-agent-server==1.48.0 --with libtmux --with openhands-tools agent-server --host 0.0.0.0 --port 18000 --import-modules codegraph_tool --extra-python-path /home/admin/.openhands/zadotec-tools/tools"

assert_eq "f5: troca versão, preserva --extra-python-path" \
  "$(build_new_execstart_line "$F5_LINE" "openhands-agent-server==1.48.0")" \
  "ExecStart=/home/joaoneto/.local/bin/uvx --from openhands-agent-server==1.48.0 --with libtmux --with openhands-tools agent-server --host 0.0.0.0 --port 18000 --import-modules codegraph_tool --extra-python-path /home/joaoneto/.openhands/zadotec-tools/tools"

echo "== build_new_execstart_line: CA-10 (git+URL@ref#subdirectory=path) =="
assert_eq "aceita valor com / @ # sem quebrar" \
  "$(build_new_execstart_line "$GITREF_LINE" "$GITREF_VALUE")" \
  "ExecStart=/home/x/.local/bin/uvx --from git+https://github.com/org/repo@ref#subdirectory=agent-server --with libtmux --with openhands-tools agent-server --host 0.0.0.0 --port 18000"

got_gitref="$(build_new_execstart_line "$GITREF_LINE" "$GITREF_VALUE")"
extracted_back="$(extract_from_value "$got_gitref")"
assert_eq "roundtrip: extract_from_value re-lê exatamente o valor git+ injetado" \
  "$extracted_back" "$GITREF_VALUE"

assert_fail "build: sem --from na linha, falha" build_new_execstart_line "ExecStart=/usr/bin/foo --bar baz" "x"

echo
echo "resultado: $pass ok, $fail falhas"
[ "$fail" -eq 0 ]

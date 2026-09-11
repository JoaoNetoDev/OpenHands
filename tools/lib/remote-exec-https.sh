#!/usr/bin/env bash
# remote-exec-https.sh — transporte HTTPS compartilhado para scripts de
# deploy/administração remota via agent-server (POST
# /api/bash/execute_bash_command). Extraído de deploy-remotes.sh.

# Executa um script bash no host remoto. Ecoa stdout/stderr e propaga o exit code.
# remote_exec_https <name> <url> <key> <script> [timeout_seconds]
remote_exec_https() {
  local name="$1" url="$2" key="$3" script="$4"
  if [ "$DRY_RUN" = "1" ]; then
    echo "--- (dry-run) comando que seria executado em $name ---"
    echo "$script"
    echo "--- fim ---"
    return 0
  fi
  SCRIPT="$script" URL="$url" KEY="$key" TMO="$TIMEOUT" python3 - <<'PY'
import base64, json, os, sys, urllib.request, urllib.error
url = os.environ["URL"].rstrip("/") + "/api/bash/execute_bash_command"
# O endpoint executa via /bin/sh (dash). Mandamos o script em base64 e pedimos
# bash explicitamente: garante bashismos (pipefail) e elimina escaping.
b64 = base64.b64encode(os.environ["SCRIPT"].encode()).decode()
cmd = f"echo {b64} | base64 -d | bash"
body = json.dumps({"command": cmd, "timeout": int(os.environ["TMO"])}).encode()
req = urllib.request.Request(url, data=body, method="POST", headers={
    "Content-Type": "application/json",
    "X-Session-API-Key": os.environ["KEY"],
})
try:
    with urllib.request.urlopen(req, timeout=int(os.environ["TMO"]) + 30) as r:
        d = json.load(r)
except urllib.error.HTTPError as e:
    sys.stderr.write(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}\n")
    sys.exit(2)
except Exception as e:
    sys.stderr.write(f"falha de conexão: {e}\n")
    sys.exit(2)
if d.get("stdout"): sys.stdout.write(d["stdout"])
if d.get("stderr"): sys.stderr.write(d["stderr"])
sys.exit(d.get("exit_code") or 0)
PY
}

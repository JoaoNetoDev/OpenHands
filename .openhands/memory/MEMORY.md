# Project Memory — OpenHands/OpenHands (agent-canvas)

See also `AGENTS.md` (repo instructions) and the daily logs in this directory.

## OpenHands Tray (Canvas-on-VPS ↔ local agent-server)

- Planning docs live in `docs/features/openhands-tray/` (PRD, SPEC, TECH,
  overview.html, `sprints/`). Decisions were settled in Sprint 01; read
  `sprints/SPRINT-01-DECISIONS.md` before touching the design.
- The Go Tray lives in a **sibling repo**, not here: `/opt/openhands-tray`
  (module `github.com/JoaoNetoDev/openhands-tray`). `AGENTS.md` forbids Go in
  this repo (RISCO-01).
- VPS side is `scripts/agent-tunnel.mjs` (terminal WSS bridge) wired into
  `scripts/ingress.mjs` as **opt-in** via `--agent-tunnel-token` /
  `INGRESS_AGENT_TUNNEL_TOKEN`. Default ingress behavior is unchanged when no
  token is set.
- `--agent-tunnel-route` is **repeatable** and in practice must be: the
  agent-server serves `/server_info` at the **root** and everything else under
  `/api`. Tunnel-backed routes are matched *before* ingress's local
  `/server_info` interception, so the Tray answers the compatibility bootstrap.
- Two credentials, deliberately never shared: an opaque **bearer** authenticates
  Tray→VPS on the WS upgrade; the local **session key** authenticates
  Tray→local agent-server. The response returned to the VPS must never carry
  `x-session-api-key` (that leak was a real bug found by tests).

## Environment quirks worth remembering

- **`npm run lint` does not lint `scripts/`.** The script is roughly
  `eslint src && prettier --check ...`; files under `scripts/` can carry lint
  errors without failing CI. Still keep them clean — run
  `npx eslint scripts/<file>` explicitly.
- **A large part of the React Vitest suite fails on a clean checkout** (~19
  files / ~92 tests, e.g. `chat-interface.test.tsx`, `conversation-events/**`).
  Confirm pre-existing status with `git stash` before attributing failures to
  your change; they are unrelated to `scripts/`.
- **MSW intercepts `fetch` in Vitest.** The global setup mocks `fetch` and
  answers `/server_info` with a canned payload, so tests that must observe real
  HTTP routing through `scripts/ingress.mjs` need `node:http`
  (`request`) instead of `fetch`.
- **`ws` ships no types.** Any TypeScript test importing `ws` needs `@types/ws`
  as a dev dependency; without it every callback parameter is implicitly `any`.
- The local dev agent-server runs on **:18000**, serves `/server_info` **without
  auth**, and 401s on `/api/*` without a session key. Its key lives only in the
  process env (`OH_SESSION_API_KEYS_0`), not on disk.
- `httptest.Server.Close()` hangs while a hijacked WebSocket is open — close
  connections before closing the server in Go tests.
- `scripts/ingress.mjs` exports `startIngress(config)` which returns a server
  object; pass `port: 0` in tests to get an ephemeral port. Config keys are
  camelCase (`agentTunnelToken`, `agentTunnelRoutes`, `defaultBackend`).
  With no local backend configured a non-tunnel route responds **503**.

## Canvas roda em produção NESTE host (`prod-zadotec`)

- `/opt/openhands` **é** o docroot que `openhands.service` serve
  (`WorkingDirectory=/opt/openhands`, `bin/agent-canvas.mjs --public`). Não é um
  checkout de desenvolvimento: editar aqui afeta produção.
- O `agent-server` (backend Python) **não** roda deste repo — roda de um pacote
  PyPI pinado via `uvx`, gerenciado pela unit:
  `uvx --from openhands-agent-server==<X> --with openhands-sdk==<X> … agent-server
  --host 127.0.0.1 --port 18000`. **Corrigir o frontend aqui NÃO corrige o
  backend**: qualquer fix de comportamento do agente precisa de release do SDK
  + bump do pin na unit.
- Consequência prática: uma feature pode estar no bundle servido e a contraparte
  de backend continuar ausente (o pin do PyPI é a fonte da verdade do backend).
  Antes de diagnosticar "feature não funciona", compare `git log` do frontend
  contra a versão do SDK instalada em
  `/root/.cache/uv/archive-v0/*/lib/python*/site-packages/openhands_sdk-*.dist-info`.
- Perfis de agente ACP ficam em `/root/.openhands/agent-profiles/*.json` e são
  **persistentes** — um `acp_model` ruim gravado ali quebra toda conversa nova
  daquele perfil, mesmo sem o usuário mexer no seletor.
- Os `.jsonl` de sessão do Claude CLI ficam em `/root/.claude/projects/<cwd-slug>/`
  e são a evidência primária de erros de modelo do CLI
  (`error`, `apiErrorStatus`, `model`). O `cwd` do registro indica a conversa.
- **NÃO rode `systemctl restart openhands.service` de dentro de uma sessão do
  Canvas.** O `agent-server` que hospeda a conversa é filho dessa unit (o
  `agent-canvas.mjs` o gera), e o `ExecStartPre` faz
  `fuser -k 18000/tcp 18001/tcp 3001/tcp` com `KillMode=control-group`: o restart
  mata o próprio agente no meio da tarefa. Deixe o restart para o usuário.
- Para apontar o backend a um SDK não publicado, o knob útil é
  **`OH_AGENT_SERVER_LOCAL_PATH`** (maior precedência; instala os 4 pacotes como
  `--with-editable`). **`OH_AGENT_SERVER_GIT_REF` não serve para um fork**: o
  repo é hardcoded para upstream em `scripts/dev-safe.mjs:48`
  (`AGENT_SERVER_GIT_REPO`). E `OH_AGENT_SERVER_VERSION` só alcança a PyPI, cujo
  pin default vem de `config/defaults.json` (`versions.agentServer`).
- Custo de boot do knob local: ~5 s com cache do `uv` quente (o `--reinstall`
  refaz a resolução, mas não é caro com cache).

## Delegar tracers ao MiniMax (`claude-m3`) funciona neste host

- `/root/bin/claude-m3` existe e responde; **não** há `pwsh`, então o módulo
  `M3Delegation.psm1` da skill `delegate-m3` não roda — dispare o CLI direto.
- É obrigatório limpar as vars de auth do host, senão dá 401 após ~3 min:
  `env -u CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH -u CLAUDE_CODE_CHILD_SESSION`.
- `-p --output-format json < prompt.txt` escreve JSON de ~18 KB; o campo
  `result` traz o relatório. Runs de investigação levam ~10 min.


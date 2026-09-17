# Project Memory — OpenHands/OpenHands (agent-canvas)

See also `AGENTS.md` (repo instructions) and the daily logs in this directory.
Sprint 03 / the tray UI detail lives in `2026-09-12.md`.

## OpenHands Tray (Canvas-on-VPS ↔ local agent-server)

- Planning docs live in `docs/features/openhands-tray/` (PRD, SPEC, TECH,
  overview.html, `sprints/`). Decisions were settled in Sprint 01; read
  `sprints/SPRINT-01-DECISIONS.md` before touching the design.
- The Go Tray lives in a **sibling repo**, not here: `/opt/openhands-tray`
  (module `github.com/JoaoNetoDev/openhands-tray`). `AGENTS.md` forbids Go in
  this repo (RISCO-01).
- **The tray UI exists as of Sprint 03** (Wails v3.0.0-beta.21). A bare run
  opens the settings window; any connection flag or `-headless` still runs the
  CLI. Both modes drive one lifecycle in `internal/desktop/controller.go` -- do
  not add a second startup path in `main.go`.
- **The GUI cannot be cross-compiled** (cgo -> GTK4/WebKitGTK 6.0), so the repo
  builds two artifacts: `make build` (GUI, host, cgo) and `make build-headless`
  (static, 5 platforms). Build tags are `gui` / `!gui`. Never export a global
  `CGO_ENABLED=0` in that Makefile -- it silently removes the GUI and breaks
  `-race`.
- VPS side is `scripts/agent-tunnel.mjs` (terminal WSS bridge) wired into
  `scripts/ingress.mjs` as **opt-in** via `--agent-tunnel-token` /
  `INGRESS_AGENT_TUNNEL_TOKEN`. Default ingress behavior is unchanged when no
  token is set. **It is still not enabled in production**, which is the last
  open blocker from `ACHADOS.md` section 9.
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

## AIK kanban: por que o delete de fase "ressuscitava"

O quadro AIK (`aik.zadotec.com.br`, `src/stores/aik-board-store.ts`) persiste cada
system em `<workspace>/.openhands/aik/system.json`, com **dois escritores**: o
browser (debounce de 500 ms em `flushSystemsToDisk`) e o próprio agente (RF-09,
o prompt manda o agente editar esse arquivo). O `syncFromFile` faz polling a cada
4 s. Isso cria duas corridas distintas e **as duas precisam de gate** — corrigir
só uma não resolve o bug, foi exatamente o que aconteceu numa primeira tentativa:

1. **Corrida no READ** (`syncFromFile`): um tick de polling cai dentro da janela
   de debounce, lê o `system.json` *pré-delete* e faz merge de volta no store.
   Gate: `pendingSystemWrites` (Set de `system.id`) — `syncFromFile` dá early
   return enquanto há write pendente/in-flight.
2. **Corrida no WRITE** (`writeAikSystemFile`, `src/api/aik-board-file.api.ts`):
   o write é read-modify-write. Mesmo com o read gateado, o próprio write relê o
   disco (que ainda tem a fase, porque nosso write não pousou) e o merge
   "preserva item que só existe no disco" → reescreve a fase deletada. Gate:
   `pendingTombstonesBySystem` — IDs deletadas são passadas ao write e removidas
   do merge do disco. É a correção que de fato resolve o sintoma.

- **Ausência não tem `updatedAt`.** `mergeById` resolve conflito por
  `updatedAt` e mantém qualquer item presente em um dos lados; um delete é
  *ausência* de item, então o merge não tem como representá-lo. Daí tombstones
  explícitos em vez de tentar um cutoff por timestamp.
- **Ordem importa:** capture o tombstone *dentro* do callback do `set` que faz a
  deleção — depois do `set` os IDs já não existem no state.
- O mock de `mergeAikSystemFiles` nos testes do store era um concat ingênuo e
  mascarava o bug. Ele agora espelha `mergeById` (dedup por id, respeita
  tombstones). Ao mexer na semântica do merge, atualize o mock junto — senão o
  teste de regressão vira decorativo.
- Os chunks são servidos com `cache-control: immutable, max-age=31536000`: um
  deploy só chega ao usuário com **hard reload** (ou hash de chunk novo).
- `src/stores/aik-board-store.test.ts` cai num teste de "disco simulado"
  (`readAikSystemFileMock`/`writeAikSystemFileMock` operando sobre uma variável),
  que é o que reproduz o sintoma ponta-a-ponta. Prefira esse formato a asserções
  sobre flags intermediárias.

## Limite de anexo do Canvas

- O teto de 3MB era **client-side**, em `src/utils/file-validation.ts`. Nenhum
  limite no backend: `POST /api/file/upload` streama em chunks de 8KB sem cap.
- Tetos atuais (bump de 2026-09-15): **25MB** para arquivo/total, **5MB** para
  imagem. A divisão existe porque imagem não marcada como "upload as file" vira
  base64 no prompt do LLM; arquivo comum vai por upload HTTP pro workspace.
- **`it.each` com objetos `File` nos args derruba o Vitest** (RangeError na
  coleta; no pool `forks` mascara como "Worker exited unexpectedly" — use
  `--pool=threads` pra ver o erro). Passe só escalares e construa o `File`
  dentro do teste.

## Workspaces homônimos no seletor (`public_html`)

- `getWorkspaceSecondaryLabels()` em `src/utils/workspace-display.ts` devolve,
  só para nomes que colidem, o diretório que desambigua (linha secundária no
  `DropdownItem` e no controle fechado do `WorkspaceDropdown`).
- **Nunca derive esse diretório de `workspace.parentPath`**: workspaces vindos de
  um workspace-parent (varredura de uma raiz) compartilham o MESMO `parentPath`,
  então as duas linhas saem iguais e o problema continua. Use sempre
  `getPathDirectory(workspace.path)` (`src/utils/path-utils.ts`).
- Para ver isso no `dev:mock` é preciso semear **também** `/api/file/search_subdirs`
  (`src/mocks/file-service-handlers.ts`) — o dropdown agrupa pelos parents
  varridos, e não pela lista estática de `/api/workspaces`.

## Rail do Canvas sem as entradas Quadro/Sistema (2026-09-17)

- `src/components/features/sidebar/sidebar-rail-body.tsx` não tem mais as duas
  entradas de fork: `/board` (`sidebar-board-link`, sprint kanban-3-niveis-03) e
  `/settings/system` (`sidebar-system-link` / `sidebar-collapsed-system-link`,
  sprints sistema-settings-menu-03 + kanban-sistema-v2-01).
- As **rotas continuam existindo e roteáveis** (`/board`, `/settings/system`, e
  o item "Sistema" segue em `OSS_NAV_ITEMS`): removê-las é outra decisão, não
  reverta essa remoção de nav sem confirmar com o usuário.
- Testes: `__tests__/components/features/sidebar/sidebar.test.tsx` agora assere
  a **ausência** dos test-ids (expandido e colapsado) — não reintroduza os
  testes de posicionamento.

## Delegar tracers ao MiniMax (`claude-m3`) funciona neste host

- `/root/bin/claude-m3` existe e responde; **não** há `pwsh`, então o módulo
  `M3Delegation.psm1` da skill `delegate-m3` não roda — dispare o CLI direto.
- É obrigatório limpar as vars de auth do host, senão dá 401 após ~3 min:
  `env -u CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH -u CLAUDE_CODE_CHILD_SESSION`.
- `-p --output-format json < prompt.txt` escreve JSON de ~18 KB; o campo
  `result` traz o relatório. Runs de investigação levam ~10 min.


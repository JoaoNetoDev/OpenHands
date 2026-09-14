# SPEC — OpenHands Tray (Canvas na VPS ↔ Agent local)

## 1. Resumo e escopo

Binário único em Go que age como bridge nativo entre o Canvas do
OpenHands hospedado numa VPS (rodando `agent-canvas --frontend-only`) e o
agent-server rodando na máquina local do usuário. Conexão **WSS
outbound** (passa qualquer NAT/firewall), reverse-proxy HTTP ↔ WS sobre o
mesmo socket, sidecar do agent-server reusando o launcher
`scripts/dev-with-automation.mjs --backend-only` deste repo.

Fora do escopo:
- Reescrita do agent-server em Go (runtime Python+MCP fica intocado).
- Substituição do wrapper Electron para o caso mesma-máquina
  (`electron/main.mjs` continua sendo o wrapper recomendado quando
  Canvas e agent estão no mesmo host).
- Multi-tenant, multi-tray na mesma máquina (v2).

## 2. Desenho detalhado por componente

### 2.1 Tray (binário Go)

**Localização:** repo irmão do `software-agent-sdk` — nome de trabalho
`JoaoNetoDev/openhands-tray` (decidido no Sprint 01; confirmar o nome
exato antes do Sprint 02). Go 1.22+, Wails3 (validar maturidade — ver
PRD §8 RISCO-05) ou Wails v2 como fallback.

```
openhands-tray/
├── main.go                       # entrypoint Wails + tray + lifecycle
├── app.go                        # bindings Go <-> JS (SettingsWindow)
├── wails.json
├── go.mod
├── internal/
│   ├── agent/
│   │   └── agent.go              # spawn de dev-with-automation.mjs --backend-only
│   ├── tunnel/
│   │   └── tunnel.go             # WS client com reconexão
│   ├── proxy/
│   │   └── proxy.go              # reverse proxy HTTP <-> WS
│   ├── config/
│   │   └── config.go             # load/save de config XDG
│   ├── sessionkey/
│   │   └── sessionkey.go         # geração/persistência da session key
│   └── logging/
│       └── logging.go            # slog -> arquivo rotativo
├── ui/                           # frontend Wails3 (Svelte/React)
│   ├── index.html
│   └── src/Settings.svelte
├── build/
│   ├── appicon.png
│   ├── darwin/
│   └── windows/
└── README.md
```

### 2.2 Sidecar (processo local)

Em vez de reimplementar spawn do `agent-server`, **o Tray delega para
`dev-with-automation.mjs --backend-only`** deste repo. Esse script já
implementa:

- Cold start via `uvx --from openhands-agent-server==<ver> ...`
  (`scripts/dev-safe.mjs:434-540`), incluindo `--reinstall` para git
  refs, pinning consistente das quatro packages
  (`openhands-agent-server`, `openhands-sdk`, `openhands-tools`,
  `openhands-workspace`).
- Geração da session API key (32 bytes) com persistência em
  `~/.openhands/agent-canvas/session-api-key.txt`.
- Spawn detached em process group próprio, SIGTERM tree cleanup.
- Logs estruturados (`LOG_JSON=true`) consumíveis por
  `parseAgentServerLogLine`.
- Health check via `GET /server_info` (200 ou 401 indicam sucesso,
  mesma convenção de `electron/main.mjs:630`).

O Tray invoca `dev-with-automation.mjs --backend-only --port <p>
--no-frontend` (a flag `--no-frontend` precisa ser adicionada — ver
PRD §8 RISCO-03). Workdir do Tray vira `OH_CANVAS_SAFE_STATE_DIR` do
launcher. Session key gerada pelo Tray (não pelo launcher) é exportada
como `OH_SESSION_API_KEYS_0` antes do spawn.

**Fallback** (caso `dev-with-automation.mjs` não esteja disponível no
target — usuário que instalou só `agent-canvas` global sem o repo): o
Tray pode invocar diretamente

```
uvx --from openhands-agent-server==<config-agent-server-version> \
    --with openhands-sdk==<ver> --with openhands-tools==<ver> \
    --with openhands-workspace==<ver> \
    --import-modules canvas_ui_tool \
    agent-server --host 127.0.0.1 --port <p>
```

com `OH_SESSION_API_KEYS_0=<session-key>` no env. Mesmo padrão do
launcher; ver SPEC §2.4 abaixo para o fallback completo.

### 2.3 VPS endpoint (extensão do `agent-canvas --frontend-only`)

Hook novo em `scripts/ingress.mjs` adiciona o endpoint
`wss://<host>/agent-tunnel` que roteia para um handler local:

```
location /agent-tunnel {
    proxy_pass http://127.0.0.1:<tunnel-port>;  # futuro: lógica de auth
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

Detalhe da auth: ver §4.3.

### 2.4 Protocolo WS (envelope MVP)

Mesma sugestão do artefato §6, com dois refinamentos:

```jsonc
// VPS -> Tray (request)
{
  "id": "uuid-v4",
  "method": "POST",
  "path": "/api/chat",
  "headers": { "Content-Type": "application/json" },
  "body_b64": "base64..."   // base64 do body binário; vazio se não houver
}

// Tray -> VPS (response)
{
  "id": "uuid-v4",           // mesmo id da request
  "status": 200,
  "headers": { "Content-Type": "application/json" },
  "body_b64": "base64..."
}
```

Refinamentos sobre o artefato original:
- **Sufixo `_b64`** explícito no nome do campo, pra deixar claro que é
  sempre base64 (mesmo sendo texto) — evita ambiguidade quando o body
  contém bytes não-UTF8 (terminal output, arquivos binários).
- **Frames binários para bodies > 64 KB**: WS frames viram
  `{id, status, headers, "body_b64": "..."}` mas o conteúdo do frame é
  um **WebSocket Binary Message** em vez de Text Message. Reduz
  overhead de base64+JSON pra uploads grandes (tarballs via `/api/files`
  chegam a MB). Tray envia Binary se body_b64 decodificado > 64 KB.
- **Keepalive**: a cada 15s, Tray envia `{"type":"ping"}` (Text). VPS
  responde `{"type":"pong"}`. Falta de pong por 45s = reconnect.
- **Cancelamento**: se VPS envia `{"id":"x","type":"cancel"}` durante
  uma request em vôo, Tray cancela o `context.Context` da goroutine
  correspondente e responde `{"id":"x","status":499,"body_b64":""}`.

**Validado no spike (Sprint 01):** envelope texto para body pequeno e
binário para >64KB (100KB ida e volta com SHA-256 idêntico ao controle
direto); cancelamento honrado em 3-5ms com abort visível no agent-server;
ping→pong em 1ms; RTT p50=1ms. Ver `sprints/SPRINT-01-DECISIONS.md` §2.

### 2.5 Sessão API key (reuso do modelo existente)

Reaproveitar `crypto.randomBytes(32)` e `~/.openhands/agent-canvas/session-api-key.txt`
em vez de criar silo novo:

- Tray lê o arquivo na inicialização; se não existir, gera e persiste
  com `0o600`.
- Tray exporta essa key como `OH_SESSION_API_KEYS_0` ao spawnar o
  sidecar.
- Tray **injecta** essa key como `X-Session-API-Key` em cada request que
  faz ao agent-server local, e **descarta** qualquer `x-session-api-key`
  que venha no envelope do cliente. A VPS nunca vê nem recebe essa key.

**RESOLVIDO (Sprint 01):** cada Tray gera a **sua própria** session key e o
frontend na VPS **nunca a vê**. Isso mantém a key fora do fio (ela nunca
trafega pela bridge), o que o spike confirmou: a key não aparece nos
headers de resposta (T1) e a chamada direta sem key retorna 401 (T1b),
provando que a injeção do Tray é o que faz a request funcionar. Ver
`sprints/SPRINT-01-DECISIONS.md` §3.1.

Consequência: a VPS não precisa validar nem armazenar a session key local —
ela roteia pelo bearer token do bridge (SPEC §4.3). O único segredo que
cruza o fio é o bearer (VPS↔Tray); a session key é Tray↔agent-server local.

### 2.6 Config persistente (XDG)

```go
type Config struct {
    VPSURL        string `json:"vps_url"`        // wss://sua-vps.com/agent-tunnel
    BearerToken   string `json:"bearer_token"`   // token estático da VPS
    Workdir       string `json:"workdir"`        // dir local onde o agent-server roda
    LocalPort     int    `json:"local_port"`     // default 8000 (loopback agent-server)
    AgentServerVer string `json:"agent_server_version"` // ex.: "1.46.0", vazio = default do repo
    AutoStart     bool   `json:"auto_start"`
}
```

Path: `~/.config/openhands-tray/config.json` (`os.UserConfigDir` + join
com `openhands-tray`); permissões `0o600`; tratamento idempotente para
arquivo ausente (default zero-value). Mesmo formato que o artefato §5.4
proposta, mas adicionando `AgentServerVer` (sync com
`config/defaults.json::versions.agentServer` no MVP).

## 3. Fluxo principal passo a passo

1. Usuário instala Tray (`brew install openhands-tray`, `apt install`,
   `winget install`) OU roda `./openhands-tray` standalone.
2. Primeira execução: nenhum config → abre janela modal pedindo VPS
   URL + Bearer token. Usuário cola o token que provisionou na VPS
   (geração de token: hook em `agent-canvas --frontend-only` na VPS,
   ver PRD §8 QUESTÃO-01).
3. Tray salva config, gera session key se necessário, abre WSS
   outbound.
4. Tray spawna sidecar via `dev-with-automation.mjs --backend-only
   --no-frontend --port <localPort>`, com env custom (session key,
   workdir, agent-server version).
5. Sidecar sobe `agent-server` em `127.0.0.1:<localPort>` (cold start
   ~30-90s na primeira vez por causa do uvx).
6. Tray faz `GET http://127.0.0.1:<localPort>/server_info` com
   `X-Session-API-Key` — 200 ou 401 = sucesso.
7. Tray anuncia "Connected" no system tray; menu habilita "Open
   Canvas".
8. Usuário clica "Open Canvas" → browser abre `https://sua-vps.com/`
   → Canvas carrega normalmente → frontend identifica que a VPS está
   configurada pra ter bridge Tray e exibe a opção "Connect local
   agent-server".
9. Frontend na VPS abre WSS pra `wss://sua-vps.com/agent-tunnel`,
   envia handshake com Bearer token.
10. Toda request HTTP do frontend → VPS → proxy → WS → Tray →
    agent-server local → response → WS → VPS → proxy → response →
    frontend.
11. Graceful shutdown (Quit, OS shutdown, SIGHUP): Tray envia
    `SIGTERM` pro grupo de processos do sidecar (via
    `signalProcessTree` ou `taskkill /T /F`); WSS fechado com
    `close code 1000`; session key e config persistidos (não
    removidos).

## 4. Segurança

### 4.1 Rede

- WSS obrigatório (TLS 1.2+) — tray rejeita `ws://` (não-WS).
- `crypto/tls` com `MinVersion: tls.VersionTLS12`.
- Certificado do servidor da VPS validado contra system CA store;
  opção `--insecure-skip-tls-verify` explicitamente disponível mas
  loga warning sempre que usada.

### 4.2 Persistência

- `config.json` e `session-api-key.txt`: permissões `0o600`, dono do
  processo (`os.Chown` não necessário — Tray roda como usuário).
- Logs: `~/.local/state/openhands-tray/log/*.log`, `0o600`,
  rotação diária via `lumberjack` ou similar; **NÃO** logar Bearer
  token ou session key em claro. Redaction automática via wrapper
  `slog.Handler`.

### 4.3 Auth WSS

MVP: Bearer token estático (PRD §8 RISCO-04 opção A).

Handshake:
```
Tray -> VPS:   GET /agent-tunnel HTTP/1.1
               Upgrade: websocket
               Connection: Upgrade
               Authorization: Bearer <token>
               Sec-WebSocket-Key: <random>
               Sec-WebSocket-Version: 13

VPS -> Tray:   HTTP/1.1 101 Switching Protocols
               (or 401 Unauthorized se token inválido)
```

VPS valida token comparando contra o que provisionou pro
`username@hostname` do bridge. **Não suporta múltiplos bridges do
mesmo usuário** no MVP (single-tenant por design, mesma restrição do
agent-server).

Hardening futuro (v1+): Ed25519 challenge-response. VPS envia nonce,
Tray assina com chave privada local (gerada uma vez, armazenada em
`~/.config/openhands-tray/bridge.key` `0o600`). VPS valida com
chave pública do bridge registrada no provisionamento. mTLS fica
como opção enterprise (v2).

### 4.4 Injeção da session key local (nova — validada no spike)

A session key do agent-server local **nunca** cruza o fio. Regras:

- O Tray **remove** qualquer `x-session-api-key` presente no envelope
  vindo do cliente (se a VPS mandar uma, é descartada).
- O Tray **injeta** a sua própria key (lida/gerada em
  `~/.openhands/agent-canvas/session-api-key.txt`) em toda request que
  faz ao agent-server local.
- A resposta devolvida à VPS **não** inclui `x-session-api-key` — o Tray
  filtra headers hop-by-hop e o header de auth antes de serializar.

Evidência: T1 (key ausente nos headers de resposta) e T1b (chamada direta
sem key → 401, provando que a injeção do Tray é o que faz a request
funcionar). Ver `sprints/SPRINT-01-DECISIONS.md` §3.1.

Corolário: a VPS **não** usa essa key para nada — ela roteia pelo bearer
token do bridge (§4.3). São dois segredos distintos, e nenhum é
compartilhado entre os dois lados.

### 4.5 Audit

Toda request/response que passa pelo WS é logada em
`audit-YYYY-MM-DD.log` no formato nginx combined + bridge fields:

```
<VPS-ip> - - [12/Sep/2026:13:38:00 +0000] "POST /api/chat HTTP/1.1" 200 1024 \
  bridge_id=<uuid> req_id=<uuid> duration_ms=42
```

VPS IP vem do handshake WS (campo `RemoteAddr` na conexão TCP subjacente).

## 5. Casos de borda

- **CE-01** — VPS indisponível no startup: backoff 1s → 2s → 4s → ...
  cap 30s. Tray fica com ícone "disconnected" no system tray. Retry
  infinito até Quit.
- **CE-02** — Sidecar morre inesperadamente (exit code != 0): Tray
  detecta via `cmd.Process.Wait()` no próximo ping (15s). Reinicia
  sidecar com backoff igual ao CE-01. Logs nível `error`.
- **CE-03** — Workdir não existe: Tray mostra erro modal "Workdir
  <path> does not exist, create it?" (botões Yes/No). Se Yes, cria;
  se No, aborta save de config.
- **CE-04** — WSS reconecta mas VPS foi reiniciada (nova session key):
  Tray tenta handshake com mesma session key; VPS responde 401; Tray
  mostra modal "VPS rotated session key — please re-authenticate"
  pedindo novo Bearer token.
- **CE-05** — Duas instâncias do Tray abertas simultaneamente: segunda
  instância detecta via lockfile em
  `~/.local/state/openhands-tray/tray.lock` (`flock(2)` exclusive),
  mostra modal "Tray already running" e sai com exit 1.
- **CE-06** — Bearer token revogado na VPS: VPS responde 401 no
  próximo request. Tray mostra modal "Token revoked — please update
  Bearer token in Settings".
- **CE-07** — Cold start do uvx falha (rede, mirror indisponível):
  Tray loga stderr do uvx no arquivo rotativo, mostra ícone "error"
  com tooltip "<agent-server> failed to start: <última linha do log>".
  Retry segue CE-02.
- **CE-08** — Versão do agent-server incompatível com o frontend da
  VPS (`GET /server_info` retorna versão abaixo do mínimo): Tray
  exibe modal "Local agent-server <v> is below minimum <min> required
  by the VPS frontend. Update?" com botão "Update agent-server" (roda
  `uvx --reinstall --from openhands-agent-server==<ver-min>`).

## 6. Mudanças arquivo a arquivo

### Em `OpenHands/OpenHands` (este repo)

- `scripts/ingress.mjs` — adicionar o handler **dedicado** de
  `/agent-tunnel` (servidor WS terminal com validação de bearer + bridge
  de envelopes; **não** é passthrough como o handler de `upgrade` atual).
  Ver TECH §4.3.
- `src/components/features/backends/` — nova UI de gestão de tokens do
  Tray: emitir / listar / revogar o bearer, a partir da tela de backends
  ("Add backend"). Decisão QUESTÃO-01 — o instalador provisiona o token
  pela interface do Canvas.
- `scripts/dev-with-automation.mjs` — adicionar flag `--no-frontend`
  (no-op hoje; documenta explicitamente que `--backend-only` já
  satisfaz o caso Tray; alinhar naming só se ficar ambíguo).
- `docs/DEVELOPMENT.md` — adicionar seção "Tray local agent
  (cross-host dev)" explicando o setup.
- `AGENTS.md` — adicionar entrada na tabela de fronteira entre repos
  apontando `JoaoNetoDev/openhands-tray` como dono do binário.

### Em `JoaoNetoDev/openhands-tray` (repo irmão novo — decidido no Sprint 01)

- `main.go` — entrypoint Wails + tray + lifecycle.
- `app.go` — bindings Go ↔ Svelte (Settings modal).
- `internal/agent/agent.go` — spawn de `dev-with-automation.mjs
  --backend-only` via `os/exec`; env custom; `signalProcessTree` no
  stop.
- `internal/tunnel/tunnel.go` — `gorilla/websocket` Dialer com
  HandshakeTimeout 10s, leitura 0 (sem timeout — long-lived); loop
  de reconexão com backoff exponencial + jitter cap 30s; keepalive
  ping/pong 15s/45s.
- `internal/proxy/proxy.go` — `httputil.ReverseProxy` ajustado pra
  preservar `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`;
  serialização base64 do body; framing binário para >64KB.
- `internal/config/config.go` — load/save em XDG, `0o600`,
  idempotente.
- `internal/sessionkey/sessionkey.go` — `crypto/rand` 32 bytes
  base64url, persiste em
  `~/.openhands/agent-canvas/session-api-key.txt` (mesmo arquivo do
  Electron wrapper — reuso do silo), `0o600`.
- `internal/logging/logging.go` — `log/slog` JSON handler +
  `lumberjack` writer; rotação diária, retenção 14 dias, compressão
  gzip.
- `ui/src/Settings.svelte` — modal de primeira execução + menu
  Settings: VPS URL, Bearer, Workdir, LocalPort, AgentServerVer,
  AutoStart checkbox, "Reveal session key" (clipboard),
  "Test connection" (botão que faz `GET /server_info`).
- `build/darwin/`, `build/windows/`, `build/linux/` — ícones,
  Info.plist additions, NSIS script para Windows.

## 7. Critérios de aceitação

- **CA-01** — `./openhands-tray -vps wss://test.local/agent-tunnel
  -token t1 -workdir /tmp` estabelece WSS outbound para `test.local`
  na porta 443 (mesmo atrás de NAT em teste de laboratório), spawna
  agent-server local em `127.0.0.1:8000`, health check passa.
- **CA-02** — `curl -X POST http://test.local/api/chat -H "X-Bridge: t1"
  -d '{"msg":"hello"}'` chega como request HTTP no agent-server
  local (verificável via `tcpdump` ou log do agent-server), response
  volta idêntica (body binário).
- **CA-03** — Derrubar a conexão TCP do VPS (kill do lado VPS) →
  ícone fica "disconnected"; reestabelecer VPS → ícone volta
  "connected" em ≤ 30s sem intervenção.
- **CA-04** — Kill do agent-server local (`kill <pid>`) → Tray
  detecta em ≤ 15s, restart automático, ícone continua "connected".
- **CA-05** — Permissões de `~/.config/openhands-tray/config.json`
  e `session-api-key.txt` verificadas `0o600` em Linux e macOS.
- **CA-06** — Audit log contém uma linha por request/response com
  `bridge_id`, `req_id`, `duration_ms`. Busca por `Bearer` no log
  retorna zero matches.
- **CA-07** — Token revogado na VPS → modal "Token revoked" aparece
  no Tray em ≤ 30s.
- **CA-08** — `Binário único < 50 MB` para macOS arm64, Linux x64,
  Windows x64 (medido após `go build -trimpath -ldflags="-s -w"` +
  `upx --best` opcional).
- **CA-09** — `RAM em idle < 100 MB` medido via `ps -o rss` 1 minuto
  após startup (sem request ativa).
- **CA-10** — Cross-compile `GOOS=linux GOARCH=arm64 go build` produz
  binário funcional em Raspberry Pi 4 (test smoke).

## 8. Plano de testes

- **Unit (Go)** — `internal/{tunnel,proxy,config,sessionkey,logging}`:
  table-driven, `testing` stdlib + `testify/assert`. Mínimo 80% coverage
  em `tunnel` e `proxy`.
- **Integration** — `tests/integration/`: sobe VPS mock (Node +
  `ws` server), sobe agent-server real via `uvx`, sobe Tray, dispara
  100 requests HTTP-like, valida responses idênticas ao controle
  (request direta pro agent-server sem bridge).
- **E2E manual** — `tests/e2e/OPENHANDS_TRAY.md`: roteiro passo a
  passo pra QA rodar contra VPS real provisionada em
  `tunnel.openhands.dev` (infraestrutura ainda a ser criada —
  PRD §8 QUESTÃO-01).
- **Soak** — 24h de ping/pong + 1 request/minuto no agent-server;
  verifica leak de goroutines (`runtime.NumGoroutine()` cresce < 10%
  no período).
- **Fuzz** — `go test -fuzz=FuzzEnvelopeDecode` no envelope decoder
  por 60s; sem panic.
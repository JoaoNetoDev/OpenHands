# TECH — OpenHands Tray (Canvas na VPS ↔ Agent local)

## 1. Estado atual da arquitetura nos pontos tocados

### 1.1 Sidecar hoje (mesma máquina)

`scripts/dev-with-automation.mjs` (1715 linhas) é o launcher autoritativo
para o stack agent-server + automation + ingress + frontend:

- Linhas 907-955: `startAgentServer(config)` — chama
  `buildAgentServerCommand(process.env)` (`scripts/dev-safe.mjs:434-540`)
  para construir `uvx --from openhands-agent-server==<ver> ... agent-server
  --host 127.0.0.1 --port <p> --import-modules <mod>`. Importa
  `canvas_ui_tool` (`tools/canvas_ui_tool.py`) via `--import-modules`.
- Linhas 450-470: geração de session API key com `crypto.randomBytes(32)`,
  persistência em `~/.openhands/agent-canvas/session-api-key.txt`
  (`0o600`), export como `OH_SESSION_API_KEYS_0` e
  `OPENHANDS_AUTOMATION_API_KEY` (mesmo valor para os dois).
- Linhas 215, 247, 399: flag `--backend-only` no CLI do `agent-canvas`
  (`bin/agent-canvas.mjs:80`). Habilita modo "só backends" — sem
  frontend estático, sem ingress (verificar: hoje ainda sobe ingress
  em `--backend-only`? ver §1.2 abaixo).
- Linhas 720-735: spawn com `detached: true`, formando process group
  próprio; cleanup via `signalProcessTree` (POSIX) ou `taskkill /T` (Win).
- Linhas 593-630 + `electron/main.mjs:626-630`: health check do
  `/server_info` com timeout 60s em warm, 3-5 min em cold (uvx
  baixando Python + SDK na primeira execução).

### 1.2 Gap atual do `--backend-only`

Hoje, `--backend-only` (CLI `agent-canvas`) **ainda sobe o ingress**
(`scripts/ingress.mjs`), o que não é necessário quando o Tray vai fazer
a ponte WSS direto pro `agent-server`. Verificar se o Tray precisa
pular o ingress ou se ele é transparente (não interfere no WSS).

Ação proposta no SPEC §2.2: flag `--no-frontend` no
`dev-with-automation.mjs` para o caso Tray; alinhar naming ou
documentar claramente que `--backend-only` no `agent-canvas` CLI já
cobre o caso (ver PRD §8 RISCO-03).

### 1.3 Wrapper Electron

`electron/main.mjs` (785 linhas) implementa o wrapper desktop que
arranca o stack todo, injeta `uv`/`uvx` empacotado em
`Resources/bin/`, e abre `BrowserWindow` quando `/server_info` responde.
Esse caminho é o wrapper recomendado para o caso **mesma máquina**;
não precisa ser tocado pelo Tray (a coexistência é a decisão
recomendada — PRD §8 RISCO-02).

## 2. Arquitetura proposta

### 2.1 Visão de processos (uma instância do Tray em execução)

```
┌─────────────────────────────────────────────────────────────┐
│ Host: máquina local do usuário                              │
│                                                             │
│  ┌─────────────────────────────┐                            │
│  │ openhands-tray (Go + Wails) │  system tray icon         │
│  │ - tunnel.go (goroutine A)   │  ↕ WS outbound            │
│  │ - proxy.go   (goroutine B)  │  ↕ HTTP loopback          │
│  │ - agent.go   (subprocess)   │                            │
│  └──────┬──────────────────┬───┘                            │
│         │ WSS outbound     │ spawn detached                 │
│         ▼                  ▼                                │
│  (TCP 443 → VPS)     ┌────────────────────────┐             │
│                       │ dev-with-automation.mjs│             │
│                       │  --backend-only        │             │
│                       │  --port 8000           │             │
│                       └──────────┬─────────────┘             │
│                                  │ uvx spawn                │
│                                  ▼                          │
│                       ┌────────────────────────┐             │
│                       │ agent-server (Python)  │             │
│                       │  127.0.0.1:8000        │             │
│                       └────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ WSS inbound (VPS → Tray)
                            │
┌───────────────────────────┴─────────────────────────────────┐
│ Host: VPS (Canvas rodando --frontend-only)                  │
│                                                             │
│  ┌──────────────────────────────────────┐                   │
│  │ scripts/ingress.mjs                 │                   │
│  │  /api/*  → agent-canvas              │                   │
│  │  /       → static frontend          │                   │
│  │  /agent-tunnel (NEW) → wss handler  │ ← SPEC §2.3       │
│  └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Goroutines no Tray

| Goroutine | Responsabilidade | Cleanup |
|-----------|------------------|---------|
| `main` | Wails event loop + tray icon | app shutdown |
| `tunnelRead` | WS read pump (envelopes da VPS) | context cancel |
| `tunnelWrite` | WS write pump (envelopes pra VPS) | context cancel |
| `keepalive` | 15s tick, envia `{"type":"ping"}` | context cancel |
| `proxyHandler` | Por-request: decode envelope, HTTP call, encode response | per-request context |
| `sidecarWatcher` | `cmd.Wait()` no subprocess, restart on exit | context cancel |
| `healthChecker` | 5s tick, GET /server_info, restart if down | context cancel |
| `auditLogger` | Bufferiza audit lines, flush a cada 1s ou 100 linhas | app shutdown |

Sincronização: `sync.Mutex` no `tunnel.conn` (write pump exclusivo);
`sync.RWMutex` no map `inFlight map[string]context.CancelFunc` para
requests em vôo.

### 2.3 Tamanho do binário

Estratégia para ficar < 50 MB:
- `go build -trimpath -ldflags="-s -w"` remove path info e DWARF.
- `upx --best` comprime mais 50-60% (opcional, default off por causa de
  startup overhead ~50ms).
- CGo evitado (Wails3 não precisa de CGo para a parte WebView; só pra
  event loop que pode ser evitado).
- Dependências mínimas: `gorilla/websocket`, `golang.org/x/sys` (signals),
  `gopkg.in/natefinch/lumberjack.v2` (log rotation). Sem `logrus`, sem
  `zap`, sem `cobra` (CLI MVP é só `flag` stdlib).

## 3. Modelo de dados e migrações

### 3.1 `~/.config/openhands-tray/config.json`

Schema já definido em SPEC §2.6. **Não há migração** na v1 (zero
release quebrando schema). Versionamento semântico do JSON via campo
`"version": 1` no topo do arquivo (preparado para v2 futura).

### 3.2 `~/.openhands/agent-canvas/session-api-key.txt`

Arquivo **existente** usado pelo Electron wrapper
(`scripts/dev-with-automation.mjs:450-470`). Tray reusa o mesmo path
para evitar criar silo novo de credenciais. Se arquivo existir e
permissões != 0o600, Tray aborta com mensagem clara ("Please fix
permissions: chmod 600 ~/.openhands/agent-canvas/session-api-key.txt").
Se arquivo não existir, gera e persiste.

Risco: race entre Tray e Electron wrapper se ambos rodarem
simultaneamente. Decisão MVP: lockfile no Tray (SPEC §5 CE-05) garante
single-instance; Electron tem o próprio single-instance lock no
`app.requestSingleInstanceLock()` (`electron/main.mjs`).

### 3.3 `~/.local/state/openhands-tray/log/`

- `tray-YYYY-MM-DD.log` — slog geral (info, warn, error).
- `audit-YYYY-MM-DD.log` — audit (nginx combined + bridge fields).
- `sidecar-YYYY-MM-DD.log` — stdout/stderr do
  `dev-with-automation.mjs` + agent-server.
- Rotação: diária via `lumberjack`; retenção 14 dias; compressão gzip
  para > 7 dias.

## 4. Contratos

### 4.1 WSS envelope (SPEC §2.4)

Sem mudança após SPEC; pinning no código Go via struct tipada:

```go
type Request struct {
    Type    string            `json:"type,omitempty"`   // "ping" ou ausente
    ID      string            `json:"id,omitempty"`     // UUID v4
    Method  string            `json:"method,omitempty"`
    Path    string            `json:"path,omitempty"`
    Headers map[string]string `json:"headers,omitempty"`
    BodyB64 string            `json:"body_b64,omitempty"`
}

type Response struct {
    Type    string            `json:"type,omitempty"`   // "pong" ou ausente
    ID      string            `json:"id"`
    Status  int               `json:"status,omitempty"`
    Headers map[string]string `json:"headers,omitempty"`
    BodyB64 string            `json:"body_b64,omitempty"`
}
```

Validação:
- `id` obrigatório em Response (eco da Request).
- `status` obrigatório em Response (exceto type="pong").
- `body_b64` validado como base64 padrão antes de decode.

### 4.2 Handshake HTTP/1.1 (SPEC §4.3)

Sem mudança após SPEC; pinning via `gorilla/websocket.Dialer` com
`Authorization: Bearer <token>` no `http.Header`.

### 4.3 Hook `scripts/ingress.mjs` (SPEC §2.3) — IMPLEMENTADO no Sprint 02

Diferente do handler genérico de `upgrade` atual (que só faz
`proxy.proxyWebSocket(req, socket, head, backend)` — passthrough puro), o
`/agent-tunnel` precisa de um **servidor WS terminal**: valida o bearer,
mantém a conexão, e faz o papel de lado-VPS da bridge (manda envelopes
`{id, method, path, headers, body_b64}`, recebe `{id, status, ...}`).

**Não existe "upstreamPort".** O WS já é o transporte fim-a-fim até o
Tray; a VPS não tem nenhum serviço local para o qual repassar. Confirmado
no spike: o `vps.mjs` era um `WebSocketServer` terminal, e o `ingress.mjs`
atual não sabe fazer isso — logo o hook precisa de código dedicado.

O código da bridge foi para um módulo próprio, `scripts/agent-tunnel.mjs`
(exporta `createAgentTunnel`, `isSafePath`, `resolveAgentTunnelToken`,
`AGENT_TUNNEL_PATH`), e o `ingress.mjs` só monta e roteia. **Opt-in:** o
endpoint não existe se nenhum token for configurado, então o comportamento
default do ingress não muda.

```bash
node scripts/ingress.mjs \
  --port 8000 \
  --agent-tunnel-token "$INGRESS_AGENT_TUNNEL_TOKEN" \
  --agent-tunnel-route /server_info \
  --agent-tunnel-route /api \
  --default "http://localhost:3001"
```

- `--agent-tunnel-token` / `INGRESS_AGENT_TUNNEL_TOKEN` — habilita o WSS
  terminal em `/agent-tunnel` e define o bearer aceito.
- `--agent-tunnel-route <prefixo>` — requests HTTP sob o prefixo passam a ir
  pelo túnel em vez de um backend local. **Repetível**, e na prática precisa
  ser: o agent-server serve `/server_info` na **raiz** e o resto sob `/api`.
  Sem Tray conectado as rotas de túnel respondem **502**, não 503, para o
  operador distinguir "rota não configurada" de "Tray offline".
- O roteamento por túnel é avaliado **antes** da interceptação local de
  `/server_info`, para que o servidor do Tray responda o bootstrap de
  compatibilidade em vez do backend local (que neste cenário não existe).

Invariantes de segurança implementados:

- Comparação do bearer em **tempo constante** (`timingSafeEqual`, com guarda
  de tamanho); recusa com **401 antes do handshake** completar.
- Path tem que ser **origin-relative** (`/...`, nunca `//...`). Um peer
  comprometido não consegue reapontar a request para outro host.
- Um Tray "mais novo" substitui o anterior (close **1008**) — um processo
  zumbi não continua recebendo tráfego depois de um restart.
- A resposta que volta para a VPS **não** carrega `x-session-api-key`. Esta
  é a correção que os testes forçaram: o filtro inicial só tirava headers
  hop-by-hop, então uma resposta do agent-server que ecoasse a credencial
  devolvia a session key do Tray à VPS — exatamente o invariante que o
  SPEC §4.4 promete (ver `SPRINT-02.md`).

`ws` era dependência transitiva e virou **direta** (`"ws": "8.21.0"`, pin
exato), com `@types/ws` em dev porque o pacote não publica tipos.

**Gestão de tokens (QUESTÃO-01):** o CRUD do bearer (emitir/listar/revogar)
vive na UI do Canvas, provavelmente na tela de backends ("Add backend"),
que já é onde o usuário cadastra destinos. É mudança de frontend neste repo
— entra no SPEC §6 como arquivo novo em `src/components/features/backends/`.
Ainda **não implementado**; hoje o token vem de flag/env.

## 5. Alternativas consideradas

| Alternativa | Por que não | Mantida como |
|-------------|-------------|---------------|
| Reescrever agent-server em Go | Runtime Python+MCP+Docker intocado, semanas de trabalho | Não |
| Tailscale/ngrok/Cloudflare Tunnel | Dependência externa, setup extra do usuário | Não |
| Electron (já existe) | ~598 MB binário, mesmo caso mesma-máquina | Wrapper mesma-máquina |
| Wails3 (alpha) | Maturidade baixa — validar antes | UI Tray |
| Wails v2 | Estável, menos features (Svelte, React) | Fallback UI Tray |
| Fyne (Go puro) | UI limitada, sem WebView | Hipotético |
| Rust + Tauri | Não-Go — quebra decisão de "binário Go" do artefato | Não |
| Node + Electron headless | Igual Electron wrapper | Não |
| Python + PyQt/Tk | Look-and-feel pior, dep ~30 MB | Não |
| Native (Swift/Kotlin/C#) | 3 codebases | Não |

## 6. Segurança, permissões e privacidade

### 6.1 Camadas (resumindo SPEC §4)

- **Rede**: WSS obrigatório, TLS 1.2+, system CA validation.
- **Auth WSS**: Bearer token estático (MVP); Ed25519 challenge-response
  (v1+); mTLS (v2).
- **Persistência**: `0o600` em todos os arquivos de credenciais.
- **Logs**: redaction automática de `Authorization`, `Bearer`, `X-Session-API-Key`
  via wrapper `slog.Handler`.
- **Agent-server access**: full local filesystem (sem sandbox no MVP);
  documentado na primeira execução ("Agent will run with full local
  access to <user>").

### 6.2 Threat model

| Ameaça | Mitigação |
|--------|-----------|
| VPS maliciosa lê session key | **Confirmado mitigado no spike:** a session key local é gerada pelo Tray e injetada localmente por ele; a VPS nunca a vê (T1: ausente nos headers de resposta; T1b: 401 sem ela). O que a VPS vê é o bearer do bridge. |
| MITM no WSS | TLS obrigatório |
| Local privilege escalation via Tray | Tray roda como user (não root); não há setuid |
| Token leak via logs | Redaction automática |
| Replay attack | UUID v4 em todo envelope; VPS pode validar monotonicidade |
| DoS via flood de WS frames | Rate limit no handler VPS: 100 req/s por bridge_id |

### 6.3 Compliance

- Sem coleta de telemetria sem consentimento (mesmo padrão de
  AGENTS.md §"Tracking / Analytics Architecture" — Tray é opt-in).
- Logs locais apenas; nada sai da máquina do usuário sem ação
  explícita.

## 7. Performance e escala

### 7.1 Targets (PRD §6)

- p50 latência bridge ≤ 50ms, p99 ≤ 200ms em rede 50 Mbps / 30ms RTT.
- Cold start ≤ 90s (uvx download Python + SDK); warm start ≤ 5s.
- Reconnect ≤ 30s.

### 7.2 Gargalos prováveis

- **Goroutine spawn por request**: aceitável até ~1000 req/s
  sustentado. Acima disso, worker pool com canal buffered.
- **JSON encoding/decoding base64**: ~50 MB/s em CPU moderna; gargalo
  só em uploads > 100 MB.
- **WS write pump bloqueando**: write pump em goroutine separada,
  canal buffered 1000 envelopes; back-pressure via drop de envelopes
  antigos com log warning.

## 8. Observabilidade

### 8.1 Logs estruturados

`slog` JSON handler, campos imutáveis em todo log:
- `bridge_id`: UUID v4 gerado na primeira execução, persistido.
- `session_id`: id da conexão WSS atual (UUID v4, renovado a cada
  reconnect).
- `tray_version`: semver do binário.
- `host_os`: `runtime.GOOS`.
- `host_arch`: `runtime.GOARCH`.

### 8.2 Métricas

- Counter `requests_total{status_class}` (2xx/4xx/5xx/error).
- Histogram `request_duration_seconds`.
- Gauge `inflight_requests`.
- Counter `reconnects_total{reason}` (network_error/auth_error/...).
- Counter `sidecar_restarts_total{reason}` (exit/crash/health_fail).

Expostos via `http://127.0.0.1:<metricsPort>/metrics` (porta
configurável, default desabilitado). Formato Prometheus text.

### 8.3 Trace

OpenTelemetry OTLP exporter para OTLP-compatible backend
(Laminar/Honeycomb/etc — mesmo padrão do SDK de AGENTS.md). Opt-in via
`OTTL_EXPORTER_OTLP_ENDPOINT` env.

### 8.4 Gate de código (estado da base antes de planejar em cima dela)

- AGENTS.md lido e respeitado: este PRD/SPEC/TECH são planning artifacts
  (Markdown em `docs/features/`), **não código**. O código vai em repo
  irmão.
- `scripts/dev-with-automation.mjs` mapeado (linhas 215, 247, 399,
  450-470, 907-955).
- `scripts/dev-safe.mjs::buildAgentServerCommand` mapeado (linhas
  434-540).
- `electron/main.mjs` mapeado para coexistência.
- `bin/agent-canvas.mjs` mapeado (linhas 56, 80).
- `scripts/ingress.mjs` mapeado para hook de `/agent-tunnel`.
- Pendente: decidir repo location (PRD §8 RISCO-01) antes de criar
  `go.mod`.

## 9. Estratégia de testes

- **Unit (Go)**: `go test ./internal/...` com `testing` + `testify/assert`.
  Coverage ≥ 80% em `tunnel`, `proxy`. Mock de `*websocket.Conn` via
  interface + fake.
- **Integration**: `tests/integration/start_test.go` (build tag
  `integration`). Sobe VPS mock (`httptest.NewServer` +
  `nhooyr.io/websocket`), sobe agent-server real via `uvx`, sobe Tray
  em subprocess. Dispara 100 requests; compara responses com controle.
- **E2E manual**: `tests/e2e/OPENHANDS_TRAY.md` — roteiro de QA
  contra VPS provisionada. Depende de PRD §8 QUESTÃO-01 resolvida.
- **Soak**: `tests/soak/soak_test.go` — 24h de carga constante,
  valida `runtime.NumGoroutine()` estável.
- **Fuzz**: `internal/proxy/envelope_test.go::FuzzDecode` —
  `go test -fuzz=FuzzDecode -fuzztime=60s`.
- **Property-based**: `internal/proxy/frame_test.go::TestRoundtrip`
  — gera 1000 envelopes aleatórios, encode → decode, valida
  identidade.

## 10. Rollout, feature flag e rollback

- **MVP (Sprint 04)**: release `v0.1.0` do `JoaoNetoDev/openhands-tray`.
  Install via `brew install openhands-tray/tap/openhands-tray` (mac),
  `apt install` (Linux), `winget install` (Windows). Sem auto-update.
- **v1.0 (Sprint 07)**: auto-update via `go-update` (Go library,
  stable). Channel `stable` / `beta`. Rollback = downgrade manual.
- **Feature flag**: nenhum (binário standalone, install = opt-in).
- **Rollback da feature na VPS**: ingress hook `/agent-tunnel` é
  additive; remover o hook no `scripts/ingress.mjs` desabilita a
  feature sem efeito colateral no frontend estático.

## 11. Rastreabilidade PRD → TECH

| PRD | SPEC | TECH |
|-----|------|------|
| §1 problema | §1, §2.2 | §1, §2 |
| §2 usuários/cenários | §3 | §2.1, §7 |
| §3 objetivos | §1 | §2.1 |
| §4 RFs | §2, §3, §5 | §4, §6 |
| §5 RNFs | §4 | §6, §7 |
| §6 métricas | §3, §5 | §7, §8 |
| §7 faseamento | §2, §3 | §10 |
| §8 riscos | §2.3, §4, §5 | §1.2, §5, §6 |
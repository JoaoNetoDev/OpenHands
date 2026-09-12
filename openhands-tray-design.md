# OpenHands Tray — Canvas (VPS) ↔ Agent (Local)

Binário único em Go + Wails3 que age como **bridge nativo** entre o Canvas do OpenHands hospedado numa VPS e o agent-server rodando na máquina local do usuário.

---

## 1. Contexto e motivação

- O **Canvas** do OpenHands é uma interface web (`localhost:8000/canvas`) que faz split entre frontend e backend via `agent-canvas --frontend-only` / `--backend-only`.
- Por padrão, tudo roda numa única máquina, mas o modelo deles já foi desenhado pra **múltiplos backends em hosts diferentes** ("You can add additional backends directly from the UI").
- O caso de uso aqui é: usuário controla o agente pelo Canvas na VPS, mas a **execução acontece na máquina local**, atrás de NAT/firewall, sem expor portas.

---

## 2. Arquitetura final

```
┌─────────────────────────────────────────────────┐
│  binário único (Go + Wails3)                    │
│  ┌───────────────────────────────────────────┐  │
│  │  Tray icon + janela de configuração       │  │
│  ├───────────────────────────────────────────┤  │
│  │  Tunnel client (WS outbound)              │  │
│  ├───────────────────────────────────────────┤  │
│  │  Proxy HTTP <-> WS                        │  │
│  ├───────────────────────────────────────────┤  │
│  │  Lifecycle do subprocesso agent-server    │  │
│  └───────────────────────────────────────────┘  │
└────────┬────────────────────────────────┬───────┘
         │ WSS (outbound, persistente)   │ HTTP loopback
         ▼                               ▼
┌──────────────────┐         ┌────────────────────────┐
│  Canvas (VPS)    │         │  agent-server (sidecar)│
│  WSS endpoint    │         │  127.0.0.1:8000        │
└──────────────────┘         └────────────────────────┘
```

### Fluxo

1. Usuário inicia o tray → spawn do `agent-server` como subprocesso (sidecar)
2. Tray abre conexão WSS outbound pra VPS (passa por qualquer NAT/firewall)
3. VPS envia requests HTTP-like via WS → tray faz reverse-proxy pro agent-server local
4. Eventos do agent-server voltam pelo mesmo WS pro Canvas
5. Reconexão automática com backoff exponencial + jitter se cair

---

## 3. Decisões de design

| Tema | Decisão | Justificativa |
|------|---------|---------------|
| Linguagem | Go 1.22+ | Single static binary, baixo overhead, goroutines pra I/O concorrente |
| Framework UI | Wails3 | ~30 MB vs ~200 MB do Electron, tray nativo excelente |
| Runtime | Sidecar (não embutido) | OpenHands runtime tem Python + MCP + sandbox Docker; reescrever é inviável |
| Protocolo com VPS | WSS + token estático no header | Simples, suficiente pra single-user |
| Auth | Token mútuo + opcional mTLS | Boa relação custo/benefício, mTLS pra paranoico |
| Persistência | `~/.config/openhands-tray/config.json` | Padrão XDG, portável |
| Logs | `log/slog` → arquivo rotativo | Stdlib, sem deps externas |
| Auto-start | LaunchAgent (mac) / systemd (linux) / Scheduled Task (win) | Cada plataforma tem seu caminho |

---

## 4. Estrutura do projeto

```
openhands-tray/
├── main.go                       # entrypoint Wails3 + tray
├── app.go                        # bindings Go <-> JS
├── wails.json
├── go.mod
├── internal/
│   ├── agent/
│   │   └── agent.go              # spawn + lifecycle do agent-server
│   ├── tunnel/
│   │   └── tunnel.go             # WS client com reconexão
│   ├── proxy/
│   │   └── proxy.go              # reverse proxy HTTP <-> WS
│   ├── config/
│   │   └── config.go             # load/save de config
│   └── logging/
│       └── logging.go            # setup slog
├── ui/                           # frontend Wails3
│   ├── index.html
│   └── src/
│       └── App.svelte
├── build/
│   ├── appicon.png
│   ├── darwin/
│   └── windows/
└── README.md
```

---

## 5. Código de partida

### 5.1 Spawn do agent-server

```go
// internal/agent/agent.go
package agent

import (
	"os/exec"
	"syscall"
)

type Process struct {
	Cmd    *exec.Cmd
	Workdir string
}

func Start(workdir string) (*Process, error) {
	cmd := exec.Command("agent-server", "serve", "--backend-only")
	cmd.Dir = workdir
	cmd.SysProcAttr = &syscall.SysProcAttr{} // detach opcional
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &Process{Cmd: cmd, Workdir: workdir}, nil
}

func (p *Process) Stop() error {
	return p.Cmd.Process.Signal(syscall.SIGTERM)
}
```

### 5.2 Tunnel WS com reconexão

```go
// internal/tunnel/tunnel.go
package tunnel

import (
	"context"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

type Tunnel struct {
	URL   string
	Token string
	OnMsg func([]byte)
	conn  *websocket.Conn
}

func (t *Tunnel) Run(ctx context.Context) error {
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err := t.connect(); err != nil {
			jitter := time.Duration(rand.Int64N(int64(backoff)))
			time.Sleep(backoff + jitter)
			backoff = min(backoff*2, 30*time.Second)
			continue
		}
		backoff = time.Second

		for {
			_, msg, err := t.conn.ReadMessage()
			if err != nil {
				t.conn.Close()
				break
			}
			t.OnMsg(msg)
		}
	}
}

func (t *Tunnel) connect() error {
	hdr := http.Header{}
	hdr.Set("Authorization", "Bearer "+t.Token)

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.Dial(t.URL, hdr)
	if err != nil {
		return err
	}
	t.conn = conn
	return nil
}

func (t *Tunnel) Send(msg []byte) error {
	if t.conn == nil {
		return ErrNotConnected
	}
	return t.conn.WriteMessage(websocket.TextMessage, msg)
}
```

### 5.3 Reverse proxy HTTP <-> WS

```go
// internal/proxy/proxy.go
package proxy

import (
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
)

type Proxy struct {
	LocalURL string // ex.: http://127.0.0.1:8000
	target   *url.URL
}

func New(localURL string) (*Proxy, error) {
	u, err := url.Parse(localURL)
	if err != nil {
		return nil, err
	}
	return &Proxy{LocalURL: localURL, target: u}, nil
}

// WrapRequest: request HTTP recebida do tunnel -> HTTP pro agent-server.
// Retorna a response crua pra ser enviada de volta via WS.
func (p *Proxy) WrapRequest(r *http.Request) (*http.Response, error) {
	r.URL.Scheme = p.target.Scheme
	r.URL.Host = p.target.Host
	r.Host = p.target.Host
	resp, err := http.DefaultClient.Do(r)
	return resp, err
}

// ReadResponse: serializa response pra envio via WS.
func ReadResponse(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}
```

### 5.4 Config persistente

```go
// internal/config/config.go
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	VPSURL     string `json:"vps_url"`
	Token      string `json:"token"`
	AgentPath  string `json:"agent_path"`
	Workdir    string `json:"workdir"`
}

func Path() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "openhands-tray", "config.json"), nil
}

func Load() (*Config, error) {
	path, err := Path()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return &Config{}, nil // default
	}
	var c Config
	return &c, json.Unmarshal(data, &c)
}

func (c *Config) Save() error {
	path, _ := Path()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}
```

### 5.5 UI mínima (Svelte)

```svelte
<!-- ui/src/App.svelte -->
<script>
  import { GetConfig, SaveConfig } from "../wailsjs/go/main/App";

  let vpsURL = "";
  let token = "";
  let status = "desconectado";

  $effect(() => {
    GetConfig().then(c => {
      vpsURL = c.vpsURL;
      token = c.token;
    });
  });

  async function save() {
    await SaveConfig({ vpsURL, token });
    status = "salvo";
  }
</script>

<main>
  <h1>OpenHands Tray</h1>
  <label>
    VPS WSS URL
    <input bind:value={vpsURL} placeholder="wss://sua-vps.com/agent" />
  </label>
  <label>
    Token
    <input bind:value={token} type="password" />
  </label>
  <button on:click={save}>Salvar</button>
  <p>Status: {status}</p>
</main>
```

---

## 6. Protocolo WS (sugestão mínima)

Pra simplicidade, o tray trata cada mensagem do VPS como uma **request HTTP serializada** e cada mensagem pro VPS como uma **response HTTP serializada**:

```json
// VPS -> tray
{
  "id": "uuid",
  "method": "POST",
  "path": "/api/chat",
  "headers": { "Content-Type": "application/json" },
  "body": "base64..."
}

// tray -> VPS
{
  "id": "uuid",
  "status": 200,
  "headers": { "Content-Type": "application/json" },
  "body": "base64..."
}
```

Alternativas:
- **Streaming via SSE-like frames**: `{"id":"x","event":"chunk","data":"..."}`
- **Multiplexing**: múltiplas requests na mesma conexão WS (goroutine por request)

Pra MVP, o envelope síncrono acima resolve.

---

## 7. Setup da VPS (Canvas)

```bash
# na VPS
npm install -g @openhands/agent-canvas
export OH_TUNNEL_PUBLIC_URL="wss://sua-vps.com/agent"
agent-canvas --frontend-only
```

Configurar nginx/caddy pra fazer TLS termination e proxy pro `agent-canvas`:

```nginx
# /etc/nginx/sites-available/openhands
server {
  listen 443 ssl;
  server_name sua-vps.com;

  ssl_certificate     /etc/letsencrypt/live/sua-vps.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sua-vps.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

---

## 8. Setup local (máquina do usuário)

```bash
# 1. build do tray
git clone https://github.com/seu-user/openhands-tray
cd openhands-tray
go build -o openhands-tray

# 2. sidecar do agent-server (baixado uma vez)
curl -fsSL https://install.openhands.dev/install.sh | sh

# 3. rodar o tray
./openhands-tray
```

Primeira execução: janela de configuração pede VPS URL + token. Tray abre WSS, spawn do agent-server, tudo passa a funcionar.

---

## 9. Segurança

| Camada | Medida |
|--------|--------|
| Rede | WSS com TLS obrigatório |
| Auth | Token estático (mínimo) ou mTLS (paranóico) |
| Agent | Roda **sem sandbox** = acesso total à máquina local; documentar isso pro usuário |
| Filesystem | Considerar `SANDBOX_VOLUMES` pra limitar quais dirs ficam expostos |
| Multi-user | **Não suportado** — agent-server é single-tenant por design |
| Audit | Log de toda request que chega via WS pra arquivo rotativo |

---

## 10. Roadmap sugerido

1. **MVP** (1 semana)
   - Tray com config + tunnel + reverse proxy
   - Sem UI, só flags CLI: `-vps`, `-token`, `-workdir`
   - Testar com SSH tunnel manual primeiro
2. **v1** (2 semanas)
   - UI Wails3 com status indicator
   - Auto-start por plataforma
   - Auto-update via `go-update`
3. **v1.5**
   - Streaming de events via WS (não mais request/response)
   - Sandbox opcional por projeto
4. **v2**
   - Multi-agent (múltiplos trays na mesma máquina, um por workspace)
   - Métricas + dashboard

---

## 11. Por que **não** outras abordagens

- **Reescrever agent-server em Go**: semanas de trabalho, duplica runtime Python+MCP
- **Tailscale puro**: funciona, mas exige setup extra do usuário e dependência externa
- **Electron**: 7x o tamanho do binário, 6x a RAM, sem ganho real
- **Pure JS tray (ex: Tauri JS)**: atrito desnecessário quando Go já resolve I/O + WS + tray nativamente

---

## 12. TL;DR

- **Stack:** Go + Wails3 + sidecar do `agent-server`
- **Binário:** ~30 MB + runtime sidecar
- **Conecta:** WSS outbound (passa qualquer NAT) → Canvas na VPS
- **Executa:** agent-server na máquina local, com filesystem do usuário
- **Auth:** token estático (mínimo) ou mTLS (forte)
- **Build:** `go build`, distribui como `.app`/`.exe`/binário Linux

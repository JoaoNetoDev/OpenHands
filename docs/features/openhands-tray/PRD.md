# PRD — OpenHands Tray (Canvas na VPS ↔ Agent local)

> Documento de planejamento. O artefato original `openhands-tray-design.md`
> (na raiz do repo) é a fonte da motivação e está referenciado aqui. Este
> PRD/SPEC/TECH são a revisão estruturada do mesmo, com correções factuais
> em relação à base de código real.

## 1. Problema e evidência

O Canvas do OpenHands foi desenhado para rodar tudo numa única máquina
(`bin/agent-canvas.mjs` arranca agent-server + automation + frontend + ingress
juntos), e o repo já documenta explicitamente o caso de **múltiplos backends
em hosts diferentes**: "You can add additional backends directly from the
UI" (README, AGENTS.md). O que **não existe** hoje é o caso simétrico
inverso: usuário controlando o agente pelo Canvas hospedado numa VPS, mas
com a **execução acontecendo na máquina local** dele — atrás de NAT/firewall,
sem expor portas.

Inspeção da base confirma os pontos de fricção:

- `scripts/dev-with-automation.mjs` linhas 215, 247 e 399 expõem a flag
  `--backend-only` **apenas no CLI Node do agent-canvas**, não no
  `agent-server`. Já `scripts/dev-safe.mjs:434-540` e
  `dev-with-automation.mjs:907-955` mostram que o agent-server é na verdade
  um binário Python rodado via `uvx` (`uvx --from
  openhands-agent-server==<ver> agent-server --host 127.0.0.1 --port <p>
  --import-modules <mod>`), sem subcomando `serve` e sem `--backend-only`.
  O artefato `openhands-tray-design.md` §5.1 prescreve `agent-server serve
  --backend-only`, que **não é um comando real** — precisa ser reescrito
  para a invocação correta do `uvx` ou, melhor ainda, para reusar o
  sidecar orquestrado por `dev-with-automation.mjs --backend-only`.
- A autenticação inter-serviço hoje é `X-Session-API-Key`, um valor
  aleatório de 32 bytes (`crypto.randomBytes(32)`) gerado pelo launcher e
  persistido em `~/.openhands/agent-canvas/session-api-key.txt`
  (`scripts/dev-with-automation.mjs:450`, `:464`, `:936`, `:1041`). O
  artefato propõe um **token estático Bearer** via header WS — modelo
  diferente, mais simples, mas não reaproveita a infraestrutura já
  existente (geração, persistência, rotação).
- `electron/main.mjs` (785 linhas) já implementa um wrapper desktop que
  arranca o stack todo via `dev-with-automation.mjs`, injeta `uv`/`uvx`
  empacotado, e abre um `BrowserWindow` quando o `/server_info` responde
  200/401. O artefato descarta Electron como "7x tamanho, 6x RAM", mas não
  dialoga com essa implementação — pode ser complementar (mesma máquina:
  Electron; cross-host: Tray), pode ser substituto (um Tray único para
  tudo), ou pode ser canibalizado (Tray roda só o que o Electron não
  roda).
- AGENTS.md declara explicitamente: **"This repository is the OpenHands
  frontend"** e a tabela de fronteira entre repos coloca novos backends,
  servidores e runtimes em `OpenHands/software-agent-sdk` ou em um repo
  irmão. Adicionar binário Go + UI Wails3 neste repo violaria essa
  fronteira.

Consequência prática: hoje, usuário com Canvas na VPS e agent local tem
três caminhos informais — Tailscale, SSH reverso, ou expor o agent-server
da máquina local — nenhum nativo, nenhum documentado, nenhum reverso
(Canvas na VPS + agent-server atrás de NAT é o caso comum, não o oposto).

## 2. Usuários e cenários de uso

Usuário único (MVP): desenvolvedor OpenHands-control-center que quer
controlar o agente pela UI da VPS mas ter o código + execução + filesystem
na máquina local dele, atrás de NAT/firewall corporativo.

Cenários MVP:
- **Iniciar conversa a partir da VPS**: usuário abre o Canvas na VPS
  (browser, `https://sua-vps.com`), a UI carrega normalmente; quando ele
  envia a primeira mensagem, o tray local (que estava dormindo no system
  tray) acorda, valida o token com a VPS via WSS outbound, sobe o
  agent-server local (cold start ~30-90s na primeira vez por causa do
  uvx), e a request atravessa a ponte.
- **Sessão longa**: usuário deixa o tray aberto por horas; reconexão
  automática se a VPS reiniciar ou se a rede cair.
- **Múltiplos projetos**: usuário trabalha em dois workspaces diferentes na
  mesma máquina; troca o `workdir` configurado e o agent-server é
  reiniciado para o novo path (idempotente).
- **Desligar**: usuário "Quit Tray" pelo menu; agent-server recebe
  `SIGTERM`, sessão API key continua persistida para o próximo start.

Cenários fora do MVP (v1+):
- Streaming de eventos do agent-server direto via WS sem serializar pra
  request/response (latência perceptível para terminal/VSCode).
- Sandbox opcional por projeto (limitar quais paths ficam expostos).
- Multi-tray na mesma máquina (um por workspace).

## 3. Objetivos e não-objetivos

**Objetivos**
- Permitir ao usuário controlar o agent-server local pelo Canvas rodando
  numa VPS, sem expor porta local e sem exigir Tailscale/SSH reverso.
- Manter o agent-server como sidecar — `OpenHands/software-agent-sdk`
  continua sendo dono do runtime Python+MCP+Docker; o Tray é só bridge.
- Reusar, sempre que possível, o que já existe: launcher
  `scripts/dev-with-automation.mjs --backend-only` (cold start uvx,
  session-key persistence, SIGTERM tree cleanup), modelo de auth
  `X-Session-API-Key` (32 bytes aleatórios, persistido em XDG config),
  e config defaults (`config/defaults.json`).
- Conexão outbound WSS — passa NAT/firewall sem configuração adicional do
  usuário além de abrir a porta 443.
- Auto-start por plataforma (LaunchAgent macOS, systemd Linux, Scheduled
  Task Windows) — mesmo padrão do que AGENTS.md descreve para o Electron.

**Não-objetivos (MVP)**
- Não substitui `electron/main.mjs` para o caso **mesma máquina**. Tray é
  para o caso cross-host; Electron continua sendo o wrapper recomendado
  para o usuário que já tem tudo local. Decisão de unificar é v1.5+ e
  precisa de aprovação.
- Não reescreve o agent-server em Go. Runtime Python+MCP fica intocado.
- Não multiplexa múltiplas conexões de usuários — single-tenant por
  design, igual ao agent-server.
- Não adiciona dependência externa (Tailscale, ngrok, Cloudflare
  Tunnel). Tray é só cliente WS outbound.
- Não expõe o filesystem local além do `workdir` configurado — sem
  `SANDBOX_VOLUMES` por projeto no MVP (anotado como gap, ver §8).

## 4. Requisitos funcionais

- **RF-01** — Tray expõe menu de sistema: "Open Canvas" (abre URL da VPS
  no browser default), "Status" (mostra conectado/desconectado +
  uptime), "Restart agent-server", "Quit". Sem janela principal.
- **RF-02** — Janela de configuração na primeira execução (ou via menu
  "Settings"): pede VPS WSS URL, token Bearer, workdir local, e
  opcionalmente porta local do agent-server (default `127.0.0.1:8000`).
- **RF-03** — Persiste config em `~/.config/openhands-tray/config.json`
  (XDG) com permissões `0o600` — mesmo padrão do
  `session-api-key.txt` no wrapper Electron.
- **RF-04** — Estabelece WSS outbound pra VPS no startup; se falhar,
  reconnect com backoff exponencial + jitter (cap 30s), mesmo padrão da
  §5.2 do artefato original.
- **RF-05** — Envia `Authorization: Bearer <token>` no handshake WS.
- **RF-06** — Recebe envelopes JSON `{id, method, path, headers, body}`
  da VPS, executa HTTP request pro agent-server local, devolve
  `{id, status, headers, body}` pelo mesmo WS (protocolo MVP — sem
  streaming, sem multiplex).
- **RF-07** — Spawn do agent-server como subprocesso sidecar, reusando
  `dev-with-automation.mjs --backend-only` (preferido) OU invocação
  direta do `uvx --from openhands-agent-server==<ver> agent-server
  --host 127.0.0.1 --port <p> --import-modules <mod>` (fallback), com
  `OH_SESSION_API_KEYS_0=<session-key>` no env.
- **RF-08** — Health check periódico ao agent-server local (`GET
  /server_info` com `X-Session-API-Key`); se falhar, reinicia o
  sidecar.
- **RF-09** — Graceful shutdown do sidecar com a já documentada
  `signalProcessTree` (POSIX) ou `taskkill /T /F` (Windows) — não
  reinventa.
- **RF-10** — Gera a session API key local (32 bytes, base64url) na
  primeira execução; persiste em
  `~/.config/openhands-tray/session-api-key.txt` com `0o600`; reusa nas
  execuções seguintes; expõe no menu "Settings > Reveal session key"
  (copia pra clipboard).
- **RF-11** — Log rotativo (`log/slog` + arquivo diário em
  `~/.local/state/openhands-tray/log/`), retenção 14 dias.
- **RF-12** — Auto-start instalável/desinstalável pelo menu "Settings >
  Auto-start at login".

## 5. Requisitos não-funcionais

- **RNF-01** — Binário único < 50 MB (Electron desktop do agent-canvas
  é ~598 MB; Tray deve ficar bem abaixo).
- **RNF-02** — RAM em idle < 100 MB (Electron BrowserWindow fica em
  ~400 MB).
- **RNF-03** — Startup cold (primeira execução, com download uvx) ≤ 90s
  em rede 50 Mbps — mesmo limite já praticado pelo Electron wrapper
  (`electron/main.mjs:626-630`).
- **RNF-04** — Reconnect após queda ≤ 30s (cap do backoff).
- **RNF-05** — Cross-platform: macOS 12+, Ubuntu 20.04+, Windows 10+
  (mesmo piso do Electron wrapper).
- **RNF-06** — Zero configuração de firewall do lado do usuário — só
  outbound 443.
- **RNF-07** — Sem dependência de serviço externo (sem Tailscale, ngrok,
  Cloudflare Tunnel).
- **RNF-08** — Audit log de toda request que chega via WS pra
  `~/.local/state/openhands-tray/log/audit-YYYY-MM-DD.log`,
  mesmo formato do nginx combined log.

## 6. Métricas de sucesso

- **M-01** — Tempo entre "cliquei em Connect na VPS" e "GET /server_info
  retornou 200" ≤ 90s no cold start, ≤ 5s no warm start (com uvx já em
  cache).
- **M-02** — Zero perda de eventos durante reconnect — eventos do
  agent-server recebidos durante a janela offline são bufferizados no
  agent-server e entregues via `resend_mode=since` no reopen do WS
  (mesmo padrão do `ConversationWebSocketProvider` documentado em
  AGENTS.md §"Conversation history is loaded lazily, REST-first then
  WebSocket").
- **M-03** — Latência adicional introduzida pela ponte ≤ 50ms p50,
  ≤ 200ms p99, em rede 50 Mbps / 30ms RTT.

## 7. Escopo de release e faseamento

- **MVP (Sprint 02-04)** — Sem UI, sem auto-start. CLI:
  `openhands-tray -vps <wss-url> -token <bearer> -workdir <path>`.
  Spawn de agent-server reusando `dev-with-automation.mjs --backend-only`.
  WSS sync request/response. Testado com SSH tunnel manual primeiro
  (mesma sequência que o artefato §10.1 propõe).
- **v1.0 (Sprint 05-07)** — UI Wails3 (tray icon + janela de Settings
  modal). Auto-start por plataforma. Auto-update via `go-update`.
- **v1.5** — Streaming de eventos via WS (substitui sync envelope).
  Sandbox opcional por projeto.
- **v2** — Multi-agent (múltiplos trays, um por workspace). Métricas +
  dashboard.

## 8. Riscos de produto e questões em aberto

- **RISCO-01 — Fronteira de repositório. RESOLVIDO (Sprint 01).** AGENTS.md é
  explícito que este repo é o frontend agent-canvas; o Tray (Go + Wails3) não
  pertence aqui. Decisão: repo novo **irmão** do `software-agent-sdk` —
  nome de trabalho `JoaoNetoDev/openhands-tray` (confirmar o nome antes do
  Sprint 02). Nada de Go neste repo. Ver
  `sprints/SPRINT-01-DECISIONS.md` §1.
- **RISCO-02 — Electron coexistir ou ser substituído. RESOLVIDO com ressalva
  (Sprint 01).** Decisão: substituição é o alvo, mas **faseada**, não imediata.
  `electron/main.mjs` (785 linhas) + `electron-builder.config.mjs` + os hooks
  de packaging carregam correções caras documentadas no AGENTS.md (PATH
  bridging, npm stripping, app naming, Node bundling); deletar antes de o Tray
  ter paridade joga infra boa fora. Divergência de UX a encarar: o Tray não
  tem janela principal, então o mesmo-máquina passaria de janela nativa para
  "abre `http://localhost:8000` no browser". Plano: Tray cobre cross-host
  primeiro (Sprint 02-04); substituição do Electron vira sprint próprio (v1.0+)
  com checklist de paridade. Ver `sprints/SPRINT-01-DECISIONS.md` §1.
- **RISCO-03 — Sidecar ownership.** O artefato propõe spawn direto do
  binário `agent-server`, mas o sidecar real é o stack completo
  `agent-server + automation + ingress` orquestrado por
  `dev-with-automation.mjs`. Para o caso cross-host, o Tray precisa
  apenas do `agent-server` (automation fica na VPS); reusar
  `--backend-only` é o caminho de menor atrito. **Validado, ver SPEC
  §2.1.**
- **RISCO-04 — Modelo de auth.** Token Bearer estático no WS é mais
  simples que reaproveitar `X-Session-API-Key` (que é per-host), mas
  exige que a VPS valide o mesmo token de múltiplos trays (até onde a
  VPS permite). Alternativas:
  - **A.** Token estático, gerado na VPS no provisionamento do usuário,
    colado no Tray (modelo do artefato).
  - **B.** Par de chaves assimétricas: VPS tem a pública, Tray gera
    par local, manda pública no handshake, mensagens assinadas com a
    privada.
  - **C.** Mutual TLS (citado pelo artefato como "paranóico").
  **RESOLVIDO (Sprint 01):** opção **A** no MVP — Bearer estático,
  provisionado pela UI do instalador na VPS (ver QUESTÃO-01), com a
  opção **B** (Ed25519 challenge-response) desenhada para o v1. **C**
  (mTLS) descartada: exige PKI e distribuição de certificados, atrito
  desproporcional para single-user. O spike validou o handshake Bearer
  e a rejeição com close code 1008. A session key local
  (`X-Session-API-Key`) é segredo **separado** e não trafega pela
  bridge. Ver `sprints/SPRINT-01-DECISIONS.md` §1 e §3.
- **RISCO-05 — Wails3 maturidade.** Wails3 (sucessor de Wails v2) está
  em alpha/beta no momento do planning. Alternativas:
  - **Wails v2** (estável, ~10 anos de produção).
  - **Fyne** (Go puro, sem WebView — UI mais limitada).
  - **Electron em Go** (Fyne/Electron via webview).
  **Validar antes de fixar framework; ver TECH §1.**
- **RISCO-06 — Limites de payload.** WS frames têm limite prático (~16 KB
  por frame em algumas redes, ~1 MB em outras). Body base64 em JSON
  estoura rápido. SPEC §3.2 propõe framing binário pra bodies > 64 KB.
- **RISCO-07 — Sandbox.** Sem `SANDBOX_VOLUMES` por projeto, o
  agent-server tem acesso ao filesystem inteiro do usuário. Documentado
  na seção §9 do artefato original; v1.5+ resolve. MVP documenta o
  risco na primeira execução ("Agent will run with full local access").
- **QUESTÃO-01 — Quem hospeda o endpoint WSS na VPS. RESOLVIDA (Sprint 01).**
  Decisão: o endpoint **e** o registro de tokens vivem na UI do Canvas na
  VPS — o instalador provisiona o token do Tray pela própria interface,
  não por serviço separado nem CLI à parte. Tecnicamente: o hook
  `/agent-tunnel` entra no `scripts/ingress.mjs` (SPEC §2.3), e a
  **gestão** de tokens (emitir/listar/revogar) precisa aparecer na UI —
  provavelmente a partir da tela de backends, que já é onde o usuário
  cadastra destinos. Fluxo: instalador abre o Canvas → adiciona um
  backend do tipo "Tray remoto" → a UI gera o token → instalador cola o
  token no Tray. Revogação na mesma tela. Ver
  `sprints/SPRINT-01-DECISIONS.md` §1.
- **QUESTÃO-02** — Como o Tray descobre a porta do agent-server local?
  Hardcoded `127.0.0.1:8000` (default do agente-canvas) ou configurável?
  SPEC §2.1 propõe hardcoded default + override em config.
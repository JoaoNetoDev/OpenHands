# SPRINT-02 — Implementação do core em Go

## Objetivo

Transformar o protocolo validado no Sprint 01 em código de produção: o core
Go em CLI-only (envelope, config, session key, logging, proxy, tunnel,
sidecar) **e** o hook `/agent-tunnel` no `scripts/ingress.mjs` deste repo —
o lado VPS que faltava (era não-objetivo explícito do Sprint 01).

O sprint termina com as duas metades — escritas independentemente, uma em Go e
outra em Node — provadas interoperando de ponta a ponta, e com o repo irmão
`JoaoNetoDev/openhands-tray` inicializado.

Wails3/system tray continuam fora de escopo (RISCO-05), como previsto.

## Depende de

Sprint 01 (protocolo validado, 4 decisões registradas em
`SPRINT-01-DECISIONS.md`).

## Onda

1 (primeiro sprint de código, MVP CLI-only)

## Arquivos previstos

### Repo irmão `/opt/openhands-tray` (novo, `github.com/JoaoNetoDev/openhands-tray`)

| Arquivo | Papel |
|---|---|
| `main.go` | entrypoint CLI |
| `internal/envelope/envelope.go` | tipos Request/Response/Control, framing Text/Binary, body em base64 |
| `internal/config/config.go` | config do host, `0o600` |
| `internal/sessionkey/sessionkey.go` | session key local, `0o600` |
| `internal/logging/logging.go` | log rotativo (lumberjack) |
| `internal/proxy/proxy.go` | cliente HTTP pro agent-server local; injeção da session key; guarda de path/SSRF |
| `internal/tunnel/tunnel.go` | cliente WS: serialização de escrita, backoff, keepalive, cancel por contexto |
| `internal/agent/agent.go` (+ `process_unix.go`, `process_windows.go`) | supervisor do sidecar (process group no Unix, job objects no Windows) |

### Este repo (`OpenHands/OpenHands`)

| Arquivo | Papel |
|---|---|
| `scripts/agent-tunnel.mjs` | lado VPS: termina o WSS `/agent-tunnel`, valida bearer, troca envelopes |
| `scripts/ingress.mjs` | monta o endpoint e roteia a rota de túnel (opt-in) |
| `__tests__/scripts/agent-tunnel.test.ts` | testes do handler + integração com o ingress |
| `package.json` / `package-lock.json` | `ws` promovido a dependência direta; `@types/ws` em dev |

## Passos de implementação

### Passo 1 — Core Go

Implementado conforme SPEC §3/§4. Dois segredos distintos, nenhum
compartilhado entre os lados:

- **Bearer** autentica o Tray perante a VPS, no upgrade do WebSocket.
- **Session key local** autentica o Tray perante o agent-server local. É
  lida/gerada em `~/.openhands/agent-canvas/session-api-key.txt` e **removida**
  de qualquer envelope que chegue (mesmo que a VPS mande uma) antes de o Tray
  injetar a sua.

### Passo 2 — Hook `/agent-tunnel` na VPS (SPEC §2.3)

Opt-in: o endpoint só existe quando um token é configurado, então o
comportamento default do ingress não muda.

```bash
node scripts/ingress.mjs \
  --port 8000 \
  --agent-tunnel-token "$INGRESS_AGENT_TUNNEL_TOKEN" \
  --agent-tunnel-route /api \
  --default "http://localhost:3001"
```

O handler é um servidor WS **terminal**, não um passthrough: o upstream é o
Tray do outro lado do socket, não uma URL local. Por isso ele não usa o
`proxyWebSocket` genérico.

### Passo 3 — Prova de interop

Binário Go real contra o handler Node real, em dois estágios:

1. **Agent-server mock** (`/tmp/tray-e2e/`), para inspecionar a credencial que
   chega do outro lado. Resultado: **9/9**.
2. **Agent-server real** (`/tmp/tray-real/`), para fechar a lacuna que o
   Sprint 01 deixou em aberto (o spike usara um mock Node e registrara que a
   fidelidade do `/server_info` real ficava para este sprint). Resultado:
   **6/6**, contra `agent-server 1.46.0` real (`uvx`), incluindo
   `/server_info` com 21 `usable_tools`.

O estágio 2 é o que dá sentido ao desenho: `/api/settings` responde **401**
direto no agent-server real e **200** pelo túnel, provando que é a session key
injetada pelo Tray — e não um backend local — que satisfaz o servidor.

## Testes obrigatórios

### Go (`go test -race ./...`)

32 funções de teste, 134 casos, todas passando. Cobrem: framing Text/Binary,
validação de envelope, round-trip e permissões de config, round-trip e
permissões de session key, injeção da session key, guarda de path,
preservação de query/body, strip de headers hop-by-hop, cancel → 499,
upstream inalcançável → 502, bearer correto/errado, cancel de request em voo,
reconexão, e shutdown por contexto.

### Node (`npx vitest run __tests__/scripts/agent-tunnel.test.ts`)

18 testes: validação de path, resolução do token, bearer errado → 401,
resposta casada por id, ping → pong, timeout, frames malformados não derrubam
a sessão, substituição do Tray ativo (close 1008), cancel, e integração com o
ingress (200 pelo túnel, 502 sem Tray, múltiplos prefixos de rota, e rotas
fora do túnel seguindo para o backend local).

## Correções que os testes forçaram

1. **Vazamento da session key no header de resposta** (o achado importante).
   `filterResponseHeaders` filtrava apenas headers hop-by-hop, então uma
   resposta do agent-server que ecoasse `x-session-api-key` devolvia a
   credencial do Tray para a VPS — violação direta do SPEC §4.4, justamente o
   invariante que o Sprint 01 tinha validado do outro lado. Corrigido; o teste
   é o `TestForwardNeverEchoesSessionKey`.
2. **Envelope aceitava base64 inválido.** `Request.Validate()` não decodificava
   o body, então um payload corrompido só era descoberto na hora de encaminhar.
   Agora é rejeitado na fronteira.
3. **Um único prefixo de rota não fecha o bootstrap** (achado do passo 3.2,
   contra o agent-server real). O `--agent-tunnel-route /api` parecia natural,
   mas o agent-server expõe **`/server_info` na raiz** — é o primeiro request
   que o frontend faz, e é o que decide compatibilidade de versão. Com só
   `/api` roteado, o `/server_info` caía no interceptor local do ingress (que
   proxya o backend local, inexistente neste cenário) e o bootstrap morria
   antes de chegar ao Tray. A flag virou **repetível** (`--agent-tunnel-route
   /server_info --agent-tunnel-route /api`), e o roteamento por túnel passou a
   ser avaliado **antes** da interceptação de `/server_info`, para que seja o
   servidor do Tray a responder o bootstrap.

## Descobertas de ambiente

- O `ws` estava apenas como dependência transitiva (via
  `@openhands/typescript-client`); foi promovido a dependência direta e
  `@types/ws` adicionado em dev, porque `ws` não publica tipos.
- `scripts/` **não** é coberto por `npm run lint` (o script é
  `eslint src && prettier --check src/...`), então erros de lint ali não
  quebram o CI. Os arquivos novos foram deixados limpos mesmo assim; sobram em
  `ingress.mjs` apenas 2 erros pré-existentes em linhas que não toquei.
- O MSW do setup global de testes intercepta `fetch` e responde
  `/server_info` com mock, o que mascarava o roteamento do ingress. Os testes
  de integração usam `node:http` em vez de `fetch`.
- `httptest.Server.Close()` bloqueia enquanto um WebSocket hijacked estiver
  aberto; o helper de teste fecha as conexões antes.

## Critérios de aceitação

- [x] `go vet ./...`, `go build ./...` limpos.
- [x] `go test -race ./...` verde (32 funções / 134 casos).
- [x] `gofmt` limpo.
- [x] Session key nunca cruza o fio (verificado nos dois lados).
- [x] Bearer errado é recusado com 401 e não substitui o Tray válido.
- [x] Interop real Go ↔ Node contra mock: 9/9.
- [x] Interop real Go ↔ Node contra **agent-server 1.46.0 real**: 6/6
      (`/server_info` com 21 `usable_tools`; `/api/settings` 401 direto → 200
      pelo túnel). Fecha a lacuna de fidelidade do Sprint 01.
- [x] `npm run typecheck` limpo; `npm run build` ok.
- [x] Testes novos: 18/18; suíte existente do ingress: 22/22 (sem regressão).
- [x] Nada de código Go neste repo (RISCO-01 respeitado).
- [x] Repo criado e enviado: `JoaoNetoDev/openhands-tray` (**privado**), commit
      inicial `135550e`. Nome confirmado pelo usuário; a visibilidade não estava
      especificada em nenhum doc, então foi criado privado (dá para tornar
      público depois).

## Comandos de verificação

```bash
# Core Go
cd /opt/openhands-tray
go build ./... && go vet ./... && gofmt -l .
go test -race ./...          # 32 funções / 134 casos

# Lado VPS (neste repo)
cd /opt/openhands
npm run typecheck
npx vitest run __tests__/scripts/agent-tunnel.test.ts __tests__/scripts/ingress.test.ts
npm run build
```

O harness de interop é efêmero (`/tmp/tray-e2e/`, removido ao fim do sprint):
mock do agent-server + ingress iniciado in-process + binário Go real. As
asserções estão registradas no passo 3 e em `SPRINT-01-DECISIONS.md` §2.

## Não-objetivos deste sprint

- UI (Wails3) e system tray — RISCO-05, espera o CLI-only estar sólido.
- Provisionamento/rotação do bearer na VPS (emissão, listagem, revogação).
- Ed25519 challenge-response e mTLS (v1+/v2).
- Estender o OpenAPI do agent-server — a VPS **não** adiciona endpoints ao
  agent-server; ela fala com o Tray pelo túnel.
- Substituir o Electron (RISCO-02) — faseado, não agora.

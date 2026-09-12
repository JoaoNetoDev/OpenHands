# SPRINT-01 — Spike de validação do protocolo WSS

## Objetivo

Validar **sem código Go** que o envelope WSS proposto no SPEC §2.4
consegue fazer o que precisa fazer: carregar uma request HTTP arbitrária
da VPS, executá-la contra o agent-server local, e devolver a response
sem perder fidelity. Em paralelo, resolver as 4 questões em aberto
(PRD §8) com stakeholders para que o Sprint 02 possa começar com
`go.mod` aberto no repo certo.

Nenhum código de produção é entregue neste sprint. Toda a validação
cabe em uma noite com `websocat`, `socat` e dois scripts Node de 50
linhas cada.

## Depende de

nenhuma — este é o primeiro sprint.

## Onda

0 (spike pré-MVP)

## Arquivos previstos

Nenhum arquivo novo no repo. Scripts efêmeros ficam em
`/tmp/openhands-tray-spike/` e são apagados ao fim do sprint.

## Passos de implementação

### Passo 1 — Provar o envelope síncrono (sem Go)

**Topologia (corrigida após execução):** três processos. O VPS mock **serve**
WSS e dirige os testes; o **Tray mock faz o HTTP** contra o agent-server local
(é ele que tem a session key). O texto original deste passo invertia isso.

```bash
# Terminal A: agent-server (real via uvx, ou mock Node para o spike barato)
node /tmp/openhands-tray-spike/mock-agent-server.mjs   # mock, porta 18900
```

`mock-agent-server.mjs` — HTTP em `127.0.0.1:18900`, exige
`X-Session-API-Key` (401 sem ela), expõe `/server_info`, `/api/echo`
(espelha o body + SHA-256) e `/api/slow` (responde em 500ms, loga abort).

```bash
# Terminal B: VPS mock — WSS 8443 + harness de teste
node /tmp/openhands-tray-spike/vps.mjs
```

`vps.mjs` — `https.createServer` com cert self-signed, `ws.WebSocketServer`
no path `/agent-tunnel`, valida `Authorization: Bearer <token>` (close 1008 se
errado). Dirige os testes T1-T6 e imprime PASS/FAIL.

```bash
# Terminal C: Tray mock — conecta WSS, faz HTTP loopback, responde envelopes
node /tmp/openhands-tray-spike/tray.mjs
```

`tray.mjs` — conecta `wss://127.0.0.1:8443/agent-tunnel` com
`rejectUnauthorized: false`; ao receber envelope, **descarta qualquer
`x-session-api-key` do cliente e injeta a sua**, faz o HTTP pro agent-server,
devolve `{id, status, headers, body_b64}`; suporta `type:"ping"→pong` e
`type:"cancel"→499`. Framing binário quando o body > 64KB.

**Ordem de startup:** agent-server → VPS → Tray. O Tray não pode assumir que o
VPS está de pé (no design real isso é o backoff do CE-01).

**Critério de aceite do passo:**
- A response chega idêntica à que `curl http://127.0.0.1:18900/server_info
  -H "X-Session-API-Key: <key>"` retorna (mesmo status, mesmo body, mesmo
  content-type) — verificado por SHA-256.
- Latência adicional do envelope ≤ 5ms em localhost — medido 7-8ms RTT no
  primeiro request (inclui handshake HTTP), p50=1ms em regime.

### Passo 2 — Provar framing binário para bodies > 64 KB

Modificar `/tmp/spike-tray.mjs` para enviar um tar.gz (do
`canvas_ui_tool.py`, ~6 KB; ou qualquer arquivo maior que 64 KB do
`scripts/`) com `ws.send(buffer, { binary: true })`. Modificar o VPS
mock para detectar Text vs Binary e logar qual recebeu.

**Critério de aceite do passo:**
- Body binário chega intacto (hash SHA-256 antes/depoes coincide).
- VPS mock loga `binary=true` para o frame > 64 KB, `binary=false`
  para o < 64 KB (reflete o que o SPEC §2.4 propõe).

### Passo 3 — Provar o cancelamento de request em vôo

Modificar VPS mock para enviar `{"id":"r1","type":"cancel"}` 50ms
depois de mandar a request. Tray mock responde
`{"id":"r1","status":499,"body_b64":""}` em ≤ 100ms sem completar a
request HTTP pendente (cancela via `req.destroy()`).

**Critério de aceite do passo:**
- Tray loga `request cancelled by peer` em ≤ 100ms.
- Agent-server local registra a request como aborted (visível no log
  JSON do agent-server).

### Passo 4 — Resolver as 4 questões em aberto (PRD §8)

Com os achados dos passos 1-3 em mãos, abrir thread/issue com o
stakeholder respondendo:

| ID | Pergunta | Opções | Recomendação do spike |
|----|----------|--------|------------------------|
| RISCO-01 | Onde fica o código Go? | A. Repo irmão do `software-agent-sdk` (`JoaoNetoDev/openhands-tray`); B. Módulo Go em `software-agent-sdk/tools/` | **A — RESOLVIDO**, ver `SPRINT-01-DECISIONS.md` §1 |
| RISCO-02 | Coexistir ou substituir Electron? | A. Coexistem; B. Substitui; C. Canibaliza (Tray roda o que Electron não roda) | **B — RESOLVIDO (faseado)**: substitui, mas só após paridade; ver `SPRINT-01-DECISIONS.md` §1 |
| RISCO-04 | Qual modelo de auth? | A. Bearer estático (MVP); B. Ed25519 challenge-response; C. mTLS | A no MVP, B no v1 |
| QUESTÃO-01 | Quem hospeda o WSS endpoint na VPS? | A. Hook em `scripts/ingress.mjs` no modo `--frontend-only`; B. Serviço Python separado em `tools/` | A |

As 4 foram respondidas e estão registradas em `SPRINT-01-DECISIONS.md` §1.
O Sprint 02 está desbloqueado, pendente apenas da confirmação do nome do
repo irmão.

## Testes obrigatórios

- Spike funciona end-to-end em `localhost` (sem rede real, sem VPS real,
  sem agent-server remoto) — passos 1, 2, 3.
- Respostas do agente-server via envelope batem com respostas diretas
  byte-a-byte (hash SHA-256) — passo 1.
- 4 questões respondidas por stakeholder (registro escrito em
  `sprints/SPRINT-01-DECISIONS.md` ao final do sprint).

## Critérios de aceitação

Todos cumpridos — ver `SPRINT-01-DECISIONS.md` §2 para a evidência.

- [x] Os 3 scripts efêmeros rodam sem erro em Linux x64 com Node 22+
      (Node v22.23.2, `ws` do `node_modules` do repo).
- [x] Response do envelope tem SHA-256 idêntico ao response direto (T1).
- [x] Framing binário demonstrado com log claro (T2: `binary=true` para 100KB).
- [x] Cancelamento demonstrado (T3: status 499 em 3-5ms; `ABORTED /api/slow`
      no log do agent-server).
- [x] As 4 questões respondidas por escrito (`SPRINT-01-DECISIONS.md` §1).
- [x] Scripts efêmeros removidos (`rm -rf /tmp/openhands-tray-spike`) —
      o harness não é versionado (o sprint previa isso); a topologia e as
      asserções ficaram registradas acima para reconstrução.

**Resultado: 19/19 verificações passaram.** Detalhe em
`SPRINT-01-DECISIONS.md` §2.

## Comandos de verificação

```bash
# Setup efêmero (NÃO criar arquivos no repo)
mkdir -p /tmp/openhands-tray-spike
ln -sfn /opt/openhands/node_modules /tmp/openhands-tray-spike/node_modules
openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/openhands-tray-spike/key.pem \
  -out /tmp/openhands-tray-spike/cert.pem -days 2 -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"

# Após o spike:
rm -rf /tmp/openhands-tray-spike
ls /tmp/openhands-tray-spike  # deve falhar com "No such file or directory"

# Hash check (passo 1)
curl -s http://127.0.0.1:18900/server_info -H "X-Session-API-Key: $KEY" | sha256sum
# comparar com o hash logado pelo harness (T1)
```

## Não-objetivos deste sprint

- Criar `go.mod` ou qualquer arquivo Go — espera decisão do passo 4.
- Implementar reconexão, health check, sidecar spawn — vem no Sprint 02.
- Adicionar hook `/agent-tunnel` ao `scripts/ingress.mjs` — vem no
  Sprint 02.
- Decidir Wails v2 vs Wails3 — RISCO-05 — espera validação após
  Sprint 02 ter o binário rodando em CLI-only.
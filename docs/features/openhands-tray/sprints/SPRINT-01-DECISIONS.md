# SPRINT-01 — Decisões e Resultados

Sprint 01 era o spike de validação de protocolo (sem código Go). Este arquivo
registra as 4 decisões tomadas pelo stakeholder e a evidência produzida pelos
protótipos.

## 1. Decisões

### RISCO-01 — Onde fica o código Go

**Decisão do stakeholder:** "Repo irmão do agente".

**Resolvido:** o Tray vive num repositório novo, irmão de
`JoaoNetoDev/software-agent-sdk`. Nome de trabalho:
**`JoaoNetoDev/openhands-tray`** (confirmar o nome exato antes de criar).

**Consequência:** nada de código Go neste repo. `docs/features/openhands-tray/`
continua sendo o único artefato aqui (planning). QUALQUER trabalho de
implementação (Sprint 02+) acontece no repo irmão.

**Ação pendente antes do Sprint 02:** confirmar o nome do repo e criar a
estrutura (`go.mod`, `internal/`). Ver SPEC §2.1.

### RISCO-02 — Electron: coexistir ou substituir

**Decisão do stakeholder:** "Não sei... Acho que substitui".

**Resolvido (com ressalva):** substituição é o **alvo**, mas **faseada**, não
imediata. Motivo: `electron/main.mjs` (785 linhas) + `electron-builder.config.mjs`
(19 KB) + os hooks de packaging (`stripBundledNodeModules`,
`restoreBundledNodeNpm`, `download-node.mjs`, `download-uv.mjs`,
`brand-dev-electron.mjs`) carregam correções caras já documentadas no
AGENTS.md (PATH bridging, npm stripping, app naming, Node bundling). Deletar
isso antes de o Tray ter paridade joga infra boa fora.

Divergência de UX que a decisão precisa encarar: o Tray **não tem janela
principal**. Hoje o mesmo-máquina abre uma janela nativa (BrowserWindow). Se o
Tray substituir o Electron, o mesmo-máquina passa a ser "abre
`http://localhost:8000` no browser default" — muda a experiência.

**Plano:** Tray cobre primeiro o cross-host (Sprint 02-04). Substituição do
Electron vira um sprint próprio (v1.0+) com checklist de paridade explícito:
janela nativa (ou aceite consciente de browser tab), first-run feedback,
auto-update, instaladores macOS/Windows/Linux, e migração dos usuários atuais.

### RISCO-04 — Modelo de auth

**Decisão do stakeholder:** "Não sei, o que for melhor".

**Resolvido (chamada técnica):** **Bearer token estático no MVP**, com Ed25519
challenge-response desenhado para o v1.

Justificativa:
- Bate com a QUESTÃO-01: o token é provisionado pela UI do instalador na VPS —
  um bearer copiado da UI para o Tray é o caminho de menor atrito.
- É exatamente o que o spike validou: handshake WS com
  `Authorization: Bearer <token>`, rejeição com close code 1008 quando errado
  (ver §2, T6).
- **Não** usa mTLS no MVP: exige PKI e distribuição de certificados, atrito
  desproporcional para single-user.
- Ed25519 no v1 remove o segredo de longa duração do fio (a privada nunca sai
  do Tray; a VPS só guarda a pública). Fica documentado em SPEC §4.3.

**Importante:** a *session API key* local (32 bytes, `X-Session-API-Key`) é
**outro** segredo, e continua no modelo existente — ver §3 abaixo. O bearer é
VPS↔Tray; a session key é Tray↔agent-server local.

### QUESTÃO-01 — Quem hospeda o endpoint WSS na VPS

**Decisão do stakeholder:** "Quem cadastra é o usuário instalador em sua
interface".

**Resolvido:** o endpoint WSS **e** o registro de tokens vivem na UI do Canvas
na VPS. O instalador (quem faz o deploy do Canvas) provisiona o token do Tray
pela própria interface — não é um serviço separado, não é um CLI à parte.

**Consequência técnica:** o hook `/agent-tunnel` entra no
`scripts/ingress.mjs` (SPEC §2.3), mas a **gestão** de tokens (emitir, listar,
revogar) precisa aparecer na UI — provavelmente a partir da tela de backends
("Add backend"), que já é o lugar onde o usuário cadastra destinos. O fluxo:
instalador abre Canvas → adiciona um backend do tipo "Tray remoto" → a UI
gera o token → instalador cola o token no Tray. Revogação na mesma tela.

**Ação pendente:** desenhar a tela de gestão de tokens no frontend
(Sprint 02+, neste repo — é UI, então é escopo legítimo do agent-canvas).

## 2. Resultado do spike

Ambiente: Linux x64, Node v22.23.2, `ws` do `node_modules` do repo, TLS
self-signed (openssl 3.0.13). Topologia: VPS mock (WSS 8443) → Tray mock
(bridge) → agent-server mock (HTTP 127.0.0.1:18900, exige
`X-Session-API-Key`).

**19/19 verificações passaram.**

| Teste | Verificação | Resultado |
|-------|-------------|-----------|
| T1 | status direct vs bridge | PASS (200 vs 200) |
| T1 | body SHA-256 idêntico ao direto | PASS |
| T1 | content-type preservado | PASS |
| T1 | framing texto para body pequeno | PASS |
| T1 | session key **não** vaza pro VPS | PASS |
| T1 | latência RTT | 7-8ms |
| T1b | chamada direta sem session key → 401 | PASS (prova que a key é load-bearing e o Tray injeta) |
| T2 | request >64KB usa framing binário | PASS |
| T2 | response 100KB íntegra (SHA-256 + length) | PASS |
| T3 | cancel → status 499 | PASS |
| T3 | cancel honrado em <200ms (3-5ms) | PASS |
| T3 | abort chegou ao agent-server (log `ABORTED /api/slow`) | PASS |
| T4 | ping → pong em <1s (1ms) | PASS |
| T6 | Bearer errado rejeitado com close code 1008 | PASS |
| T5 | latência p50 ≤ 50ms | PASS (p50=1ms) |
| T5 | latência p99 ≤ 200ms | PASS (p99=3ms) |

**Limitação do spike:** o agent-server era um mock Node, não o `uvx
openhands-agent-server` real. As propriedades validadas (envelope,
base64/binário, cancelamento, injeção de key, auth) são independentes do
runtime do agent-server; a fidelidade do `/server_info` real fica para o
Sprint 02 (que roda o agent-server verdadeiro). Isso mantém o spike barato e
determinístico — objetivo declarado do SPRINT-01.

## 3. Refinamentos de design que o spike destravou

Estes pontos não estavam claros no design original e agora estão fechados:

1. **O Tray injeta a session key local, e descarta a que vier do cliente.**
   O frontend na VPS não tem (e não deve ter) a session key do agent-server
   local. O Tray remove qualquer `x-session-api-key` do envelope recebido e
   põe a dele. Verificado no T1 (a key não aparece na resposta) e no T1b
   (direto sem key = 401). → SPEC §4.4 (novo), TECH §6.2.

2. **O VPS não precisa de um "upstreamPort" local.** O handler `/agent-tunnel`
   no `ingress.mjs` é um servidor WS terminal (valida bearer, troca envelopes
   com o Tray), **não** um passthrough genérico como o handler de `upgrade`
   atual (que só faz `proxy.proxyWebSocket`). TECH §4.3 tinha sinalizado essa
   dúvida — confirmada: precisa de handler dedicado.

3. **Cancelamento funciona por destruição do socket** do request HTTP em voo,
   com resposta `499` ao VPS. Latência observada 3-5ms. O mock agent-server
   registrou o abort. → SPEC §2.4/§5 CE.

4. **Framing binário no limiar de 64KB** é suficiente para bodies grandes.
   100KB ida e volta sem perda, com SHA-256 idêntico ao controle direto.
   → SPEC §2.4.

5. **A ordem de startup importa** (achado operacional): o VPS endpoint precisa
   estar escutando antes do Tray conectar. No design real isso é o backoff do
   Tray (§5 CE-01) resolvendo — o spike só confirmou que o Tray não pode
   assumir que o VPS está de pé.

6. **Correção do Passo 1 do SPRINT-01.md:** o texto original dizia que o VPS
   mock fazia o HTTP pro agent-server. Errado — quem faz o HTTP é o **Tray**.
   Corrigido no arquivo do sprint.

## 4. Impacto nos documentos

| Documento | Mudança |
|-----------|---------|
| PRD §8 | RISCO-01/02/04 e QUESTÃO-01 marcados como resolvidos |
| SPEC §2.3 | `/agent-tunnel` é handler WS dedicado, não passthrough |
| SPEC §2.5 | reforço: session key é injetada pelo Tray, nunca trafega pela bridge |
| SPEC §4 | novo §4.4 com a regra de injeção/descarte da session key |
| TECH §4.3 | dúvida resolvida (handler dedicado) |
| TECH §6.2 | ameaça "VPS lê session key" confirmada como mitigada |
| SPRINT-01.md | Passo 1 corrigido (topologia) + resultados registrados |

## 5. Escopo do Sprint 02 (desbloqueado)

Com as 4 decisões fechadas e o protocolo validado, o Sprint 02 pode:

- Criar a estrutura inicial do repo irmão `JoaoNetoDev/openhands-tray`
  (`go.mod`, `internal/`, layout do SPEC §2.1).
- Implementar `internal/tunnel` (WS client + backoff) e `internal/proxy`
  (envelope ⇄ HTTP) em Go, espelhando o Tray mock do spike.
- Implementar `internal/agent` reusando `dev-with-automation.mjs
  --backend-only`.
- Adicionar o hook `/agent-tunnel` ao `scripts/ingress.mjs` (neste repo) —
  handler WS dedicado + validação de Bearer.
- Rodar o agent-server **real** (`uvx`) e comparar `/server_info` com o
  controle direto (a fidelidade que o spike deixou em aberto).

Bloqueio restante antes de abrir o Sprint 02: confirmar o nome do repo irmão.

# Achados — OpenHands Tray + Canvas

**Data:** 2026-09-14
**Escopo:** binário Linux do Tray, evidências de teste, e estado do repo Canvas
**Como ler:** cada seção começa com o resultado. Detalhe vem depois.

---

## Resumo em 4 linhas

| # | Achado | Gravidade | Status |
|---|---|---|---|
| 1 | Binário Linux compilado e testado | ✅ entregue | pronto |
| 2 | Chave de sessão em texto puro num arquivo solto | 🟡 médio | arquivo ainda no disco; chave obsoleta |
| 3 | Lint falha em 14 erros (código novo de agent-profiles) | 🟡 médio | aberto |
| 4 | 92 testes falhando | 🟢 baixo | pré-existente, não é regressão |

---

## 1. Entregável — binário Linux

### Onde está

```
/opt/openhands-tray/dist/openhands-tray-linux-amd64
```

| Propriedade | Valor |
|---|---|
| Tamanho | **5,3 MB** |
| Tipo | ELF 64-bit x86-64 |
| Ligação | **estático** (`not a dynamic executable`) |
| Versão | `b795736` |
| Commit do repo | `b795736` |

**Estático significa:** roda em qualquer Linux (glibc ou musl/Alpine) sem instalar nada.

### Matriz completa (todos em `dist/`)

| Plataforma | Arquivo |
|---|---|
| Linux x64 | `openhands-tray-linux-amd64` |
| Linux ARM64 | `openhands-tray-linux-arm64` |
| macOS Intel | `openhands-tray-darwin-amd64` |
| macOS Apple Silicon | `openhands-tray-darwin-arm64` |
| Windows x64 | `openhands-tray-windows-amd64.exe` |

`checksums.txt` acompanha os 5.

### O que adicionei ao repo Go

- `Makefile` — alvos `build`, `test`, `race`, `vet`, `fmt`, `fmt-check`, `release`, `clean`
- `--version` no binário, com versão injetada em tempo de compilação (`-ldflags -X main.version`)

**Reproduzir:**

```bash
cd /opt/openhands-tray
make build     # só o host  -> dist/openhands-tray
make release   # 5 plataformas + checksums
```

---

## 2. Evidências — o binário realmente funciona

Não foi só compilação. Rodei o **binário compilado** contra a VPS e contra o agent-server real.

| Teste | Resultado |
|---|---|
| `/server_info` pela VPS, servido pelo túnel | ✅ 200 |
| `/api/settings` sem chave do cliente | ✅ 200 (o Tray injetou a chave) |
| Cliente manda chave **falsa** | ✅ descartada; servidor viu a chave do Tray |
| Chave aparece nos headers de resposta? | ✅ não |
| Chave aparece no **log** do Tray? | ✅ não |
| Ciclo de vida do túnel | ✅ `connected` → `stopped` limpo |

Contra o agent-server **real** (1.46.0, `:18000`), não só mock:

```
/server_info  -> 200  (version 1.46.0)
/api/settings -> 200  pelo túnel, 401 direto sem chave
```

### Como reproduzir o teste

```bash
# 1. ingress com túnel habilitado (precisa dos DOIS prefixos)
node scripts/ingress.mjs --port 18500 \
  --agent-tunnel-token SEU_TOKEN \
  --agent-tunnel-route /server_info \
  --agent-tunnel-route /api \
  --default http://127.0.0.1:3001

# 2. tray apontando para ele
./dist/openhands-tray-linux-amd64 \
  --vps ws://127.0.0.1:18500/agent-tunnel \
  --token SEU_TOKEN \
  --port 18000 --no-sidecar

# 3. testar
curl http://127.0.0.1:18500/api/settings   # 200 = túnel OK
```

`--agent-tunnel-route` **precisa ser repetido**: o agent-server serve `/server_info` na raiz e o resto em `/api`. Só `/api` quebra o bootstrap.

---

## 3. 🔴 Achados de segurança

### 3.1 Chave de sessão em texto puro num arquivo solto

**Arquivo:** `.tmp-session-init.mjs` (raiz do repo Canvas)

Contém uma chave de sessão de 64 caracteres atribuída direto no código:

```js
window.__AGENT_CANVAS_SESSION_API_KEY__ = "<64 caracteres>";
```

| Pergunta | Resposta |
|---|---|
| Está commitada? | **Não** — só no disco, fora do histórico |
| Está no `.gitignore`? | **Não** — um `git add -A` commitiria |
| A chave ainda vale? | **Não** — está obsoleta (o agent-server ativo usa outra de 44 chars) |

**Por que ainda importa:** está a um `git add -A` de entrar no histórico. Chave no histórico do git é difícil de remover (exige reescrever commits). Mesmo obsoleta, é lixo de credencial que não deveria estar no repo.

**Ação recomendada:** apagar os 5 arquivos `.tmp-*.mjs` e adicionar `.tmp-*` ao `.gitignore`.

### 3.2 O mesmo padrão em outro arquivo

`.tmp-mkinit.mjs` lê `/root/.openhands/agent-canvas/api-key.txt` e escreve o conteúdo em outro lugar. Mesma família de risco: credencial manipulada por script solto e não rastreado.

### 3.3 Os arquivos `.tmp-*.mjs` (5 no total)

| Arquivo | O que é |
|---|---|
| `.tmp-session-init.mjs` | **contém a chave** |
| `.tmp-mkinit.mjs` | lê `api-key.txt` |
| `.tmp-seed-session.mjs` | escreve init script do Playwright |
| `.tmp-trace.mjs` | script de trace do Playwright |
| `.tmp-post-fix.mjs` | mede posição de header (fix do navbar mobile) |

São restos de sessões anteriores — não são meus e não são do Sprint 02.

---

## 4. Estado de qualidade do repo Canvas

### 4.1 Lint — 15 problemas (14 erros, 1 aviso) em 3 arquivos

| Arquivo | Erros |
|---|---|
| `src/components/features/settings/agent-profiles/import-from-central-modal.tsx` | 13 |
| `src/components/features/settings/agent-profiles/agent-profiles-manager.tsx` | 1 |
| `src/hooks/query/use-local-git-info.ts` | 1 aviso (directive `eslint-disable` sem uso) |

**Causa:** strings em português escritas direto no JSX (`"Importando…"`, `"Importar do central"`) — a regra `i18next/no-literal-string` bloqueia. Precisa passar por `t()` e `I18nKey`.

**Nada disso é do Sprint 02.** São do trabalho de agent-profiles.

### 4.2 Testes — 19 arquivos / 92 testes falhando

Números exatos da execução completa:

```
Test Files  19 failed | 648 passed (667)
Tests       92 failed | 5668 passed | 4 skipped | 7 todo (5771)
```

**Concentração:** `chat-interface.test.tsx`, `message-display-continuity.test.tsx`, `conversation-events/**`, `automations/**`. Tudo teste de componente React.

**É regressão minha?** Não. Duas evidências:
1. Já verificado antes revertendo as mudanças — falha idêntica.
2. Nenhum desses testes importa arquivo que eu mexi (meu trabalho é `scripts/`, eles testam componentes).

**Meus testes:** 40/40 passando (`agent-tunnel` + `ingress`).

### 4.3 O que está verde

| Verificação | Status |
|---|---|
| `npm run build` | ✅ passa |
| `npm run typecheck` | ✅ passa |
| Traduções (`check-translation-completeness`) | ✅ passa |
| Go: `gofmt` / `vet` / `build` / `test` | ✅ limpo |
| Testes do túnel | ✅ 40/40 |

**Correção de uma informação anterior minha:** eu disse que o hook de commit estava quebrado por 16 traduções faltando. **Isso era temporário.** Naquele momento o `translation.json` estava no meio de uma edição (trabalho de vision/ACP inacabado). Agora está completo e o hook passa. Não é um problema aberto.

---

## 5. Controle de versão

### 5.1 Repo Canvas (`/opt/openhands`)

**Branch:** `sprint/openhands-tray-02` — **13 commits à frente** de `da816c3`

O branch deixou de ser "do tray" e virou um agregado de vários sprints. Ordem (mais antigo → mais novo):

| Commit | O que é |
|---|---|
| `208554a` | **meu** — túnel `/agent-tunnel` no ingress |
| `1937494` | host evoluttiai na lista do agent-server |
| `9160329` | **meu** — docs do Sprint 02 |
| `5d9f301` | ACP: model/effort padrão do contexto do provider |
| `5f8aa00` | docs: planejamento do menu Sistema + Kanban |
| `bda050d`–`3e8618c` | sprint sistema-settings (3 commits) |
| `e12f1b0`–`69d095a` | sprint kanban 3 níveis (4 commits) |
| `c2a336c` | docs: ficha + spec do effort ACP claude-code |

**Meus 2 commits continuam no histórico** (verificado com `git merge-base --is-ancestor`). Os arquivos `scripts/agent-tunnel.mjs` e o teste estão rastreados e íntegros.

**Nada foi enviado ao GitHub** — o branch existe só localmente.

### 5.2 Repo do Tray (`/opt/openhands-tray`)

| Item | Estado |
|---|---|
| Branch | `main` |
| Commits | `135550e` (core) + `b795736` (Makefile) |
| Sincronia | ✅ local == `origin/main` |
| Remote | `JoaoNetoDev/openhands-tray` (**privado**) |
| Tags | **nenhuma** |

**Falta:** criar uma tag de release (`v0.1.0`). Sem tag não existe release/versão publicada, e o binário se identifica por hash de commit.

### 5.3 Não rastreado no Canvas (14 itens)

- 5 arquivos `.tmp-*.mjs` (seção 3)
- `react-router.config.test.ts`
- `.openhands/memory/` (memória do agente — meu)
- Docs não rastreados: `docs/bugs/deploy-tela-branca-assets-404/`, `docs/features/claude-code-acp-reasoning-effort/`, `docs/features/deploy-agent-server-remotos/`

---

## 6. Detalhes de ambiente que descobri

Coisas que não são óbvias e custam tempo para redescobrir.

| Detalhe | Por que importa |
|---|---|
| `npm run lint` **não** cobre `scripts/` | Erros na pasta `scripts/` passam sem falhar CI. Rodar `npx eslint scripts/<arq>` na mão. |
| Log do Tray fica em `~/.local/state/openhands-tray/log/tray.log` | Não é na raiz do repo nem ao lado do binário. |
| Tray busca a chave em `~/.openhands/agent-canvas/session-api-key.txt` | **Esse arquivo não existe nesta máquina.** É criado na 1ª execução. |
| Agent-server real: `:18000` | `/server_info` responde **sem autenticação**; `/api/*` responde **401** sem chave. |
| A chave do agent-server está **só no env** (`OH_SESSION_API_KEYS_0`) | Não tem em disco. Extrair de `/proc/<pid>/environ`. |
| MSW intercepta `fetch` nos testes | Teste que precise observar roteamento HTTP real tem que usar `node:http`, senão passa por engano. |
| `ws` não traz tipos | Precisa de `@types/ws` como devDependency. |
| `httptest.Server.Close()` trava com WebSocket aberto | Fechar as conexões antes do servidor, nos testes Go. |
| `ingress.mjs` exporta `startIngress(config)` | Aceita `port: 0` para porta efêmera. Sem backend local, rota não-túnel responde **503**. |

---

## 7. Pendências, por prioridade

### 🔴 Fazer agora

1. **Apagar os 5 `.tmp-*.mjs`** e pôr `.tmp-*` no `.gitignore` (seção 3.1)
2. **Corrigir os 14 erros de lint** de agent-profiles (seção 4.1)

### 🟡 Fazer em seguida

3. **Criar tag `v0.1.0`** no repo do Tray — sem tag não há release
4. **Decidir o destino do branch** `sprint/openhands-tray-02`: ele mistura 5 sprints. Ou vira vários PRs, ou um PR só. Não dá para revisar assim.
5. **Enviar o túnel ao GitHub** — está só local

### 🟢 Quando der

6. Investigar os 92 testes falhando (pré-existentes, mas são 92)
7. Limpar os docs não rastreados (seção 5.3)

---

## 8. Contexto histórico — por que existe só um prefixo de rota

Registro para quem for mexer depois. O bug foi encontrado **só** contra o agent-server real:

- O mock servia tudo sob `/api`, então `--agent-tunnel-route /api` passava 9/9
- O agent-server real serve `/server_info` na **raiz** — é o primeiro request do frontend e decide compatibilidade de versão
- Com só `/api` roteado, `/server_info` caía no interceptor local do ingress e o bootstrap morria
- Correção: flag virou repetível **e** o roteamento por túnel passou a ser avaliado antes da interceptação local de `/server_info`

**Lição:** mock que não reproduz a topologia real dá falso verde.

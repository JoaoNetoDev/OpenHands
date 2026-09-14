# SPEC — Correção: reasoning effort do provider ACP `claude-code`

Deriva de [`FICHA.md`](./FICHA.md) (aprovada). Escopo: fazer o effort do provider
`claude-code` funcionar de fato no Canvas de `/opt/openhands`.

## 1. Escopo

**Dentro:**
- Completar o split `<model>/<effort>` no SDK para **todos** os caminhos que levam
  `acp_model` ao wrapper ACP. Hoje o commit `21cfc40` cobre só um deles.
- Testes de regressão que impeçam a recorrência por qualquer um dos caminhos.
- Publicação/deploy para que o `agent-server` de `/opt/openhands` consuma a correção.

**Fora:**
- A UI de effort do Canvas (`use-chat-input-model-state.ts`, `chat-input-model.tsx`,
  `src/constants/acp-providers.ts`) — verificada correta, não muda.
- Defensividade no wrapper `claude-agent-acp` (é pacote de terceiros, pinado pelo SDK).
- Propagar `data.details` do CLI no handler HTTP do agent-server — melhoria de
  observabilidade desejável, mas **separada**; registrar como follow-up.

## 2. Diagnóstico do que falta (por que `21cfc40` é insuficiente)

O `acp_model` cru escapa do SDK por **dois** caminhos, e o provider `claude-code` é o
único que usa os dois:

| Caminho | Função | `codex` | `claude-code` |
|---|---|---|---|
| Troca em runtime | `_model_config_options` (`acp_agent.py:568-575`) | correto (`21cfc40`) | **corrigido** por `21cfc40` |
| Criação de sessão (`_meta`) | `build_session_model_meta` (`acp_providers.py:777-792`) | irrelevante — `session_meta_key=None` (`:554`) devolve `{}` | **NÃO corrigido** — `session_meta_key="claudeCode"` (`:526`) |

Verificado executando o código instalado:

```
_model_config_options("claude-agent-acp", "sonnet/medium")    -> (('model', 'sonnet/medium'),)     # 1.46.0
build_session_model_meta("claude-agent-acp", "sonnet/medium") -> {'claudeCode': {'options': {'model': 'sonnet/medium'}}}
# codex, contraste:
build_session_model_meta("codex-acp", "gpt-5.5/high")         -> {}   # session_meta_key=None
```

Como o `codex` devolve `{}`, corrigir só `_model_config_options` bastou para ele — foi o
que fez o furo passar despercebido no `claude-code`. Há ainda evidência de que o `_meta`
**é** honrado: o wrapper 0.63.0 espalha `_meta.claudeCode.options` no `options` do
`query()` (`dist/acp-agent.js:4092,4147`), e o processo do CLI estava rodando com
`--model sonnet/medium`, o que explica a option fantasma que transformou a degradação
silenciosa em falha dura.

**Conclusão de projeto**: o effort é um *config option*, nunca parte do model id.
Nenhum caminho pode mandar o id combinado como modelo.

## 3. Mudanças arquivo a arquivo

**Repo:** `JoaoNetoDev/software-agent-sdk` (checkout `/tmp/sdk`, branch
`feat/claude-code-reasoning-effort`, base `21cfc40`).

### 3.1 `openhands-sdk/openhands/sdk/agent/acp_agent.py` — alterar

Adicionar, logo após `_model_config_options`, um helper que expõe o modelo "puro" para o
`_meta`, reaproveitando a **mesma** regra de split (fonte única de verdade, sem duplicar
as allowlists):

```python
def _model_id_for_session_meta(agent_name: str | None, model: str) -> str:
    """Model id to put in the ACP session ``_meta``.

    Effort is a *config option*, never part of the model id: the ACP server
    forwards a ``_meta`` model value verbatim to the CLI's model selection, so a
    combined ``<model>/<effort>`` id there is rejected — or, worse, registered by
    the CLI as a bogus "custom model" that later wins an exact match and turns a
    silent effort downgrade into a hard failure. Reuse ``_model_config_options``
    (its first pair is always the plain model id) so both the ``_meta`` and the
    runtime-switch paths share one split rule.
    """
    return _model_config_options(agent_name, model)[0][1]
```

E corrigir o call site (`acp_agent.py:3238`):

```python
# antes
session_meta = build_session_model_meta(agent_name, self.acp_model)

# depois
meta_model = (
    _model_id_for_session_meta(agent_name, self.acp_model)
    if self.acp_model
    else self.acp_model
)
session_meta = build_session_model_meta(agent_name, meta_model)
```

O guarda `if self.acp_model` preserva o comportamento atual para `None`/`""`
(`build_session_model_meta` já devolve `{}` nesses casos).

**Não mudar** `build_session_model_meta` (`acp_providers.py:777-792`): ela vive na camada
de settings e não deve importar da camada de agente (a dependência é a inversa). A regra
de split pertence ao agente — o conserto fica no call site.

### 3.2 `tests/sdk/agent/test_acp_agent.py` — alterar

Adicionar `TestModelIdForSessionMeta`, ao lado de `TestClaudeModelConfigOptions`
(que fica em `:5403`):

- `claude-agent-acp` + `sonnet/medium` → `sonnet`
- `claude-agent-acp` + `sonnet` → `sonnet` (inalterado)
- `claude-agent-acp` + `sonnet/ultrafast` → `sonnet/ultrafast` (sufixo não reconhecido)
- `codex-acp` + `gpt-5.5/high` → `gpt-5.5`
- `gemini-cli` + `gemini-2.0-flash` → inalterado

Adicionar o **teste de invariante** (é o que fecha o buraco de verdade — nenhum caminho
pode vazar o id combinado):

- para `claude-code` com um id combinado, **nem** o valor do `_meta` **nem** qualquer par
  de `_model_config_options` contém `/` no campo de modelo;
- e o `_meta` composto bate exatamente:
  `build_session_model_meta("claude-agent-acp", _model_id_for_session_meta("claude-agent-acp", "sonnet/medium")) == {"claudeCode": {"options": {"model": "sonnet"}}}`.

### 3.3 `tests/sdk/settings/test_acp_providers.py` — não alterar

Os testes existentes de `build_session_model_meta` (`:464-484`) continuam válidos: a
função não muda de contrato. Servem de guarda contra a tentação de corrigir ali.

## 4. Publicação e deploy

**Rota decidida**: `OH_AGENT_SERVER_LOCAL_PATH` (checkout local com a correção) — e não
`OH_AGENT_SERVER_GIT_REF`, que era a primeira escolha.

**Por que não o git ref**: `scripts/dev-safe.mjs:48` tem o repositório **hardcoded** para
upstream — `AGENT_SERVER_GIT_REPO = "https://github.com/OpenHands/software-agent-sdk"` — e
`buildAgentServerCommand` monta `git+${AGENT_SERVER_GIT_REPO}@${gitRef}` (`:473`), sem
override por env. O knob `OH_AGENT_SERVER_GIT_REF` portanto só alcança o repo upstream: não
dá para apontá-lo para o fork `JoaoNetoDev/software-agent-sdk`.

**Por que não um release**: os pins do SDK vêm de `config/defaults.json`
(`versions.agentServer = "1.46.0"`) e `/etc/default/openhands` não define
`OH_AGENT_SERVER_VERSION`. Publicar um `1.47.1` no fork **não** resolveria — o `uvx` busca na
PyPI oficial. Só um release oficial resolveria, e não temos controle sobre o timing dele.

`OH_AGENT_SERVER_LOCAL_PATH` tem a **maior precedência** em `buildAgentServerCommand` e usa
`--with-editable`, ou seja, aponta direto para o código com a correção.

Passos executados:

1. Correção aplicada e testada no checkout `/tmp/sdk`; commit `690243e`.
2. Checkout estável instalado em `/opt/software-agent-sdk-fix` (HEAD `690243e`).
3. Custo de boot verificado: **~5 s** com cache do `uv` quente (o `--reinstall` do knob não
   impõe penalidade relevante).
4. `OH_AGENT_SERVER_LOCAL_PATH=/opt/software-agent-sdk-fix` adicionado a
   `/etc/default/openhands` (backup em `/etc/default/openhands.bak-20260914062125`).
5. Resolução validada pela lógica do próprio launcher — `buildAgentServerCommand` devolve
   `SOURCE: local (/opt/software-agent-sdk-fix)` e os 4 pacotes como `--with-editable`.
6. **Restart pendente — de propósito, para o usuário executar.** Ver §4.1.
7. Follow-up: abrir PR upstream com a correção completa; quando um release oficial a
   contiver, remover a linha de `/etc/default/openhands` e reiniciar.

### 4.1 Por que o restart ficou para o usuário

O `agent-server` que hospeda a **própria sessão de diagnóstico** é filho do
`openhands.service` (PID `1038310`, cujo pai é o `agent-canvas.mjs` sob a unit). O
`ExecStartPre` da unit faz `fuser -k 18000/tcp 18001/tcp 3001/tcp`, e o `KillMode=control-group`
derruba a árvore — um `systemctl restart openhands.service` executado de dentro mataria o
agente no meio da tarefa.

Comando (a executar de fora desta sessão):

```bash
systemctl restart openhands.service
```

Reverter o deploy (se necessário):
`cp /etc/default/openhands.bak-20260914062125 /etc/default/openhands && systemctl restart openhands.service`

## 5. Critérios de aceitação

- [x] CA-01: `_model_id_for_session_meta("claude-agent-acp", "sonnet/medium")` → `"sonnet"`.
- [x] CA-02: `_model_id_for_session_meta("claude-agent-acp", "sonnet/ultrafast")` → `"sonnet/ultrafast"`.
- [x] CA-03: `_model_id_for_session_meta("codex-acp", "gpt-5.5/high")` → `"gpt-5.5"`.
- [x] CA-04: `build_session_model_meta("claude-agent-acp", _model_id_for_session_meta("claude-agent-acp", "sonnet/medium"))` → `{"claudeCode": {"options": {"model": "sonnet"}}}`.
- [x] CA-05: nenhum caminho que leva `acp_model` ao wrapper emite `"sonnet/medium"` como modelo (teste de invariante).
- [x] CA-06: os 6 testes de `TestClaudeModelConfigOptions` e os 4 testes Codex existentes continuam passando sem alteração.
- [x] CA-07: suíte de `tests/sdk/agent/test_acp_agent.py` e `tests/sdk/settings/test_acp_providers.py` verde; `ruff check` limpo.
- [ ] CA-08 (pendente de restart): com o SDK corrigido, `POST /api/conversations/<cid>/switch_acp_model {"model":"sonnet/medium"}` responde **200** (não 500) e o CLI recebe `set_model "sonnet"` + `effort "medium"` separados.
- [ ] CA-09 (pendente de restart): numa conversa nova do perfil `claude-code`, o servidor ACP é iniciado **sem** `--model sonnet/medium` (nenhuma option "Custom model" fantasma aparece na lista de models da sessão).

## 6. Notas de risco

- `/opt/software-agent-sdk-fix` passa a ser **caminho crítico de boot**: se for removido ou
  corrompido, o `agent-server` não sobe (`OH_AGENT_SERVER_LOCAL_PATH` tem a maior precedência
  e o launcher não valida a existência do path antes de montar o comando). Mitigação: o
  diretório tem `.git` com o history e é reconstruível (copiar o checkout e checar `690243e`);
  a dívida é remover a linha assim que houver release oficial.
- O `--reinstall` do knob refaz a resolução do ambiente a cada boot. Medido em ~5 s com cache
  quente; num host sem cache do `uv` o primeiro boot é mais lento e depende de rede.
- `_model_id_for_session_meta` reaproveita `_model_config_options`; qualquer provider que
  passe a ter split ganha o `_meta` correto de graça — que é o comportamento desejado, mas
  torna o par de funções acoplado por contrato. O teste de invariante (CA-05) é o que
  protege esse contrato.

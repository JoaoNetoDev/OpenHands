# SPEC — Reasoning effort para o provider ACP `claude-code`

## 1. Resumo e escopo

Adicionar, no `software-agent-sdk` (fork `JoaoNetoDev/software-agent-sdk`,
branch `feat/claude-code-reasoning-effort`), o split de
`acp_model = "<model>/<effort>"` para o provider `claude-code`, análogo ao
que já existe para `codex`, usando o config id nativo do
`claude-agent-acp` (`"effort"`). Um único arquivo de produção muda:
`openhands-sdk/openhands/sdk/agent/acp_agent.py`. Testes em
`tests/sdk/agent/test_acp_agent.py`.

## 2. Desenho detalhado por componente

### 2.1 `openhands-sdk/openhands/sdk/agent/acp_agent.py`

Localização de referência: as constantes/funções do Codex vivem
imediatamente antes de `_model_config_option()` (função que já existe hoje,
citada no TECH). As novas definições são inseridas no mesmo bloco, depois de
`_codex_model_config_options`:

```python
_CLAUDE_EFFORT_CONFIG_OPTION_ID: Final[str] = "effort"
_CLAUDE_REASONING_EFFORTS: Final[frozenset[str]] = frozenset(
    {"low", "medium", "high", "max"}
)


def _claude_model_config_options(model: str) -> tuple[tuple[str, str], ...]:
    """Map a combined Canvas Claude model id to claude-agent-acp config
    options. Mirrors _codex_model_config_options, but claude-agent-acp
    exposes reasoning effort under its own config id (``effort``, not
    ``reasoning_effort``) — see acp-agent.js EFFORT_CONFIG_ID."""
    base_model, sep, effort = model.rpartition("/")
    if sep and base_model and effort in _CLAUDE_REASONING_EFFORTS:
        return (
            (_MODEL_CONFIG_OPTION_ID, base_model),
            (_CLAUDE_EFFORT_CONFIG_OPTION_ID, effort),
        )
    return ((_MODEL_CONFIG_OPTION_ID, model),)
```

E a função de dispatch existente é alterada de:

```python
def _model_config_options(
    agent_name: str | None,
    model: str,
) -> tuple[tuple[str, str], ...]:
    provider = detect_acp_provider_by_agent_name(agent_name or "")
    if provider is not None and provider.key == "codex":
        return _codex_model_config_options(model)
    return ((_MODEL_CONFIG_OPTION_ID, model),)
```

para:

```python
def _model_config_options(
    agent_name: str | None,
    model: str,
) -> tuple[tuple[str, str], ...]:
    provider = detect_acp_provider_by_agent_name(agent_name or "")
    if provider is not None and provider.key == "codex":
        return _codex_model_config_options(model)
    if provider is not None and provider.key == "claude-code":
        return _claude_model_config_options(model)
    return ((_MODEL_CONFIG_OPTION_ID, model),)
```

Nenhuma outra função do arquivo muda. `_apply_acp_model`,
`_maybe_set_session_model` e `_reapply_session_model_on_resume` (usadas pelos
testes existentes citados no TECH) chamam `_model_config_options` internamente
e portanto herdam o novo comportamento sem alteração de assinatura.

## 3. Fluxo principal passo a passo e fluxos de erro

**Fluxo principal (sessão nova, effort reconhecido):**
1. Usuário/Settings define `acp_model = "sonnet/high"` no perfil ACP
   `claude-code`.
2. Na criação da sessão, `_apply_acp_model(..., model="sonnet/high",
   via_config_option=True)` chama `_model_config_options("claude-agent-acp",
   "sonnet/high")`.
3. `detect_acp_provider_by_agent_name` resolve `provider.key ==
   "claude-code"` → `_claude_model_config_options("sonnet/high")`.
4. `rpartition("/")` → `base_model="sonnet"`, `effort="high"`; `"high"` está
   em `_CLAUDE_REASONING_EFFORTS` → retorna
   `(("model", "sonnet"), ("effort", "high"))`.
5. Dois `set_config_option` são enviados em sequência: `model=sonnet`, depois
   `effort=high`.
6. O `claude-agent-acp` aplica ambos (o `effort` só é aceito se o modelo
   corrente — já setado no passo anterior — suportar effort;
   caso contrário rejeita/ignora, ver fluxo de erro abaixo).

**Fluxo: sufixo não reconhecido ou ausente**
- `"sonnet"` (sem `/`) → `_claude_model_config_options` retorna
  `(("model", "sonnet"),)` — comportamento idêntico ao atual, coberto pelo
  teste já existente `test_switches_claude_via_config_option_single_call`.
- `"sonnet/ultrafast"` (sufixo fora do allowlist) → `sep` é truthy mas
  `"ultrafast" not in _CLAUDE_REASONING_EFFORTS` → cai no `return` final,
  ou seja, `(("model", "sonnet/ultrafast"),)` — o modelo inteiro (com a
  barra) é enviado como id de modelo. Isso reproduz o comportamento atual
  (pré-mudança) exatamente, então não é uma regressão nova: hoje qualquer
  string em `acp_model` já vai inteira para `("model", model)`.

**Fluxo de erro: servidor rejeita o config id `effort`**
- Se o modelo atual não suportar effort, o `claude-agent-acp` não inclui
  `effort` em `configOptions` (`buildConfigOptions`, seção 1 do TECH) e
  `set_config_option(configId="effort", …)` responde com o erro "Unknown
  config option" (`dist/acp-agent.js:3190-3192`). Esse erro já se propaga
  pelo caminho genérico de tratamento de erro de `set_config_option`
  existente no restante de `acp_agent.py` (mesmo caminho usado hoje quando o
  Codex tenta um `reasoning_effort` que o modelo atual não aceita) — nenhum
  tratamento novo é necessário nesta mudança.

## 4. Casos de borda

- **Concorrência**: nenhuma — a chamada é sequencial e síncrona dentro de
  `_apply_acp_model`, igual ao caso Codex.
- **Dados legados**: uma sessão persistida antes desta mudança com
  `acp_model = "sonnet/high"" salva por engano (hoje enviado inteiro como
  id de modelo, provavelmente rejeitado/ignorado pelo servidor) passa a se
  comportar corretamente após o deploy — é uma correção de comportamento,
  não uma migração de dado.
- **Limites**: `base_model` vazio (`"/high"`) → `sep and base_model` é falso
  (`base_model == ""`) → não splita, replica a mesma proteção que o Codex já
  tem para esse caso.
- **Entradas inválidas**: `model=""` → `rpartition("/")` retorna
  `("", "", "")` → `sep` falso → retorna `(("model", ""),)`, mesmo
  comportamento de hoje (sem mudança).
- **Colisão com ids que contêm `/` sem ser effort** (ex.: um futuro
  `acp_model` custom tipo `"custom/provider/model"`): `rpartition("/")` pega
  só o último segmento; se esse segmento não estiver no allowlist de effort,
  não splita — mesma proteção já validada pelo teste Codex
  `test_leaves_base_or_custom_model_id_unchanged` (`"custom/provider/model"`
  permanece intacto).

## 5. Mudanças arquivo a arquivo

| Arquivo | Ação | O que muda |
|---|---|---|
| `openhands-sdk/openhands/sdk/agent/acp_agent.py` | alterar | Adiciona `_CLAUDE_EFFORT_CONFIG_OPTION_ID`, `_CLAUDE_REASONING_EFFORTS`, `_claude_model_config_options()`; adiciona um `if` em `_model_config_options()` |
| `tests/sdk/agent/test_acp_agent.py` | alterar | Adiciona a classe `TestClaudeModelConfigOptions` (unidade) e 3 testes novos nas classes `TestMaybeSetSessionModel` / reapply / switch (integração), listados na seção 7 |

Nenhum outro arquivo do repositório muda (confirmado: `acp_providers.py`,
`model.py`, `conversation_router.py` não precisam de alteração — ver TECH
seção 4).

## 6. Critérios de aceitação

| CA | Descrição | RF/RNF |
|---|---|---|
| CA-01 | `_claude_model_config_options("sonnet/high")` retorna `(("model", "sonnet"), ("effort", "high"))` | RF-01 |
| CA-02 | `_claude_model_config_options("sonnet")` retorna `(("model", "sonnet"),)` | RF-02 |
| CA-03 | `_claude_model_config_options("sonnet/ultrafast")` retorna `(("model", "sonnet/ultrafast"),)` (sufixo não reconhecido não splita) | RF-05 |
| CA-04 | `_maybe_set_session_model(conn, "claude-agent-acp", sid, "opus[1m]/max", via_config_option=True)` dispara dois `set_config_option` na ordem `model` depois `effort` | RF-01, RF-03 |
| CA-05 | `_reapply_session_model_on_resume(conn, "claude-agent-acp", sid, "sonnet/low", via_config_option=True)` dispara os mesmos dois `set_config_option` | RF-03 |
| CA-06 | `agent.set_acp_model("sonnet/high")` (troca em tempo real, agent_name `"claude-agent-acp"`) dispara os dois `set_config_option` e `agent._current_model_id == "sonnet/high"` | RF-03 |
| CA-07 | Nenhum teste Codex existente muda de resultado (`test_splits_combined_model_and_reasoning_effort`, `test_codex_config_option_splits_reasoning_effort`, `test_codex_reapply_splits_reasoning_effort`, `test_switches_codex_via_config_option_splits_reasoning_effort`) | RNF-01 |
| CA-08 | `test_switches_claude_via_config_option_single_call` (já existente) continua passando sem alteração | RNF-01 |
| CA-09 | `ruff check` e a suíte completa de `tests/sdk/agent/test_acp_agent.py` passam | RNF-02, RNF-03 |

## 7. Plano de testes

**Unidade — nova classe `TestClaudeModelConfigOptions`** (ao lado de
`TestCodexModelConfigOptions`, `test_acp_agent.py`):
```python
class TestClaudeModelConfigOptions:
    def test_splits_combined_model_and_effort(self):
        assert _claude_model_config_options("sonnet/high") == (
            ("model", "sonnet"),
            ("effort", "high"),
        )

    def test_leaves_bare_model_id_unchanged(self):
        assert _claude_model_config_options("sonnet") == (("model", "sonnet"),)

    def test_leaves_unrecognized_suffix_unchanged(self):
        assert _claude_model_config_options("sonnet/ultrafast") == (
            ("model", "sonnet/ultrafast"),
        )
```

**Integração — 3 testes novos**, cada um mirror de um teste Codex já
existente citado na tabela do TECH seção 9, trocando `"codex-acp"` por
`"claude-agent-acp"`, o config id `"reasoning_effort"` por `"effort"`, e o
id de modelo por um da lista `_CLAUDE_MODELS` (`acp_providers.py:358-364`,
ex. `"sonnet"`/`"opus[1m]"`):
- `test_claude_config_option_splits_effort` (mirror de
  `test_codex_config_option_splits_reasoning_effort`, linha 5445).
- `test_claude_reapply_splits_effort` (mirror de
  `test_codex_reapply_splits_reasoning_effort`, linha 5589).
- `test_switches_claude_via_config_option_splits_effort` (mirror de
  `test_switches_codex_via_config_option_splits_reasoning_effort`, linha
  5790) — complementa o teste já existente
  `test_switches_claude_via_config_option_single_call` (linha ~5807), que
  cobre o caso sem sufixo.

**Comandos de verificação:**
```bash
cd software-agent-sdk
uv run ruff check openhands-sdk/openhands/sdk/agent/acp_agent.py
uv run pytest tests/sdk/agent/test_acp_agent.py -k "claude or codex" -q
uv run pytest tests/sdk/agent/test_acp_agent.py -q
```

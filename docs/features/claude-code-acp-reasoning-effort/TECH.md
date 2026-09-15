# TECH — Reasoning effort para o provider ACP `claude-code`

Repositório afetado: **`OpenHands/software-agent-sdk`** (fork de trabalho:
`JoaoNetoDev/software-agent-sdk`, branch `feat/claude-code-reasoning-effort`).
Nenhuma mudança em `OpenHands/OpenHands` (ver PRD, ABERTA-01 resolvida).

## 1. Estado atual da arquitetura nos pontos tocados

- `openhands-sdk/openhands/sdk/agent/acp_agent.py:552-566` define o único
  split de effort hoje existente, específico do Codex:
  ```python
  _MODEL_CONFIG_OPTION_ID = "model"
  _CODEX_REASONING_EFFORTS: Final[frozenset[str]] = frozenset(
      {"low", "medium", "high", "xhigh"}
  )

  def _codex_model_config_options(model: str) -> tuple[tuple[str, str], ...]:
      base_model, sep, effort = model.rpartition("/")
      if sep and base_model and effort in _CODEX_REASONING_EFFORTS:
          return (
              (_MODEL_CONFIG_OPTION_ID, base_model),
              ("reasoning_effort", effort),
          )
      return ((_MODEL_CONFIG_OPTION_ID, model),)
  ```
- `acp_agent.py:569-576` despacha por provider:
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
  Esse é o **único** ponto de decisão "que provider recebe split de effort" —
  `claude-code` cai no `return` genérico (sem split).
- `_model_config_options()` é chamado por `_apply_acp_model()`
  (`acp_agent.py:604-627`), usado tanto na aplicação do modelo inicial quanto
  na troca em tempo real (`session/set_config_option` para cada par
  retornado, em ordem). Não há necessidade de tocar `_apply_acp_model`.
- `ACP_PROVIDERS["claude-code"]` (`acp_providers.py:508-543`) não declara
  nenhum campo de effort — o dataclass `ACPProviderInfo`
  (`acp_providers.py:165-329`) também não tem um campo genérico para isso; o
  Codex não usa um campo do dataclass para o nome do config id, ele está
  hardcoded na função `_codex_model_config_options`. Seguimos o mesmo padrão
  para não introduzir um campo novo de configuração que nenhum outro provider
  usaria.
- Confirmado via o pacote npm pinado (`CLAUDE_AGENT_ACP_VERSION = "0.63.0"`,
  `acp_install_catalog.py:105,119-127`), inspecionando
  `dist/acp-agent.js` do `@agentclientprotocol/claude-agent-acp@0.63.0`:
  - `EFFORT_CONFIG_ID = "effort"` (não `"reasoning_effort"` como no Codex) —
    linha 4711 do bundle.
  - O configOption `effort` só aparece em `configOptions` quando o modelo
    atual suporta effort (`buildConfigOptions`, linhas 4837-4864); os valores
    incluem sempre `"default"` mais o que `supportedEffortLevels` reportar
    para o modelo selecionado (dinâmico — não há uma lista estática global).
  - O valor especial `"default"` limpa qualquer override de effort
    previamente aplicado (`toSdkEffortLevel`, linha 4670-4672).

## 2. Arquitetura proposta

Espelhar exatamente o padrão do Codex, com duas diferenças: o nome do
config id (`"effort"` em vez de `"reasoning_effort"`) e o allowlist de
pré-checagem (documentado como best-effort, já que não há um conjunto fixo
por conta/modelo).

```python
# acp_agent.py

_CLAUDE_EFFORT_CONFIG_OPTION_ID = "effort"
# Best-effort allowlist for deciding whether a combined Canvas id's suffix
# *looks like* a Claude effort level, so it gets split off the model id
# before being sent as `acp_model`. This is NOT authoritative: the live
# session's `configOptions` reports the real `supportedEffortLevels` for the
# current model (dynamic per model/account) — see claude-agent-acp's
# `buildConfigOptions()`. A value outside this set is sent as part of the
# model id unsplit, which the ACP server will simply not recognise as a
# model (same graceful-degradation posture as an unknown `available_models`
# entry, acp_providers.py:342-344).
_CLAUDE_REASONING_EFFORTS: Final[frozenset[str]] = frozenset(
    {"low", "medium", "high", "max"}
)


def _claude_model_config_options(model: str) -> tuple[tuple[str, str], ...]:
    """Map a combined Canvas Claude model id (``<model>/<effort>``) to
    claude-agent-acp config options. Mirrors _codex_model_config_options,
    using claude-agent-acp's own config id (``effort``, not
    ``reasoning_effort``)."""
    base_model, sep, effort = model.rpartition("/")
    if sep and base_model and effort in _CLAUDE_REASONING_EFFORTS:
        return (
            (_MODEL_CONFIG_OPTION_ID, base_model),
            (_CLAUDE_EFFORT_CONFIG_OPTION_ID, effort),
        )
    return ((_MODEL_CONFIG_OPTION_ID, model),)


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

Nenhuma outra função muda: `_apply_acp_model`, `_extract_session_models` e o
restante do fluxo de switch (`acp_agent.py` em torno de 800-900 e 3170-3260)
já são genéricos por `_model_config_options`, então o novo caso do Claude é
coberto automaticamente na criação da sessão, no resume (`load_session`) e na
troca em tempo real.

## 3. Modelo de dados e migrações

Nenhuma. Não há novo campo persistido: `acp_model` (`model.py:1561-1578`)
já é uma `str` livre; o formato combinado `"<model>/<effort>"` é uma
convenção de valor, não de schema.

## 4. Contratos: APIs, eventos, tipos públicos, assinaturas

- Nova função de módulo (não exportada em `__init__`, uso interno):
  `_claude_model_config_options(model: str) -> tuple[tuple[str, str], ...]`.
- Nova constante de módulo: `_CLAUDE_REASONING_EFFORTS: Final[frozenset[str]]`
  e `_CLAUDE_EFFORT_CONFIG_OPTION_ID: Final[str] = "effort"`.
- `_model_config_options()` ganha um `elif`/segundo `if` — assinatura e
  contrato de retorno inalterados.
- Nenhuma rota do `agent-server` muda: `switch_conversation_acp_model`
  (`conversation_router.py:553-593`) já aceita qualquer string em `model`.
- Nenhum tipo público (`ACPAgentSettings`, `ACPProviderInfo`) muda de forma
  observável externamente.

## 5. Alternativas consideradas

- **Adicionar um campo genérico no dataclass `ACPProviderInfo`** (ex.:
  `effort_config_id: str | None`) para eliminar o `if provider.key ==` duplo.
  Rejeitado por escopo: o Codex já usa o mesmo padrão hardcoded há tempos;
  introduzir uma abstração nova para dois casos é over-engineering para esta
  mudança, e sairia do escopo aprovado no PRD (só o gap Claude). Fica como
  nota para uma futura generalização se um terceiro provider precisar do
  mesmo mecanismo.
- **Usar o mesmo config id `"reasoning_effort"` do Codex para o Claude**.
  Rejeitado: o `claude-agent-acp` 0.63.0 define seu próprio id `"effort"`
  (`EFFORT_CONFIG_ID`, `dist/acp-agent.js:4711`); usar o id errado faria o
  servidor rejeitar com "Unknown config option" (`dist/acp-agent.js:3190-3192`).

## 6. Segurança, permissões e privacidade

Nenhum impacto novo — o valor de effort trafega pelo mesmo canal
(`session/set_config_option`) já usado para modelo, sem introduzir novo
segredo, novo escopo de credencial ou novo dado sensível.

## 7. Performance e escala

Nenhuma: mesma quantidade de round-trips ACP que o caso Codex já faz hoje (1
ou 2 chamadas `set_config_option`, dependendo de haver ou não sufixo de
effort reconhecido).

## 8. Observabilidade

Reaproveita o tratamento de erro já existente em `_apply_acp_model`/callers
para `set_config_option` (ver comentário em `acp_agent.py:1742-1744` sobre a
mensagem de erro citar ambos os mecanismos). Nenhum log novo necessário.

## 9. Estratégia de testes

Espelhar os testes Codex existentes em
`tests/sdk/agent/test_acp_agent.py`, criando os equivalentes para Claude:

| Teste Codex existente | Linha | Equivalente Claude a criar |
|---|---|---|
| `test_splits_combined_model_and_reasoning_effort` | 5389 | `test_splits_combined_claude_model_and_effort` |
| `test_codex_config_option_splits_reasoning_effort` | 5445 | `test_claude_config_option_splits_effort` |
| `test_codex_reapply_splits_reasoning_effort` | 5589 | `test_claude_reapply_splits_effort` |
| `test_switches_codex_via_config_option_splits_reasoning_effort` | 5790 | `test_switches_claude_via_config_option_splits_effort` |

Casos adicionais (unidade, função pura `_claude_model_config_options`):
- sufixo reconhecido (`"sonnet/high"` → dois pares, id `"effort"`).
- sufixo não reconhecido (`"sonnet/ultrafast"` → um par, sem split — grafia
  igual ao comportamento hoje).
- sem sufixo (`"opus[1m]"` → um par; cuidado: `rpartition("/")` não deve
  confundir colchetes com separador — não há `/` em `"opus[1m]"`, então já
  funciona pela mesma lógica do Codex).
- id vazio à esquerda do `/` (`"/high"` → sem split, mesma regra
  `base_model` truthy do Codex).

Todos os quatro testes de integração usam o harness de fake ACP server já
existente no arquivo de teste (o mesmo usado pelos testes Codex citados) —
não é necessário criar novo fixture.

## 10. Rollout, feature flag e rollback

Sem flag — mudança aditiva e localizada a duas funções puras + um branch de
dispatch. Rollback trivial (reverter o commit/PR).

## 11. Rastreabilidade PRD → TECH

| Requisito | Onde é atendido |
|---|---|
| RF-01 | `_claude_model_config_options` + branch novo em `_model_config_options` (seção 2) |
| RF-02 | Mesma função: retorna só `(model, model)` quando não há sufixo reconhecido |
| RF-03 | Reuso de `_apply_acp_model`/fluxo de switch já existente — nenhuma mudança necessária |
| RF-04 | `_extract_session_models`/`_model_config_option` só olham a entrada `id == "model"`; a entrada `effort` é ignorada por esse parser, o que já é seguro hoje (comportamento idêntico ao Codex, que também não lê `reasoning_effort` de volta) |
| RF-05 | `_CLAUDE_REASONING_EFFORTS` documentado como pré-checagem best-effort (seção 2, docstring) |
| RNF-01 | Branch novo é aditivo; caminho Codex e demais providers inalterados |
| RNF-02 | Nenhuma exceção nova lançada pela função pura; erro de protocolo já tratado a montante |
| RNF-03 | Tabela de testes na seção 9 |

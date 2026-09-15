# SPRINT-01 — Reasoning effort para o provider ACP `claude-code`

## Objetivo
Fazer `acp_model = "<model>/<effort>"` funcionar para o provider `claude-code`, replicando o mecanismo já existente do Codex.

## Depende de
nenhuma

## Onda
1 — única sprint, único arquivo de produção, sem sobreposição a resolver.

## Arquivos previstos
- `openhands-sdk/openhands/sdk/agent/acp_agent.py` — alterar — adiciona `_CLAUDE_EFFORT_CONFIG_OPTION_ID`, `_CLAUDE_REASONING_EFFORTS`, `_claude_model_config_options()`; adiciona branch `claude-code` em `_model_config_options()`
- `tests/sdk/agent/test_acp_agent.py` — alterar — adiciona `TestClaudeModelConfigOptions` (3 testes de unidade) e 3 testes de integração espelhando os equivalentes Codex

## Passos de implementação
1. Em `acp_agent.py`, logo após `_codex_model_config_options` (perto de `_model_config_options`, ver TECH.md §2 e SPEC.md §2.1 para o código exato a inserir), adicionar:
   - `_CLAUDE_EFFORT_CONFIG_OPTION_ID: Final[str] = "effort"`
   - `_CLAUDE_REASONING_EFFORTS: Final[frozenset[str]] = frozenset({"low", "medium", "high", "max"})`
   - `_claude_model_config_options(model: str) -> tuple[tuple[str, str], ...]` (corpo exato na SPEC §2.1)
2. Alterar `_model_config_options()` para checar `provider.key == "claude-code"` e delegar a `_claude_model_config_options`, mantendo o branch `codex` existente e o fallback genérico inalterados.
3. Em `test_acp_agent.py`, adicionar a classe `TestClaudeModelConfigOptions` com os 3 testes de unidade (SPEC §7).
4. Adicionar os 3 testes de integração mirror dos testes Codex (`test_claude_config_option_splits_effort`, `test_claude_reapply_splits_effort`, `test_switches_claude_via_config_option_splits_effort`), usando `agent_name="claude-agent-acp"`, config id `"effort"`, e ids de `_CLAUDE_MODELS`.
5. Rodar toda a suíte de `test_acp_agent.py` e o `ruff check` antes de finalizar.

## Testes obrigatórios
- Os 6 testes novos listados acima (3 unidade + 3 integração).
- Suíte completa `tests/sdk/agent/test_acp_agent.py` sem regressão (em particular os 4 testes Codex e o teste `test_switches_claude_via_config_option_single_call` já existentes).

## Critérios de aceitação
- [ ] CA-01: `_claude_model_config_options("sonnet/high")` → `(("model", "sonnet"), ("effort", "high"))`
- [ ] CA-02: `_claude_model_config_options("sonnet")` → `(("model", "sonnet"),)`
- [ ] CA-03: `_claude_model_config_options("sonnet/ultrafast")` → `(("model", "sonnet/ultrafast"),)`
- [ ] CA-04: `_maybe_set_session_model(..., "claude-agent-acp", ..., "opus[1m]/max", via_config_option=True)` dispara `model` depois `effort`
- [ ] CA-05: `_reapply_session_model_on_resume(..., "claude-agent-acp", ..., "sonnet/low", via_config_option=True)` dispara os mesmos dois `set_config_option`
- [ ] CA-06: `agent.set_acp_model("sonnet/high")` com `agent_name="claude-agent-acp"` dispara os dois `set_config_option` e atualiza `agent._current_model_id`
- [ ] CA-07: os 4 testes Codex existentes continuam passando sem alteração
- [ ] CA-08: `test_switches_claude_via_config_option_single_call` continua passando sem alteração
- [ ] CA-09: `ruff check` limpo e suíte completa verde

## Comandos de verificação
```bash
cd software-agent-sdk
uv run ruff check openhands-sdk/openhands/sdk/agent/acp_agent.py
uv run pytest tests/sdk/agent/test_acp_agent.py -q
```

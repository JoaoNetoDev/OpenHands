# PRD — Reasoning effort para o provider ACP `claude-code`

## 1. Problema e evidência

O OpenHands Agent Canvas já permite trocar o "reasoning effort" em tempo real
para conversas rodando em **backend local**, através do seletor descrito em
`src/hooks/use-chat-input-reasoning-effort-state.ts:13` (opções
`none | low | medium | high | xhigh`), que chama
`AgentServerConversationService.switchReasoningEffort`
(`src/api/conversation-service/agent-server-conversation-service.api.ts:1122`).

Esse fluxo depende de o **agente ACP em uso** aceitar `reasoning_effort` como
parte do `acp_model` combinado. Hoje, no SDK (`OpenHands/software-agent-sdk`),
isso só está implementado para o provider **Codex**:
`_codex_model_config_options()` (`openhands-agent-server`/`openhands-sdk`,
arquivo `openhands-sdk/openhands/sdk/agent/acp_agent.py:558-566`) faz o split
`"<modelo>/<effort>"` → `set_config_option("model", …)` +
`set_config_option("reasoning_effort", …)`, usando o allowlist
`_CODEX_REASONING_EFFORTS = {low, medium, high, xhigh}`
(`acp_agent.py:553-555`).

O provider **`claude-code`** (`ACP_PROVIDERS["claude-code"]`,
`openhands-sdk/openhands/sdk/settings/acp_providers.py:508-543`) não tem
equivalente: `_model_config_options()` (`acp_agent.py:569-576`) só reconhece o
provider `codex` para split de effort; para qualquer outro provider (incluindo
`claude-code`) o valor de `acp_model` é enviado inteiro como `("model", model)`
— não há como setar o effort do Claude por essa via.

Isso é uma lacuna real, não uma limitação do CLI: o binário pinado
(`@agentclientprotocol/claude-agent-acp`, versão `CLAUDE_AGENT_ACP_VERSION =
"0.63.0"`, `openhands-sdk/openhands/sdk/settings/acp_install_catalog.py:105,119-127`)
**já expõe nativamente** um configOption `effort`
(`EFFORT_CONFIG_ID = "effort"`, `dist/acp-agent.js:4711`, construído
dinamicamente em `buildConfigOptions()`, `dist/acp-agent.js:4808-4864`) com
valores dependentes do modelo atual (`supportedEffortLevels`) e um sentinel
`"default"`. O servidor ACP já sabe fazer isso; falta o SDK do OpenHands
acionar esse configOption para esse provider.

**Analogia de referência**: o produto "LionCode" (repositório de terceiros
`LionLabsCommunity/LionCodeLabs`, consultado nesta sessão) resolve o mesmo
problema no seu próprio backend com uma função `effortFor()`
(`packages/server/src/providers/claude-agent.ts:163-182`) que normaliza
níveis de UI (`low/medium/high/extra-high/max/ultra/ultracode/ultrathink`)
para o parâmetro `effort` do Claude Agent SDK. Não temos acesso de escrita a
esse repo nem dependência dele — é usado aqui só como evidência de que a
funcionalidade é viável e já validada em produção por outro consumidor do
mesmo SDK subjacente.

## 2. Usuários e cenários de uso

- **Dono de conversa Canvas com backend local ACP `claude-code`** configurado
  (Claude Code CLI logado via assinatura, ou `ANTHROPIC_API_KEY`): hoje pode
  trocar de modelo Claude em tempo real (`acp_model`), mas não pode subir/
  descer o esforço de raciocínio sem reiniciar a sessão com outro perfil.
- Cenário: usuário está num Sonnet padrão, percebe que a tarefa é mais difícil
  do que o esperado, e quer subir o effort para `high` ou `max` **na mesma
  conversa**, sem perder contexto — o mesmo mecanismo que já existe para
  Codex.

## 3. Objetivos e não-objetivos

**Objetivos**
- OBJ-01: o seletor de reasoning effort já existente no Canvas
  (`chat-input-llm-profile-picker.tsx:159`) passa a funcionar também para
  conversas com `acp_server = "claude-code"`, usando o mesmo fluxo de
  `switchReasoningEffort` já existente no frontend.
- OBJ-02: a seleção inicial de effort (ao criar a sessão) também é respeitada
  quando o usuário já define `acp_model` com sufixo de effort.
- OBJ-03: um valor de effort não suportado pelo modelo Claude atual não quebra
  a sessão — degrada para o comportamento padrão do servidor ACP (mesma
  postura de "sugestão, não checagem de acesso" já documentada para
  `available_models` em `acp_providers.py:342-344`).

**Não-objetivos**
- NÃO-OBJ-01: não implementaremos os níveis extras do LionCode
  (`ultracode`, `ultrathink` com reescrita de prompt). Ver decisão registrada
  na conversa: o usuário pediu explicitamente a comparação, mas o escopo
  aprovado aqui é só os níveis nativos que o `claude-agent-acp` já reporta via
  `supportedEffortLevels` (tipicamente `low/medium/high/max`, dependente do
  modelo/conta).
- NÃO-OBJ-02: não mudaremos nada no repositório `OpenHands/OpenHands`
  (frontend/Canvas) — o seletor e o mecanismo de switch já existem e são
  genéricos por design; esta feature é 100% backend (`software-agent-sdk`).
- NÃO-OBJ-03: não mudaremos o comportamento do provider Codex nem de outros
  providers ACP.
- NÃO-OBJ-04: não adicionaremos suporte a Cloud backend (o seletor já é
  gateado para `backend.kind !== "cloud"` no frontend,
  `use-chat-input-reasoning-effort-state.ts:52`).

## 4. Requisitos funcionais

- RF-01: Dado `acp_server = "claude-code"` e um `acp_model` no formato
  `"<model>/<effort>"` onde `<effort>` é um valor de effort reconhecido, o SDK
  deve enviar `set_config_option("model", <model>)` seguido de
  `set_config_option("effort", <effort>)` na criação da sessão — mesmo padrão
  do Codex (`_apply_initial_model`, `acp_agent.py:607-637`), reaproveitando o
  mecanismo genérico de múltiplos config options por modelo.
- RF-02: Dado `acp_model` sem sufixo de effort reconhecido (ex.: `"sonnet"`,
  `"opus[1m]"`), o comportamento atual não muda — só `("model", acp_model)` é
  enviado.
- RF-03: A troca de effort em tempo real (runtime, mid-conversation) deve
  funcionar pelo mesmo mecanismo de switch de modelo já existente
  (`supports_runtime_model_switch=True` em `claude-code`,
  `acp_providers.py:525`) — reaplicando `set_config_option("effort", …)`
  quando o `acp_model` é trocado por `switchLLM`/`switchReasoningEffort`.
- RF-04: A resposta de `session/new`/`load_session` para `claude-code` deve
  continuar sendo parseada normalmente mesmo quando o `configOptions` incluir
  a entrada `effort` (hoje ignorada silenciosamente por não haver handler —
  confirmar que isso já é seguro, ou tratar explicitamente).
- RF-05: valores de effort devem ser normalizados/validados com um allowlist
  conhecido (mesma ideia do `_CODEX_REASONING_EFFORTS`), documentando que a
  lista real e autoritativa é dinâmica (`supportedEffortLevels` reportado pelo
  servidor) — o allowlist do SDK é só uma pré-checagem de formato, igual ao
  comentário em `acp_providers.py:342-344` para `available_models`.

## 5. Requisitos não-funcionais

- RNF-01 (compatibilidade): nenhuma mudança de comportamento para
  `acp_model` sem sufixo de effort, nem para outros providers.
- RNF-02 (robustez): um sufixo de effort inválido ou não suportado pelo
  modelo atual não deve lançar exceção não tratada — o pior caso é o servidor
  ACP rejeitar o `set_config_option` (já tratado genericamente, ver
  `acp_agent.py` em torno da linha 1742 sobre erros de `set_config_option`).
- RNF-03 (testabilidade): cobertura de teste espelhando
  `test_splits_combined_model_and_reasoning_effort` e
  `test_codex_config_option_splits_reasoning_effort`
  (`tests/sdk/agent/test_acp_agent.py:5389, 5445`) para o caso `claude-code`.
- RNF-04 (observabilidade): nenhum requisito novo de log — reaproveita o log
  já existente do fluxo `set_config_option`.

## 6. Métricas de sucesso

- Um usuário com backend `claude-code` consegue, pelo seletor já existente no
  Canvas, mudar o effort da conversa e ver o `set_config_option("effort", …)`
  disparado (verificável via teste de integração e, manualmente, via log do
  subprocess ACP).
- Zero regressão nos testes existentes de `test_acp_agent.py` e
  `test_acp_providers.py`.

## 7. Escopo de release e faseamento

Release único, sem feature flag — é uma extensão aditiva de um mecanismo já
existente (mesmo padrão do Codex, que não tem flag). Sprint única esperada
(baixa complexidade, um arquivo concentra a mudança).

## 8. Riscos de produto e questões em aberto

- RISCO-01: `supportedEffortLevels` é dinâmico por modelo/conta — não dá para
  cravar estaticamente quais valores são válidos para `claude-code` (ao
  contrário do Codex, que tem 4 valores fixos). Mitigação: usar um allowlist
  "melhor esforço" (`low, medium, high, max`) só para decidir se um sufixo
  *parece* um effort (e portanto deve ser splitado do nome do modelo) — a
  validação de aceitação real fica a cargo do servidor ACP, igual já acontece
  hoje para `available_models`.
- RISCO-02: o formato combinado `"<model>/<effort>"` colide com modelos cujo
  próprio id contém `/` (nenhum dos `_CLAUDE_MODELS` atuais tem — confirmado
  em `acp_providers.py:358-364`). Se um id de modelo futuro tiver `/`, a regra
  de "sufixo bate com o allowlist de effort" evita falso positivo (mesma
  proteção que o Codex já usa via `rpartition("/")` + checagem de
  pertencimento ao set).
- ABERTA-01 (resolvida nesta sessão): o Canvas frontend **não** monta o
  `acp_model` combinado em nenhum picker — nem para Codex. O picker de modelo
  ACP (`src/components/features/chat/components/chat-input-model.tsx:56-64`,
  via `useSwitchAcpModel`) só manda o id bruto escolhido de uma lista
  curada (`_CODEX_MODELS`/`_CLAUDE_MODELS` em `acp_providers.py`), sem sufixo.
  O formato `"<model>/<effort>"` é uma convenção que só existe do lado do SDK
  (`_codex_model_config_options`) e é alimentada por quem escreve
  `acp_model` como texto livre (campo de Settings,
  `openhands-sdk/openhands/sdk/settings/model.py:1561-1578`, descrito como
  aceitando qualquer string). Confirma-se então o NÃO-OBJ-02: esta feature é
  100% backend (`software-agent-sdk`), sem necessidade de tocar
  `OpenHands/OpenHands`.

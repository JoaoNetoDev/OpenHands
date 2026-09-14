# BUG — Reasoning effort do provider ACP `claude-code`: o id combinado `sonnet/medium` chega ao Claude CLI como **modelo** (nunca é separado) → 404 `model_not_found`, ou pior: o effort é **silenciosamente ignorado**

**Status: DIAGNOSTICADO — aguardando aprovação da ficha (nenhuma correção aplicada).**

## BUG

- **Sintoma**: no Canvas (`/opt/openhands`, produção em `openhands.zadotec.com.br`), com o provider
  ACP **`claude-code`** ativo e um nível de **reasoning effort** escolhido no seletor de modelo do
  composer (ex.: "Medium"), ao enviar qualquer mensagem a conversa responde:

  > `There's an issue with the selected model (sonnet/medium). It may not exist or you may not have access to it.`

  O seletor mostra o modelo como `sonnet/medium`. O erro se repete **a cada** envio — a sessão do CLI
  é retomada, mas volta a falhar — e a conversa nunca avança. Já observado antes com `sonnet/low`.
- **Esperado**: escolher "Medium" deve selecionar o modelo `sonnet` **e** o esforço `medium` como
  dois ajustes distintos do wrapper ACP; a mensagem deve rodar com o effort aplicado.
- **Reprodução** (determinística):
  1. Com o provider ACP `claude-code` ativo (perfil `default`, `acp_model` já persistido como
     `sonnet/medium`), abrir o composer e enviar **qualquer** mensagem.
  2. Resposta: o erro 404 acima, repetido a cada reenvio.
  - Sem UI, o mesmo efeito é reproduzível direto na API:
    ```bash
    curl -sS -X POST http://127.0.0.1:18000/api/conversations/<cid>/switch_acp_model \
      -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" -H 'Content-Type: application/json' \
      -d '{"model":"sonnet/medium"}' -w "\nHTTP_%{http_code}\n"
    # {"detail":"Internal Server Error","exception":"Internal error","error_id":"…"}  HTTP_500
    ```
- **Escopo**: qualquer conversa `claude-code` cujo `acp_model` tenha sufixo de effort — isto é, toda
  vez que alguém usa a seção **Effort** do composer (a feature que dá nome ao esforço). O `acp_model`
  fica **persistido** no perfil de agente ativo (`/root/.openhands/agent-profiles/default.json`,
  `revision: 11`, `"acp_model": "sonnet/medium"`), então o estado é **pegajoso**: depois de escolher
  o effort uma vez, toda conversa nova lançada por esse perfil quebra, mesmo sem o usuário tocar no
  seletor de novo. Gravidade **alta** (recurso inutilizável + conversas presas). Afeta só o provider
  `claude-code` — Codex tem o mesmo mecanismo e **funciona**.

## TRACE

Dois ângulos independentes convergiram, e o tracer dinâmico ainda revelou um **modo de falha
silencioso** que o estático não via.

### Tracer A — código (estático)

Caminho seguido de trás para frente: mensagem de erro do CLI → protocolo ACP → montagem das opções
de configuração no SDK → o que o Canvas envia como `acp_model`.

1. **A mensagem de erro é do próprio Claude CLI, não do OpenHands.** O branch de HTTP 404 do binário
   (`/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`) monta literalmente
   `` `There's an issue with the selected model (${t}). It may not exist or you may not have access to it.` ``
   com `error:"model_not_found"`; o `${t}` é o id recebido. Confirmação em disco: o `.jsonl` da
   sessão da própria conversa da captura (`9c03b`) —
   `/root/.claude/projects/-root-workspace-project-9c03bd9c6d84442da2f78569dbb54015/351cc336-ee03-41df-b531-f9dae758bfcb.jsonl:11`:

   ```
   type=assistant model=<synthetic> error=model_not_found apiErrorStatus=404
   text="There's an issue with the selected model (sonnet/medium). It may not exist or you may not have access to it."
   ```

   Mesmo padrão para `sonnet/low` em `.../projects/-root-workspace-project-cfa20f8b87b24a819aa2d02c0c7e2b4d/c1db2cf7-5bad-458b-923a-9715232c2291.jsonl:12`.
2. **O Canvas compõe `<base>/<effort>` e usa como `acp_model`** —
   `src/components/features/chat/components/chat-input-model.tsx:71-83` (`handleSelectEffort` →
   `` `${model.baseModelId}/${effortId}` `` → `switchAcpModel.mutate`). Os níveis curados para
   `claude-code` são `low|medium|high|max` (`src/constants/acp-providers.ts:146-155`). O próprio
   comentário do arquivo (`:65-70`) declara a premissa: *"an effort pick is just another `acp_model`
   value from the ACP wrapper's own config-option split (see software-agent-sdk's
   `_claude_model_config_options`)"*.
3. **O SDK instalado só faz o split para o Codex.** Em `openhands-sdk==1.46.0` — o que o
   `agent-server` desta máquina executa (`uvx --from openhands-agent-server==1.46.0 --with
   openhands-sdk==1.46.0 … agent-server --host 127.0.0.1 --port 18000`) —
   `.../site-packages/openhands/sdk/agent/acp_agent.py:568-575`:

   ```python
   def _model_config_options(agent_name: str | None, model: str) -> tuple[tuple[str, str], ...]:
       provider = detect_acp_provider_by_agent_name(agent_name or "")
       if provider is not None and provider.key == "codex":
           return _codex_model_config_options(model)
       return ((_MODEL_CONFIG_OPTION_ID, model),)   # <-- claude-code cai aqui, id cru
   ```

   Só existe `_codex_model_config_options` (`:557-565`) e `_CODEX_REASONING_EFFORTS` (`:552-554`).
   **Não existe `_claude_model_config_options` nem `_CLAUDE_REASONING_EFFORTS`** (grep vazio em todo
   o site-packages).
4. **Segundo caminho, também sem split: o `_meta` da criação de sessão.**
   `acp_providers.py:777-792` (`build_session_model_meta`) devolve
   `{provider.session_meta_key: {"options": {"model": acp_model}}}` — e para `claude-code` o
   `session_meta_key` é `"claudeCode"` (`acp_providers.py:526`). O id combinado vai **verbatim**
   também por aqui. Verificado executando o código instalado:

   ```
   _model_config_options("claude-agent-acp", "sonnet/medium")    -> (('model', 'sonnet/medium'),)
   build_session_model_meta("claude-agent-acp", "sonnet/medium") -> {'claudeCode': {'options': {'model': 'sonnet/medium'}}}
   # contraste Codex (funciona):
   _model_config_options("codex-acp", "gpt-5.5/high")            -> (('model','gpt-5.5'), ('reasoning_effort','high'))
   build_session_model_meta("codex-acp", "gpt-5.5/high")         -> {}
   ```
5. **O CLI aceita effort de primeira classe — separado do modelo.** `claude --help` neste host
   (v2.1.251) documenta `--effort <level>` ("Effort level for the current session") como opção
   **distinta** de `--model <model>`. O `claude-agent-acp` 0.63.0 (pinado pelo SDK em
   `acp_install_catalog.py:105`) expõe o config option `effort` por sessão. Ou seja: o recurso existe
   nas duas pontas; o que falta é o SDK despachar o split.
6. **O erro é engolido no caminho de criação.** `_maybe_set_session_model` (`acp_agent.py:829-855`)
   e `_reapply_session_model_on_resume` (`:858-900`) toleram a rejeição com `logger.warning` e
   devolvem `False` — por isso a sessão **sobe** normalmente e a falha só aparece no turno.
7. **Descartado**: credenciais/auth (o CLI teria `authentication_failed`, não `model_not_found`);
   detecção de provider (o ramo default também manda o id cru); caminho legado `set_session_model`
   (o wrapper só registra `setConfigOption`); ausência de suporte a effort no wrapper (0.63.0 **tem**
   o option); bug no seletor do frontend (`splitAcpModelEffort` tem teste verde em
   `src/constants/acp-providers.test.ts:73-101`); lista curada de modelos (o id combinado não vem
   dela).

### Tracer B — comportamento (delegado ao `claude-m3`/MiniMax, contexto limpo)

O tracer dinâmico reproduziu e **capturou o JSON-RPC real** com `strace` no processo do wrapper:

```
05:59:42.961  read(0)  ← SDK: session/set_config_option  {configId:"model", value:"sonnet/medium"}
05:59:42.961  write(22) → CLI: set_model  {"model":"sonnet/medium"}
05:59:42.964  read(24)  ← CLI: {"subtype":"error","error":"Model \"sonnet/medium\" is not a recognized model id. Run /model to see available models."}
05:59:42.967  write(1)  → SDK: {"code":-32603,"message":"Internal error","data":{"details":"Model \"sonnet/medium\" is not a recognized model id..."}}
```

O `agent-server` converte isso em `HTTP_500 {"detail":"Internal Server Error"}` — o `data.details`
do CLI **não é propagado** ao frontend.

**Tabela de contorno** (5 rodadas por linha, contra a mesma sessão ACP ativa, estável 5/5):

| `model` enviado | HTTP | O que o CLI recebeu |
|---|---|---|
| `sonnet` | 200 | `sonnet` |
| `sonnet/low` | **200** | **`sonnet`** (effort perdido) |
| `sonnet/high` | **200** | **`sonnet`** (effort perdido) |
| `sonnet/max` | **200** | **`sonnet`** (effort perdido) |
| `sonnet/foobar` | **200** | **`sonnet`** |
| **`sonnet/medium`** | **500** | **`sonnet/medium`** (literal → CLI rejeita) |
| `haiku/low`, `haiku/medium`, `default/medium`, `opus[1m]/low` | 200 | modelo base, effort perdido |

**Achado que só o ângulo dinâmico produziu — um segundo modo de falha, silencioso.** O wrapper
mantém uma lista viva de options do schema `model`; qualquer id que o CLI nativo não conheça entra
nela como `"Custom model"`. O processo do CLI foi iniciado com `--model sonnet/medium`
(`ps -o cmd -p 1298277`), criando uma option **fantasma**
`{"value":"sonnet/medium","description":"Custom model"}`. No handler de `set_config_option`
(`.../npm-cache/_npx/3e28e223a0aba92d/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:3207-3258`):

1. há um match **exato** contra a lista de options;
2. **se bate**, o fallback inteligente `resolveModelPreference` é **pulado**;
3. o valor literal vai direto para `query.setModel(...)` → o CLI rejeita.

Nos demais casos (`low`/`high`/`max`/`foobar`) não existe option com esse literal, então o
`resolveModelPreference` roda e **degrada para o modelo base** — o turno passa, mas o **esforço é
descartado**. Este é o desfecho mais grave: o effort **parece funcionar** e não faz nada.

Isso reconcilia a história completa: em 2026-09-13 `sonnet/low` deu 404 (face "falha dura"); em
2026-09-14 `sonnet/low` passa com 200 (face "silenciosa", effort ignorado). **É o mesmo defeito** —
o split que nunca acontece.

### Convergência

- **Convergem, sem conflito, na causa raiz**: o SDK não separa `<model>/<effort>` para o
  `claude-code`, e o id combinado é entregue ao wrapper ACP. Os dois chegaram a
  `_model_config_options` (`acp_agent.py:568-575`) como o ponto que falta — A por leitura, B por
  `strace` — e B capturou a rejeição literal do CLI, fechando a cadeia causal.
- **O que B acrescentou e A não tinha**: (i) a **bifurcação de desfecho** (falha dura vs. degradação
  silenciosa), com a tabela de contorno 5/5; (ii) a **option fantasma** como o fator que decide qual
  desfecho ocorre; (iii) o 500 genérico, com o `data.details` do CLI descartado pelo agent-server.
- **Onde divergem de fato — e como resolvi**: A enumera **um** ponto de falha (o runtime switch via
  `set_config_option`), tratando o `_meta` como "segundo candidato, confiança média". Conferi esse
  furo diretamente, executando o código instalado e baixando o wheel do último release: o
  `build_session_model_meta` devolve o id combinado, **e o commit `21cfc40` não o altera**
  (`git show --stat` → só `acp_agent.py` e `test_acp_agent.py`). **Portanto são dois caminhos não
  corrigidos, e a correção existente cobre apenas um.** Único ponto em que precisei ir além dos dois
  tracers, e está provado por execução.
- **Reclassificação de premissa**: B trata a composição `<model>/<effort>` no frontend como "Falha A
  — composição errada". **Rejeito essa classificação**: a composição é intencional e correta *dado
  um SDK com o split* (é o mesmo contrato que o Codex usa e cumpre); o defeito é a capacidade ausente
  no backend. A premissa está certa, a implementação é que não existe no runtime.

## DIAGNÓSTICO

- **Causa raiz**: o SDK Python em runtime (`openhands-sdk==1.46.0`) **não implementa o split
  `<model>/<effort>` para o provider `claude-code`**. O `acp_model` combinado que o Canvas grava no
  perfil (`acp_model: "sonnet/medium"`) atravessa os **dois** caminhos do SDK sem ser separado —
  `_model_config_options` (`acp_agent.py:568-575`, cai no fallback) e `build_session_model_meta`
  (`acp_providers.py:777-792`, devolve o id cru) — e chega ao `claude-agent-acp` como se fosse um
  **model id**.
- **Por que causa o sintoma**: o id inválido vai ao CLI, que responde 404 `model_not_found` com
  exatamente o texto visto. Quando o wrapper consegue casar o literal contra uma option "Custom
  model" que ele mesmo registrou, o valor literal vence e o CLI rejeita (falha dura); quando não
  casa, o wrapper degrada para o modelo base e **descarta o effort** (falha silenciosa). Nos dois
  casos o recurso não funciona — ou quebra a conversa, ou é placebo.
- **Por que passou despercebido**: a correção existe, está commitada e testada, mas **nunca foi
  publicada** — e o deploy consome o release publicado, não o checkout. O commit `21cfc40` (branch
  `feat/claude-code-reasoning-effort` no fork `JoaoNetoDev/software-agent-sdk`, 2026-09-12) adiciona
  `_CLAUDE_EFFORT_CONFIG_OPTION_ID`, `_CLAUDE_REASONING_EFFORTS`, `_claude_model_config_options` e 6
  testes. Verificação de release:
  - `/opt/openhands` roda `openhands-sdk==1.46.0` (pinado no `uvx` do `openhands.service`);
  - **nem `1.46.0` nem o release mais recente `1.47.0` contêm o fix** (baixei o wheel de `1.47.0` da
    PyPI: `HAS _claude_model_config_options: False`);
  - o próprio commit **não corrige o caminho `_meta`** (`build_session_model_meta` intocado);
  - `docs/features/claude-code-acp-reasoning-effort/sprints/BUILD-STATE.md` diz "pronto para revisão
    de diff pelo usuário. Não commitado" — a feature parou no gate de aprovação. Do outro lado, o
    **frontend** (`5d9f301`, 2026-09-14 04:41, seletor de Effort) **já está no bundle servido**
    (`build/assets/llm-not-configured-banner-DxYEZgvc.js` contém `chat-input-acp-effort-option`).
    A assimetria que o usuário vive é exatamente essa: a UI oferece o effort, o backend não o consome.
- **Confiança**: **alta** para a causa raiz e para a bifurcação de desfecho — cadeia fechada com
  evidência primária dos dois ângulos: id combinado **persistido** no perfil ativo; código instalado
  lido e **executado** mostrando ambos os caminhos sem split; `strace` do JSON-RPC real com a
  rejeição literal do CLI; tabela de contorno estável 5/5; erro do CLI com o id combinado no texto;
  `--effort` existindo como opção separada no CLI; e o fix fora de qualquer release. **Média** apenas
  para a origem exata da option fantasma (o startup `--model sonnet/medium`) — plausível e
  corroborado por `ps`, mas não seguido bit a bit no código do wrapper.
- **Impacto colateral**: a UI de effort (`use-chat-input-model-state.ts`, `chat-input-model.tsx`)
  está correta e não precisa mudar. O fallback `((_MODEL_CONFIG_OPTION_ID, model),)` serve **todos**
  os providers sem mecanismo de effort (gemini-cli etc.) — a correção tem de ser **aditiva**,
  ramificando por `provider.key`, como o commit `21cfc40` já faz. E precisa cobrir **os dois**
  caminhos (`_model_config_options` **e** `build_session_model_meta`).
- **Correção proposta (direção, não implementação)**:
  1. **Completar o fix no SDK**: além do que `21cfc40` já faz em `_model_config_options`, tratar o id
     combinado também em `build_session_model_meta` (que hoje ignora o split para `claude-code`,
     diferente do Codex) — mesma allowlist `{low, medium, high, max}`, mesmo config id `effort`. Sem
     isso, o caminho de criação continua mandando o id cru.
  2. **Publicar**: levar o fix ao SDK publicado e cortar um release (ex. `1.47.1`); então bumpar os
     pins `openhands-sdk==…` / `openhands-agent-server==…` no `uvx` do `openhands.service`
     (`/etc/systemd/system/openhands.service`) e reiniciar.
  3. **Caminho imediato, sem esperar release**: o SDK é resolvido por `uvx --from`, então dá para
     apontar o `uvx` para a revisão que contém o fix (pin no fork/commit, ou wheel local construída
     do checkout). Resolve agora, mas cria dependência de origem não-PyPI que precisa ser documentada
     e depois revertida para o release oficial.
  4. **Defensivo (independente do SDK)**: no wrapper/handler, não tratar como válida uma option
     "Custom model" cujo valor não seja um model id reconhecido pelo CLI — hoje é esse match exato
     que transforma uma degradação silenciosa em falha dura. E propagar o `data.details` do CLI até o
     usuário, em vez do 500 genérico: o texto real (`Model "sonnet/medium" is not a recognized model
     id`) tornaria esse bug óbvio no primeiro uso.
- **Regressão a cobrir**: o commit `21cfc40` adiciona `TestClaudeModelConfigOptions` (3 unidade + 3
  integração, com `sonnet/high`, `sonnet` puro e `sonnet/ultrafast`) — bom, mas **não cobre o caminho
  `_meta`**, que é justamente o que ficou de fora. Faltam: (a) teste de `build_session_model_meta`
  para `claude-code` com id combinado; (b) teste que garanta que **todo** caminho que leva `acp_model`
  ao wrapper aplique o mesmo split (senão a correção de um caminho só recria o bug pelo outro);
  (c) smoke-test de conversa `claude-code` que confirme que o turno **inicia** com um `acp_model` de
  effort — e que o effort **chegou** (o modo silencioso passaria nesse teste sem aplicar nada);
  (d) gate de processo que impeça habilitar na UI uma capacidade cujo backend é uma versão ainda não
  publicada.
- **Alternativas descartadas**:
  - **Conta sem acesso a `sonnet`** — descartada: `sonnet` puro funciona e o erro é simétrico em quem
    falha; permissão não produziria `model_not_found` para um id que o picker do próprio CLI lista.
  - **`claude-agent-acp` antigo demais** — descartada: o SDK 1.46.0 já pina
    `CLAUDE_AGENT_ACP_VERSION = "0.63.0"` (`acp_install_catalog.py:105`), que **tem** o option
    `effort`; o `strace` comprova que o wrapper estava vivo e respondendo.
  - **Bug de infraestrutura de deploy (assets 404 / cache do `sirv`)** — descartada: é o incidente de
    tela branca, já fichado em `docs/bugs/deploy-tela-branca-assets-404/`; aqui o app carrega, o
    JSON-RPC trafega e a falha é do CLI.
  - **Falta de deploy do frontend** — descartada: `5d9f301` é ancestral do HEAD e está no bundle.
  - **Validação de schema JSON-RPC / cache / concorrência / lock** — descartadas pelo tracer
    dinâmico: a chamada chega bem-formada e a reprodutibilidade é 5/5 sem variação.

## Comparação com o LionCodeLabs (pedido do usuário)

O usuário apontou `https://github.com/LionLabsCommunity/LionCodeLabs` como referência de "effort
funcionando com assinatura do Claude". O repositório está clonado nesta máquina em `/tmp/lioncode`
(commit `71982ff`, "LionCode v1.5 Stable"). O que ele faz, e por que funciona:

- **O effort é um campo próprio no protocolo, nunca parte do model id.** Em
  `packages/server/src/providers/deepseek-acp.ts:806-817` o effort vai no
  `_meta.lioncode.reasoningEffort` do `newSession`/`loadSession`, e em `:857-868` é enviado **junto
  do modelo, como campo separado**, na mesma chamada
  (`extMethod('session/set_model', { sessionId, modelId, reasoningEffort })`). O plugin ACP
  (`dsh-plugin/src/acp-agent.ts:412-421`) consome `meta.reasoningEffort`. Ou seja: a string
  `"sonnet/medium"` **nunca** trafega como nome de modelo — não há o que o CLI interpretar errado.
- **No driver nativo Claude ele usa o Claude Agent SDK, não ACP.**
  `packages/server/src/providers/claude-agent.ts:1440` passa `{ effort }` como **opção de primeira
  classe** do `query()` do `@anthropic-ai/claude-agent-sdk` (`^0.3.177`). `effortFor()` (`:163-181`)
  mapeia low/medium/high direto e colapsa `extra-high`→`xhigh`, `max`/`ultra`→`max`,
  `ultrathink`→`undefined` (sem effort, via prefixo `Ultrathink:` no prompt).
- **Níveis beyond-high como categoria compartilhada**, em `shared/src/reasoning.ts`
  (`BeyondHighLevel`, `BEYOND_HIGH_LEVELS`, `isBeyondHigh`).
- **Assinatura sem API key por desenho**: `shared/src/models.ts:59` marca `subscription` =
  "CLI/assinatura ([CC], Codex) — sem API key", e `claude-agent.ts:1271-1302` monta o
  `env`/`billingMode` por turno.

**O que isso confirma para o nosso caso**: o princípio correto é sempre **(modelo, effort)
separados**; o Claude CLI aceita effort de primeira classe (`--effort <level>`, confirmado neste
host); e nunca se deve transportar `<model>/<effort>` como id de modelo. O split do commit `21cfc40`
é a implementação correta desse princípio **dentro da arquitetura do OpenHands** (onde o Canvas fala
ACP e o SDK já usa `set_config_option` para o Codex). Portanto o LionCodeLabs **não aponta para uma
solução arquitetural diferente** — aponta para o que já está escrito, não publicado e (nosso achado)
incompleto. A contribuição real da referência é a **confirmação independente do mecanismo**: effort é
campo separado, não sufixo de modelo.

## VERIFICAÇÃO PENDENTE (não executada — exige aprovação)

- [ ] Confirmar por reprodução ao vivo que, com o SDK contendo `21cfc40` **e** o split no caminho
      `_meta`, `sonnet/medium` inicia o turno e o effort é efetivamente aplicado.
- [ ] Decidir entre a rota "publicar release" e a rota "apontar `uvx` para o fork/commit".

## DESFECHO

Ficha **aprovada** pelo usuário em 2026-09-14. Correção especificada em
[`SPEC.md`](./SPEC.md) e implementada:

- **SDK** (`JoaoNetoDev/software-agent-sdk`, commit `690243e`): o split do id combinado passou a
  valer também para o caminho `_meta` da criação de sessão, via `_model_id_for_session_meta`, que
  reaproveita `_model_config_options` para manter uma única regra de split. 553 testes verdes,
  `ruff check`/`format` limpos.
- **Deploy**: `OH_AGENT_SERVER_LOCAL_PATH=/opt/software-agent-sdk-fix` em `/etc/default/openhands`
  (backup em `/etc/default/openhands.bak-20260914062125`). A rota foi o knob de checkout local, e
  não o de git ref, porque o launcher tem o repo upstream **hardcoded** (ver §4 da SPEC).
- **Restart ficou a cargo do usuário** — o `agent-server` que hospeda a própria sessão de
  diagnóstico é filho do `openhands.service`; reiniciar de dentro mataria o agente no meio da
  tarefa (ver §4.1 da SPEC).
- **Aberta**: verificação dos CA-08/CA-09 após o restart, e PR upstream para que um release oficial
  carregue a correção (aí a linha de env sai).

# PRD — sistema-settings-menu

## 1. Problema e evidência

O Agent Canvas tem hoje um menu de settings (`src/constants/settings-nav.tsx:15-68`) com entradas para Agent, LLM, Condenser, Agent Context, Verification, Application e Secrets. Nenhuma dessas telas centraliza a configuração usada como ponto de partida de um novo fluxo de planejamento de features (o board Kanban de 3 níveis descrito nos sub-projetos seguintes desta decomposição): **qual workspace o board usa por padrão**, **qual perfil de LLM roda os cards de agente por padrão**, e **qual contexto global do usuário** deve ser injetado em toda tarefa criada ali.

Hoje existem peças soltas mas nenhuma delas cobre isso:
- Workspace é só selecionado por conversa (`src/components/features/home/workspace-dropdown/*`), sem noção de "workspace padrão do sistema".
- LLM tem perfis nomeados (`src/routes/llm-settings.tsx`), e a única "escolha padrão" existente hoje é `title_llm_profile`, usada só para gerar título de conversa (`src/routes/app-settings.tsx:112,232-248`; `src/types/settings.ts:155`) — não existe um perfil padrão para outros fluxos.
- `agent_context` (`src/routes/agent-context-settings.tsx:1-12`) hoje só expõe `agent_context.load_memory`, um toggle booleano vindo do schema do backend (`src/mocks/settings-handlers.ts:364-386`) — não há campo de texto livre para contexto do usuário.

Sem essa tela, cada sub-projeto seguinte da decomposição (kanban de 3 níveis, contexto por card, integração com o pipeline featdevelop) não tem onde ler configuração padrão, e o usuário teria que repetir escolhas de workspace/modelo/contexto em cada card.

## 2. Usuários e cenários de uso

- **Usuário único do Agent Canvas local** (persona única do produto hoje — não há multi-tenant nesta tela) que:
  1. Abre `/settings/system` pela primeira vez, escolhe um workspace local já cadastrado como padrão, escolhe um perfil de LLM já configurado como padrão, e escreve um contexto global (ex.: convenções do time, stack, preferências de comunicação).
  2. Revisita a tela depois para trocar o workspace padrão ao começar a trabalhar em outro repositório.
  3. Deixa o campo de contexto global vazio inicialmente e o preenche depois, sem que isso quebre nada que já dependa dele.

## 3. Objetivos e não-objetivos

**Objetivos**
- Adicionar uma entrada "Sistema" ao menu de settings, seguindo o padrão visual e de rota já usado pelas entradas existentes.
- Permitir configurar e persistir: workspace padrão, perfil de LLM padrão, contexto global do usuário (HTML).
- Os três valores ficam disponíveis via `useSystemSettings()` (hook novo, local — ver fase TECH) para os sub-projetos seguintes consumirem (board Kanban e cards).

**Não-objetivos**
- Não implementa o board Kanban em si (sub-projeto `kanban-3-niveis`).
- Não implementa contexto por card, anexos de arquivo, nem sinterização em `.md` (sub-projeto `kanban-card-contexto-arquivos`).
- Não implementa a integração com o pipeline featdevelop (sub-projeto `kanban-pipeline-featdevelop`).
- Não cria um editor WYSIWYG completo (barra de formatação extensa, tabelas, imagens embutidas) — o campo de contexto global é um editor rich-text mínimo (negrito, itálico, listas, links) que persiste como string HTML. Ampliações de formatação ficam fora de escopo.
- Não adiciona suporte a múltiplos workspaces/perfis padrão por projeto — é um único padrão global por instalação local do Canvas.
- Não migra `title_llm_profile` para reutilizar o novo "perfil de LLM padrão" — os dois propósitos continuam distintos (geração de título de conversa vs. execução de cards de agente), evitando acoplar semânticas diferentes ao mesmo campo.

## 4. Requisitos funcionais

- **RF-01**: O menu de settings exibe uma entrada "Sistema" entre as entradas existentes, roteando para `/settings/system`, visível em modo OSS local.
- **RF-02**: A tela "Sistema" lista os workspaces locais já cadastrados (via `useLocalWorkspaces()`, `src/hooks/query/use-local-workspaces.ts:13-25`) num dropdown e permite marcar um deles como "workspace padrão".
- **RF-03**: A tela "Sistema" lista os perfis de LLM já cadastrados (via o mesmo hook usado em `app-settings.tsx:36-37`, `useLlmProfiles()`) num dropdown e permite marcar um deles como "perfil de LLM padrão".
- **RF-04**: A tela "Sistema" expõe um editor de texto rico mínimo (negrito, itálico, listas, links) para "contexto global do usuário", implementado como componente próprio baseado em `contentEditable` (sem adicionar biblioteca de rich-text nova ao projeto — nenhuma existe hoje em `package.json`), cujo valor é persistido como string HTML sanitizada com `dompurify` (já uma dependência do projeto, `package.json:190`) antes de salvar e antes de renderizar.
- **RF-05**: Salvar a tela persiste os três valores em `localStorage`, seguindo o padrão já usado por outras preferências locais do Canvas que não pertencem ao contrato de settings do agent-server (`src/utils/workspace-mode.ts:18-31`, `src/themes/color-themes.ts:197-208`, `src/components/features/onboarding/use-onboarding-completion.ts:14,45`). Feedback de sucesso via toast, com o mesmo padrão visual de `app-settings.tsx:115-122` (sem chamada de rede — não há `onError` de request).
- **RF-06**: Se nenhum workspace ou perfil de LLM estiver cadastrado ainda, os respectivos dropdowns mostram um estado vazio com link para a tela de cadastro correspondente (workspaces → home; LLM → `/settings/llm`, reproduzindo o padrão do link em `app-settings.tsx:249-254`).
- **RF-07**: Ao excluir o workspace ou perfil de LLM marcado como padrão em suas telas de origem, a tela "Sistema" trata o padrão como não definido (mesmo tratamento de "perfil apagado" já usado em `app-settings.tsx:55-61` para `title_llm_profile`), sem erro.

## 5. Requisitos não-funcionais

- **RNF-01 (segurança/privacidade)**: o campo de contexto global HTML nunca é renderizado via `dangerouslySetInnerHTML` com o valor bruto — todo HTML do usuário passa por `dompurify` (já dependência do projeto, `package.json:190`) tanto ao salvar quanto ao exibir, para não abrir XSS armazenado.
- **RNF-02 (acessibilidade)**: os três campos seguem o padrão de rótulo/associação já usado pelos componentes `SettingsDropdownInput`/`SettingsInput` (mesma acessibilidade herdada).
- **RNF-03 (performance)**: a tela não deve bloquear no carregamento — usa o mesmo padrão de skeleton dos demais formulários de settings (`AppSettingsInputsSkeleton`, `app-settings.tsx:20,186`) enquanto workspaces/perfis carregam.
- **RNF-04 (observabilidade)**: como o salvamento é local (sem request de rede), a única falha possível é `localStorage` indisponível/cheio — tratada com `try/catch` ao redor do `setItem` e toast de erro, sem novo mecanismo de log.
- **RNF-05 (i18n)**: todos os textos visíveis usam chaves novas em `src/i18n/translation.json` e `src/i18n/declaration.ts`, seguindo a convenção `SETTINGS$NAV_*` / `SETTINGS$PAGE_*_SUBLINE` já usada pelas demais entradas de `settings-nav.tsx`.

## 6. Métricas de sucesso

- 100% das configurações (workspace padrão, perfil padrão, contexto global) persistem corretamente entre reloads da aplicação (verificável por teste de integração).
- Zero regressão nas telas de settings existentes (suite de testes atual permanece verde).
- Os três valores ficam legíveis por `useSystemSettings()` nos sub-projetos seguintes sem exigir nova infraestrutura de API (validação indireta: o hook é importado e consumido em pelo menos um teste do sub-projeto `kanban-3-niveis`).

## 7. Escopo de release e faseamento

Release único, sem faseamento interno — é a menor unidade útil (adicionar a tela sem os três campos não entrega valor sozinho). Fica pronto antes do sub-projeto `kanban-3-niveis`, que passa a poder ler o workspace/perfil padrão.

## 8. Riscos de produto e questões em aberto

- **Decisão de persistência**: `misc_settings` (`src/api/settings-service/settings-service.api.ts:19-50`) é tecnicamente um contêiner opaco no SDK do agent-server — seria possível adicionar uma categoria nova ali sem mudar o backend. Ainda assim, esta feature usa `localStorage` (preferência **local ao navegador**, sem sync entre máquinas) por decisão de escopo v1: evita tocar a extração/leitura de settings compartilhada por todas as outras telas (detalhado na fase TECH) para um requisito que não pede sincronização entre dispositivos. Revisável em versão futura se sync se tornar necessário.
- **Questão em aberto (assumida por padrão, revisitável)**: o "perfil de LLM padrão" desta tela é deliberadamente uma preferência local nova (não um alias de `title_llm_profile`), para não misturar semânticas de geração de título com execução de cards de agente.
- **Risco de escopo**: como esta tela é a base para os 3 sub-projetos seguintes, qualquer mudança de nome de campo aqui propaga para os demais PRDs/TECHs — os nomes de campo definidos na fase TECH deste sub-projeto devem ser tratados como contrato estável antes de iniciar o sub-projeto 2.

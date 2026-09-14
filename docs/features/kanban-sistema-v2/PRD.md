# PRD — kanban-sistema-v2 (revisão pós-QA)

## 1. Problema e evidência

QA visual do projeto `sistema-settings-menu`/`kanban-*` (4 sub-projetos, 12 sprints, já integrados) revelou 5 lacunas de produto que os testes automatizados não capturam porque são de arquitetura/UX, não de comportamento unitário:

1. "Sistema" está enterrado em `/settings/system`, um item igual aos outros dentro de Configurações (`src/constants/settings-nav.tsx:15-68`) — sem relação visual com o backend/tenant ativo, hoje selecionado por `BackendSelector` no rodapé da sidebar (`src/components/features/sidebar/sidebar-rail-body.tsx:400`, dentro do bloco `!collapsed` que também renderiza `AgentCanvasVersionTile`, linhas 388-402).
2. O dropdown "Workspace padrão" só lista workspaces **já cadastrados** — não há como criar um workspace novo sem sair da tela (o fluxo de criação vive na Home, fora do Sistema).
3. O board é **1 por workspace**, fixo — não existe o conceito de múltiplos quadros (por módulo/segmento) dentro de um workspace.
4. Nenhum nível do board (quadro ou tarefa) tem checklist — só texto rico e anexos.
5. O dropdown "Perfil de LLM padrão" lista perfis por nome sem indicar o provedor (ACP Claude Code / ACP Codex / ACP OpenHands + N provedores) — o app já tem essa camada (`getAcpProvider` em `src/constants/acp-providers.ts`, `useActiveAcpProfileDetail` em `src/hooks/query/use-active-acp-profile-detail.ts`), mas o Sistema não a usa.

Além disso, o usuário pediu uma mudança de fluxo mais profunda: hoje o board só é lido/escrito pelo **navegador** (`localStorage`, Zustand `persist` — `src/stores/kanban-board-store.ts`). Um agente rodando numa conversa (server-side, no agent-server) não tem acesso a esse estado — ele só pode escrever `.md` no workspace via `execute_bash_command` (sub-projeto `kanban-card-contexto-arquivos`). Para o agente **mover cards** (marcar como "pendente de validação"), o board precisa parar de viver só no navegador.

## 2. Usuários e cenários de uso

- Usuário abre o app, escolhe/troca o backend (Local/Cloud) no rodapé da sidebar, e vê logo abaixo um item "Sistema" específico daquele backend.
- Dentro de Sistema, sem sair da tela: cria um workspace novo (mesmo fluxo de pasta/repo já usado na Home), escolhe o perfil de LLM padrão já indicando o provedor (ex. "Claude Code — claude-sonnet-5" vs "Codex — gpt-5-codex" vs "OpenHands — anthropic/claude-sonnet-5"), e edita o contexto global.
- Usuário entra num workspace e vê uma lista de **quadros** (ex. "Backend", "Frontend", "Infra") em vez de um board único; cria um quadro novo, entra nele, e vê a árvore de 3 níveis já existente dentro daquele quadro.
- Usuário (ou a própria IA) adiciona um checklist a um card em qualquer nível (quadro ou tarefa), marca itens.
- IA termina o trabalho de uma tarefa dentro de uma conversa `/featdevelop` → move o card para "Aguardando validação" (não "Concluído") chamando uma ferramenta/ação que grava isso no board persistido no servidor. Humano abre o card, vê o resultado, aprova (arquiva) ou reprova (escreve o motivo, o card volta para "A Fazer"/"Em Andamento" com a anotação de rejeição visível pra IA retomar).
- Ao montar a mensagem inicial da conversa do agente, o app não deve despejar o board inteiro no prompt — só o necessário (título, descrição, contexto do card); o resto (outros cards, outros quadros) fica disponível para o agente ler sob demanda via o mesmo arquivo/API que o frontend usa.

## 3. Objetivos e não-objetivos

**Objetivos**
- "Sistema" promovido a item fixo na sidebar principal, abaixo do seletor de backend, contextual ao backend ativo.
- Criação de workspace embutida na tela de Sistema (reaproveitando o fluxo existente, não um formulário novo).
- Perfil de LLM padrão mostra e permite escolher o provedor (ACP Claude/Codex/OpenHands + N provedores cadastrados).
- Quadros como camada de agrupamento: N quadros por workspace, cada um com sua própria árvore de 3 níveis (reaproveitando tudo que já existe: colunas, cards, drag-and-drop, contexto, anexos, sinterização).
- Checklist por nível (quadro ou tarefa), qualquer profundidade.
- Board migra de `localStorage`-only para um arquivo persistido no workspace (`.openhands/kanban/<workspaceId>/board.json`), lido/escrito pelo frontend via o mesmo mecanismo seguro já construído (`execute_bash_command` + base64 + escape) — o mesmo arquivo é a fonte de verdade que um agente, dentro da sua própria conversa (que já tem acesso a shell/arquivo no workspace), pode ler e editar diretamente.
- Coluna "Aguardando validação" distinta de "Concluído"; "Concluído" só é alcançado por ação humana explícita (aprovar); reprovar exige uma anotação de motivo e devolve o card para uma coluna de trabalho.
- Mensagem inicial da conversa do agente inclui só o card em questão (título/descrição/contexto), não o board inteiro — o resto é lido sob demanda pelo próprio agente via o arquivo `board.json`/os `.md` já sinterizados.

**Não-objetivos (desta revisão)**
- Não implementa um editor de checklist rico (sem sub-itens aninhados, sem atribuição de responsável) — é uma lista plana de itens texto+checkbox.
- Não implementa sincronização em tempo real entre múltiplas abas/usuários vendo o mesmo board simultaneamente — leitura é sob demanda (refresh manual ou ao reabrir), como já era no `feature-docs-panel`.
- Não migra o board para um banco de dados/backend dedicado — continua sendo um arquivo no workspace, não uma tabela numa API REST nova.
- Não implementa múltiplos backends (Cloud) escrevendo no mesmo arquivo simultaneamente — a escrita via `execute_bash_command` só funciona local (mesma limitação já documentada em `kanban-card-contexto-arquivos`); em Cloud, o board **volta a ser local ao navegador** até uma revisão futura resolver o acesso ao workspace sem conversa.

## 4. Requisitos funcionais

- **RF-01**: item "Sistema" aparece na sidebar principal (não em Configurações), imediatamente abaixo do `BackendSelector`, dentro do rodapé fixo da sidebar (o mesmo bloco onde hoje só há `AgentCanvasVersionTile` + `BackendSelector`).
- **RF-02**: acessar "Sistema" abre a mesma tela `/settings/system` já existente (rota reaproveitada — não duplica lógica), agora também alcançável pelo atalho da sidebar.
- **RF-03**: dropdown "Workspace padrão" tem uma opção "+ Criar workspace" que abre o mesmo modal/fluxo de criação já usado na Home; workspace criado aparece selecionado automaticamente.
- **RF-04**: dropdown "Perfil de LLM padrão" mostra, para cada perfil, o provedor de origem (ACP Claude Code / ACP Codex / ACP OpenHands / provedor padrão OpenHands) ao lado do nome; a lista é agrupada ou rotulada por provedor.
- **RF-05**: um workspace tem N quadros (`KanbanBoard { id, name, workspaceId, createdAt }`); tela de listagem de quadros (`/board`) mostra os quadros do workspace ativo com criar/renomear/excluir.
- **RF-06**: abrir um quadro (`/board/:boardId`) mostra a árvore de 3 níveis já existente, agora escopada a `boardId` em vez de `workspaceId` diretamente.
- **RF-07**: qualquer nível (quadro, card de qualquer profundidade) pode ter uma checklist (lista de `{ id, text, done }`); UI de adicionar/marcar/remover item.
- **RF-08**: o board (quadros + árvore de tarefas de cada um) persiste em `.openhands/kanban/<workspaceId>/board.json` no workspace, escrito/lido via o mecanismo seguro já existente (base64 + `escapeSingleQuoted`, sem inventar novo transporte); `localStorage` deixa de ser a fonte de verdade (pode continuar como cache local de leitura, nunca como única cópia).
- **RF-09**: card ganha uma 4ª coluna implícita de estado — "Aguardando validação" — atingível por uma ação que o agente pode executar de dentro da sua própria conversa. **Premissa não verificada, tratada como risco em aberto (seção 8), não como fato assumido**: espera-se que o agente edite `board.json` usando os tools de shell/arquivo que já tem no sandbox da conversa, seguindo um contrato de schema documentado no prompt inicial — mas essa escrita, feita pelo próprio agente, **não passa pelo caminho sanitizado do frontend** (RNF-01 só cobre leitura/escrita feitas pelo navegador via `execute_bash_command`); o frontend deve tratar `board.json` como entrada não confiável ao ler de volta (validar schema, nunca `eval`/`dangerouslySetInnerHTML` sobre o conteúdo), já que ele pode ter sido escrito por um processo fora do controle desta feature.
- **RF-10**: humano abre um card em "Aguardando validação" e vê duas ações: Aprovar (move para "Concluído", arquivado) ou Reprovar (exige texto do motivo, grava como anotação de rejeição no card, devolve o card para "Em Andamento").
- **RF-11**: a mensagem inicial de `startFeatdevelopConversation` (`buildFeatdevelopInitialMessage`, `src/api/kanban-pipeline.api.ts`) já só serializa título/descrição/contexto do card acionado, não o board inteiro — este RF é uma checagem de regressão explícita (garantir que a introdução de `board.json`/múltiplos quadros não regrida isso), não uma funcionalidade nova a construir.

## 5. Requisitos não-funcionais

- **RNF-01 (segurança)**: toda leitura/escrita de `board.json` pelo frontend segue exatamente o padrão já auditado (base64, `escapeSingleQuoted`, `dirname` entre aspas duplas, revalidação de slug/path) — zero exceção nova à disciplina de sanitização já estabelecida.
- **RNF-02 (compatibilidade)**: cards/boards criados antes desta revisão (só em `localStorage`, sem `boardId`) são migrados automaticamente para um quadro "Padrão" na primeira leitura, sem perda de dados.
- **RNF-03 (context budget)**: a mensagem inicial de conversa nunca deve crescer proporcionalmente ao número de cards do workspace — tamanho é função só do card acionado.
- **RNF-04 (i18n)**: convenção do projeto, chaves novas nos 15 locales.

## 6. Métricas de sucesso

- Teste de integração navega da sidebar até `/settings/system` sem passar por `/settings` (confirma RF-01/02 sem depender de contagem de cliques em produção, que não é medível em CI).
- Teste de integração: criar workspace a partir do dropdown do Sistema resulta em um novo `LocalWorkspace` persistido e selecionado, sem navegação de rota.
- Teste de integração: dois quadros do mesmo workspace, com tarefas de mesmo `level`/`order`, nunca aparecem misturados na leitura de `getChildren`/`getBoardTasks` (isolamento por `boardId`, não só por `workspaceId`).
- Teste de integração: reprovar um card grava `rejectionReason` no card e sua `columnId` deixa de ser `"pending_validation"`.
- Teste de unidade: `buildFeatdevelopInitialMessage` para um workspace com 50 cards simulados produz uma mensagem cujo tamanho não varia com o número de cards (só com os dados do card acionado) — regressão explícita do RNF-03.

## 7. Escopo de release e faseamento

Depende de tudo que já foi construído (`sistema-settings-menu`, `kanban-3-niveis`, `kanban-card-contexto-arquivos`, `kanban-pipeline-featdevelop`) — é uma revisão em cima, não substitui nada do que passou na validação anterior. Ordem de implementação: RF-08 (persistência em arquivo) é pré-requisito de RF-09/RF-10/RF-11 (fluxo de validação); RF-05/RF-06 (múltiplos quadros) é pré-requisito de RF-07 aplicado a quadro; RF-01/02/03/04 são independentes do resto.

## 8. Riscos de produto e questões em aberto

- **Risco de migração de dado**: mover a fonte de verdade de `localStorage` para arquivo é uma mudança de armazenamento em produção (ainda que "produção" aqui seja local) — RNF-02 cobre isso com migração automática na leitura, mas é o ponto de maior risco de regressão silenciosa.
- **Risco de concorrência arquivo**: se o humano estiver editando o board no navegador ao mesmo tempo que o agente edita `board.json` via shell, a última escrita vence (sem lock/merge) — aceito conscientemente nesta revisão (documentado como não-objetivo de tempo real), mas deve ficar visível ao usuário ("atualizado por último em...").
- **Questão em aberto (assumida)**: o agente edita `board.json` diretamente com os tools de shell que já tem na conversa (não uma ferramenta MCP nova) — o "contrato" é documentado na mensagem inicial da conversa (schema do JSON, caminho do arquivo, e a instrução explícita "mova o card para status `pending_validation` quando terminar, escrevendo o campo `columnId` do card correspondente"). Simples de implementar (reaproveita 100% do sandbox do agente), mas depende do agente seguir a instrução corretamente — sem validação de schema forçada no momento da escrita do agente (só na leitura do frontend, que pode rejeitar/ignorar campos inválidos).

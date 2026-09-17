# SPEC — AIK: front de sistemas em kanban hierárquico

Slug: `aik-kanban-sistemas` · Depende de: `PRD.md`, `TECH.md` (ambos aprovados)
Status: fase 3 de `/featdevelop` — aguardando aprovação

---

## 1. Resumo e escopo

Constrói o AIK dentro do repositório atual (`/opt/openhands`), servido em
`aik.zadotec.com.br` por um segundo vhost Apache idêntico ao existente
(sem reescrita de path), com a escolha entre "Agent Canvas atual" e "AIK"
feita no cliente por `window.location.hostname` (TECH §2.1).

Escopo desta SPEC: **Release 1 (esqueleto navegável) + Release 2
(execução) + Release 3 (conversa) + Release 4 (publicação)** do PRD §7,
como um único conjunto de critérios de aceitação — a quebra em sprints
executáveis fica pra fase seguinte do pipeline (`/featbuild`), não aqui.

Fora de escopo (herdado do PRD §3): fila de runs com custo (N1), quarto
nível de baia (N2), remoção do front atual (N3), multiusuário (N4), migração
do `board.json` existente (N5), app desktop do AIK (N6).

---

## 2. Desenho detalhado por componente

### 2.1 Roteamento — `host-gate.tsx`, `aik-routes.tsx`

`src/routes.ts` passa a ter uma única entrada de topo:

```ts
export default [
  route("*", "routes/host-gate.tsx"),
] satisfies RouteConfig;
```

A árvore de rotas do Agent Canvas atual (hoje inteira em `src/routes.ts:8-49`)
é movida, sem alteração de conteúdo, para um componente próprio:

```ts
// src/routes/agent-canvas-app.tsx
export function AgentCanvasApp(): JSX.Element {
  // Renderiza via <Routes> imperativo a MESMA árvore de rotas que hoje
  // vive em routes.ts:8-49 (root-layout + todas as rotas filhas),
  // usando os componentes de rota existentes sem modificação.
}
```

```ts
// src/routes/host-gate.tsx
const AIK_HOSTNAMES = ["aik.zadotec.com.br"]; // TECH §2.1 — lido 1x no mount

export default function HostGate(): JSX.Element {
  const isAik = React.useMemo(
    () => AIK_HOSTNAMES.includes(window.location.hostname),
    [],
  );
  return isAik ? <AikRoutes /> : <AgentCanvasApp />;
}
```

```ts
// src/routes/aik/aik-routes.tsx
export function AikRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<AikLayout />}>
        <Route index element={<AikSystemsBoard />} />
        <Route path=":systemId" element={<AikPhasesBoard />} />
        <Route
          path=":systemId/fases/:phaseId"
          element={<AikTasksBoard />}
        />
      </Route>
    </Routes>
  );
}
```

`AikLayout` (`src/routes/aik/aik-layout.tsx`) renderiza `<AikBreadcrumb/>` +
`<Outlet/>` + `<AikConversationPanel/>` (painel lateral, TECH §2.5),
mantido montado entre navegações internas do AIK (não remonta ao trocar de
fase/tarefa, só ao trocar `systemId`).

**Risco de implementação, com spike obrigatório antes do build** (achado do
validador adversarial, F-SPEC-5): `react-router@7.18.2` exporta
`Routes`/`Route`/`useParams`/`useNavigate` (confirmado em
`node_modules/react-router/dist/development/index.d.ts`), e o app monta via
`HydratedRouter` — um data router de framework mode
(`src/entry.client.tsx:7,44`). `<Routes>` aninhado dentro de um elemento
renderizado por um data router é, em princípio, suportado (usa `useRoutes`/
`useLocation` do contexto de router ambiente, sem exigir um segundo
`<Router>`), mas **não existe nenhum uso desse padrão hoje no repositório**
(`grep -rln "<Routes" src/` não retorna resultado algum) — não há precedente
que prove o comportamento de matching de `route("*", "routes/host-gate.tsx")`
(um splat que consome o pathname inteiro) combinado com os paths relativos
`/`, `:systemId`, `:systemId/fases/:phaseId` declarados dentro de
`AikRoutes`. **Antes de qualquer sprint de `/featbuild` tocar `host-gate.tsx`,
a primeira tarefa deve ser um spike isolado**: montar `HostGate` com uma
única rota trivial dentro de `AikRoutes` e confirmar, num navegador real,
que `useParams` resolve `:systemId` corretamente e que navegação por
`useNavigate` dentro do splat não interfere com o histórico do
`AgentCanvasApp`. Se o spike falhar, a alternativa de fallback é registrar
as rotas do AIK como entradas normais de `src/routes.ts` (mesma árvore file
routes do Agent Canvas) sob um path reservado (ex.: `/__aik/*`) com
`host-gate.tsx` decidindo apenas se redireciona `/` para lá — mais rotas
"conhecidas" do framework, ao custo de um path visível na URL do AIK que a
decisão original em §2.1 tentava evitar.

### 2.2 Tipos — `src/types/aik.ts`

Exatamente como definido em TECH §3 (`AikColumnId`, `AikSystemColumnId`,
`AikWorkspaceRef` discriminado, `AikSystem`, `AikPhase`, `AikTask`,
`AikTimelineEntry`, `AikSystemFile`). Import de `KanbanChecklistItem` de
`src/types/kanban.ts:22`, sem redefinição.

### 2.3 Store — `src/stores/aik-board-store.ts`

Assinatura completa (TECH §4.1 detalhado com tipos de retorno e efeitos
colaterais):

```ts
interface AikBoardState {
  systems: AikSystem[];
  phasesBySystemId: Record<string, AikPhase[]>;
  tasksBySystemId: Record<string, AikTask[]>;
  errorBySystemId: Record<string, { errorType: AikErrorType; detail: string } | undefined>;
}

type AikErrorType =
  | "backend_down"
  | "workspace_unreachable"
  | "cloud_unsupported"
  | "conflict"
  | "parse_error";

interface AikBoardActions {
  createSystem(input: {
    name: string;
    backendId: string;
    workspaceRef: AikWorkspaceRef;
  }): AikSystem;
  renameSystem(systemId: string, name: string): void;
  moveSystem(systemId: string, toColumnId: AikSystemColumnId): void;
  deleteSystem(systemId: string): void;

  createPhase(systemId: string, title: string): AikPhase;
  renamePhase(phaseId: string, title: string): void;
  deletePhase(phaseId: string): void;

  createTask(
    phaseId: string,
    input: { title: string } & Partial<
      Omit<AikTask, "id" | "phaseId" | "systemId" | "timeline" | "createdAt" | "updatedAt">
    >,
  ): AikTask;
  updateTask(taskId: string, patch: Partial<AikTask>): void;
  moveTask(taskId: string, toColumnId: AikColumnId, toOrder: number): void;
  deleteTask(taskId: string): void;

  startAgent(
    taskId: string,
  ): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }>;
  stopAgent(taskId: string): Promise<void>;
  approveTask(taskId: string): void;
  returnTask(taskId: string, feedback: string): void;
  addComment(taskId: string, text: string): void;

  syncFromFile(systemId: string): Promise<void>;
  startPolling(systemId: string): () => void; // devolve stop(); TECH §2.3
}
```

Comportamentos obrigatórios (verificados pelos critérios de aceitação §6):

- `moveTask` reindexação de irmãos usa `reindexAfterMove` de
  `src/utils/kanban-tree.ts:33`, adaptado por `phaseId` no lugar de
  `parentId` (a tarefa nunca tem filhos no AIK — não é usado
  `collectDescendantIds`).
- `createTask`/`updateTask`/`moveTask`/`deleteTask` recalculam a coluna da
  fase-pai segundo as regras (a)-(e) do TECH §3 (RF-09), como efeito
  colateral síncrono da mesma chamada — nunca uma ação separada que o
  chamador precisa lembrar de disparar.
- `startAgent(taskId)`: se `system.activeAgentTaskId` já está preenchido com
  outro `taskId`, devolve `{ok:false, error:"already_running"}` **sem**
  chamar `AgentServerConversationService` (falha local, sem round-trip).
  Em sucesso: seta `task.linkedConversationId`, `task.columnId =
  "in_progress"`, `system.activeAgentTaskId = taskId`, adiciona
  `AikTimelineEntry{kind:"run_started"}`.
- `stopAgent(taskId)`: chama a API de abortar run (mesmo mecanismo de
  parada de conversa já existente no runtime — não uma API nova), zera
  `system.activeAgentTaskId`, move a tarefa para o topo de `backlog`
  (`order = -1` normalizado por reindex), adiciona
  `AikTimelineEntry{kind:"run_stopped"}`.
- `approveTask(taskId)`: só é permitido quando `task.columnId ===
  "in_review"`; move para `done`, adiciona
  `AikTimelineEntry{kind:"status_change", fromColumnId:"in_review",
  toColumnId:"done"}`.
- `returnTask(taskId, feedback)`: só permitido quando `task.columnId ===
  "in_review"`; move para `in_progress`, adiciona
  `AikTimelineEntry{kind:"review_feedback", text: feedback}`, e entrega o
  feedback na MESMA conversa vinculada (`task.linkedConversationId`) via
  envio de mensagem — não cria conversa nova (RF-20).
- `syncFromFile(systemId)`: no-op silencioso se
  `workspaceRef.kind === "cloud"` (não seta erro — é estado normal, não
  falha). Se `workspaceRef.kind === "local"`: lê o arquivo (§2.4), faz merge
  por card usando `updatedAt` mais recente por `id` (mesmo algoritmo de
  `mergeBoardFiles`, `kanban-board-file.api.ts:116-146`, adaptado ao schema
  do AIK), e popula `errorBySystemId[systemId]` em caso de falha, sem
  lançar.
- `startPolling(systemId)`: cria `setInterval` de 4000ms chamando
  `syncFromFile(systemId)`, pausado quando `document.visibilityState !==
  "visible"` (listener de `visibilitychange`), devolve função de limpeza.
  Chamado no mount de `AikLayout`, parado no unmount ou troca de
  `systemId`.

### 2.4 Persistência de arquivo — `src/api/aik-board-file.api.ts`

```ts
export function buildAikFilePath(workspacePath: string): string {
  return `${workspacePath}/.openhands/aik/system.json`;
}

export async function readAikSystemFile(
  workspacePath: string,
): Promise<{ ok: true; file: AikSystemFile } | { ok: false; errorType: AikErrorType }>;

export async function writeAikSystemFile(
  workspacePath: string,
  file: AikSystemFile,
): Promise<{ ok: true } | { ok: false; errorType: AikErrorType }>;

export function mergeAikSystemFiles(
  local: AikSystemFile,
  remote: AikSystemFile,
): AikSystemFile;
```

Implementação: mesmo mecanismo de `kanban-board-file.api.ts` — `cat --
<path>` e `buildWriteFileCommand` via
`AgentServerRuntimeService.executeCommand` (TECH §1.6/§2.3). `readAikSystemFile`
devolve `{ok:false, errorType:"cloud_unsupported"}` imediatamente quando
`getActiveBackend().backend.kind === "cloud"`, sem tentar o comando (mesmo
guard de `kanban-board-file.api.ts:162-164`). `mergeAikSystemFiles` funde
`phases`/`tasks` por `id`, mantendo a versão com `updatedAt` mais recente de
cada uma — item presente só num dos dois lados é mantido (nunca descartado
por estar ausente do outro lado). Precisão sobre o que é reaproveitado
(achado do validador adversarial, F-SPEC-7): `mergeBoardFiles`
(`kanban-board-file.api.ts:116-146`) na verdade tem **dois** algoritmos, não
um — para `tasksByBoardId` (linhas 125-135) compara `updatedAt` por item,
igual ao que `mergeAikSystemFiles` propõe; para `boards` (linhas 137-138) o
próprio código comenta `incoming wins (no granular timestamp)`, porque
`KanbanBoard` não tem `updatedAt` por item. Como `AikPhase` **tem**
`updatedAt` (TECH §3), `mergeAikSystemFiles` aplica a comparação por
timestamp uniformemente a `phases` e `tasks` — mais consistente que o
código original, mas não é literalmente "o mesmo algoritmo": é a
generalização da metade "por-task" dele para as duas coleções do AIK.

### 2.5 Briefing do agente — `src/api/aik-pipeline.api.ts`

```ts
export function buildAikAgentBriefing(
  task: AikTask,
  phase: AikPhase,
  system: AikSystem,
  contextText: string,
): string;

export async function startAikAgentTask(
  system: AikSystem,
  phase: AikPhase,
  task: AikTask,
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }>;
```

`buildAikAgentBriefing` monta, nesta ordem, filtrando linhas vazias (mesmo
padrão de `buildFeatdevelopInitialMessage`, `kanban-pipeline.api.ts:20-24`):

1. Se `task.agentSkill` preenchido: `Use a skill /${task.agentSkill}.` —
   ausente, nenhuma linha é adicionada (RF-18: execução livre é o padrão).
2. `Tarefa: "${task.title}"` (sempre).
3. `task.description`, se presente.
4. Contexto herdado: `Fase: "${phase.title}"` + `Sistema: "${system.name}"`
   — nunca a lista completa de fases/tarefas do sistema (RNF-03).
5. `task.checklist` não vazio: lista dos itens não concluídos.
6. `contextText` (contexto adicional digitado pelo usuário no momento de
   executar), se não vazio.
7. Se `task.linkedConversationId` já existe (reexecução): contrato de
   arquivo —
   ```
   Ao concluir esta tarefa, edite `.openhands/aik/system.json` (raiz do
   workspace) e mova o objeto desta tarefa (id "${task.id}") para
   columnId="in_review". Não altere outras tarefas.
   ```

`startAikAgentTask` chama `AgentServerConversationService.createConversation`
(mesmo serviço de `kanban-pipeline.api.ts:77`) com o texto de
`buildAikAgentBriefing` como mensagem inicial. O parâmetro de workspace
varia por `system.workspaceRef.kind` — achado do validador adversarial
(F-SPEC-4): `createConversation` (`agent-server-conversation-service.api.ts
:425-460`) só direciona a criação para um repositório Git quando o chamador
passa `metadata.selected_repository`/`metadata.git_provider` explicitamente
(linhas 458-460, 547-557); não existe direcionamento automático a partir de
um path. Portanto:

- `kind: "local"`: passa `workingDirOverride: workspaceRef.path` (mesmo
  parâmetro que `kanban-pipeline.api.ts:77` já usa).
- `kind: "cloud"`: passa `metadata: {selected_repository:
  workspaceRef.repository.fullName, git_provider:
  workspaceRef.repository.provider}` — mapeamento direto dos dois campos de
  `AikWorkspaceRefCloud` (TECH §3) para os dois campos que
  `createConversation` de fato lê. Sem isso, RF-23/CA-21 falhariam
  silenciosamente para sistemas cloud (a conversa abriria sem repositório
  vinculado).

Em sucesso, devolve `conversationId`; a store (§2.3) é quem atualiza
`task.linkedConversationId`/`system.activeAgentTaskId` — esta função não
toca o store diretamente (mantém `aik-pipeline.api.ts` sem dependência de
Zustand, mesma separação já usada em `kanban-pipeline.api.ts`).

### 2.6 Componentes de UI

| Componente | Contrato de props |
|---|---|
| `AikSystemsBoard` | sem props — lê `useAikBoardStore` direto |
| `AikPhasesBoard` | sem props — resolve `systemId` de `useParams<{systemId: string}>()` |
| `AikTasksBoard` | sem props — resolve `systemId`/`phaseId` de `useParams` |
| `AikBreadcrumb` | `{ systemId?: string; phaseId?: string }` |
| `AikConversationPanel` | `{ systemId: string; taskId?: string }` — `taskId` ausente = conversa do sistema; presente = conversa da tarefa (troca desmonta/remonta o pacote de conversa, TECH §2.5) |
| `AikTaskCard` | `{ task: AikTask; onOpen: (task: AikTask) => void }` |
| `AikTimeline` | `{ entries: AikTimelineEntry[] }` — somente leitura |
| `AikSystemForm` | `{ onSubmit: (input) => void; onClose: () => void }` — cadastro de sistema, campos: nome, backend (`getRegisteredBackends()`), e conforme `backend.kind`: `useLocalWorkspaces()` (local) ou `useGitRepositories()` (cloud), TECH §2.2 |

---

## 3. Fluxo principal passo a passo

1. Usuário acessa `aik.zadotec.com.br` → `host-gate.tsx` detecta o hostname
   → monta `AikRoutes` → `AikSystemsBoard` (index).
2. Cria um sistema (`AikSystemForm`): escolhe backend, escolhe
   workspace/repositório conforme `backend.kind` → `createSystem` no store
   → card aparece na coluna `ativo`.
3. Abre o sistema → `AikPhasesBoard` → cria uma fase (`backlog`, vazia) →
   cria uma tarefa dentro dela (`AikTasksBoard`), preenche briefing.
4. Clica **Executar** no card da tarefa → `startAikAgentTask` → conversa
   criada → tarefa em `in_progress`, indicador de run vivo visível no card
   (RF-16, alimentado pelo mesmo stream de eventos que
   `AikConversationPanel` já consome quando aberto).
5. Agente conclui, edita `.openhands/aik/system.json`, move a tarefa para
   `in_review` → polling de 4s (§2.3) traz a mudança pra UI sem reload.
6. Usuário abre a tarefa, revisa `AikTimeline` + `task.lastRunFilesChanged`
   → **Aprovar** (→ `done`, fase recalcula) ou **Devolver** com feedback
   (→ `in_progress`, feedback entregue na mesma conversa).
7. A qualquer momento, o painel de conversa do sistema (`AikConversationPanel`
   sem `taskId`) fica acessível pelo `AikLayout`, em qualquer nível —
   sistema, fase ou tarefa.

## 3.1 Fluxos de erro

- **Backend do sistema fora do ar** ao abrir o sistema: `syncFromFile` falha
  com `errorType:"backend_down"`; `AikPhasesBoard` mostra estado de erro
  isolado (RNF-09) com o nome do sistema e o tipo de falha, sem impedir
  navegar de volta pra lista de sistemas.
- **Workspace removido/inacessível**: mesma via, `errorType:
  "workspace_unreachable"`, distinto do anterior na mensagem (RNF-08).
- **Executar com run já ativo no sistema**: botão renderiza desabilitado com
  texto "já há uma execução em andamento neste sistema" (RF-13 revisado) —
  `startAgent` nem é chamado.
- **Arquivo corrompido** (`JSON.parse` falha ou `version` desconhecida):
  `errorType:"parse_error"`, sistema isolado em estado de erro, demais
  sistemas do quadro continuam normais (RNF-09).
- **Conflito de escrita** (arquivo mudou no disco entre leitura e escrita
  da store): `writeAikSystemFile` relê antes de escrever e aplica
  `mergeAikSystemFiles`; se o merge ainda assim detectar edição do mesmo
  campo do mesmo card por ambos os lados, a versão do agente (mais recente
  por `updatedAt`) vence — não há prompt de conflito manual no v1.

---

## 4. Casos de borda

- **Sistema cloud**: `AikSystemForm` nunca oferece o campo de path — para
  `backend.kind === "cloud"` só lista `useGitRepositories()`. `syncFromFile`
  e o polling (§2.3) são no-op para esses sistemas; RF-26/RF-27 não se
  aplicam (documentado, TECH §2.3).
- **Fase sem tarefas**: coluna `backlog` (regra (b) do TECH §3), e não
  aparece "executar" nem "concluído" — é container vazio, não erro.
- **Excluir fase com tarefas em `in_progress`** *(decisão nova desta SPEC,
  não estava no PRD/TECH — sinalizado pelo validador adversarial,
  F-SPEC-8; RF-12 do PRD só pedia "confirmação exibindo quantos filhos
  serão removidos", sem prever bloqueio condicional)*: `DeletePhaseConfirmDialog`
  (mesmo padrão de `delete-task-confirm-dialog.tsx`) mostra contagem e
  **bloqueia** a exclusão se alguma tarefa filha tem
  `linkedConversationId` com run vivo — precisa `stopAgent` primeiro. Fases
  sem run vivo excluem normalmente, filhas junto. Sujeito à aprovação do
  usuário nesta fase; se rejeitado, cai para o comportamento simples de
  RF-12 (só confirma e conta, sem bloqueio condicional).
- **Tarefa bloqueada por outra (`blockedByTaskId`)**: `AikTaskCard` mostra
  indicador de bloqueio e desabilita **Executar** (não drag — mover de
  coluna por arraste continua permitido, é só a execução que respeita
  bloqueio) enquanto a tarefa bloqueadora não está em `done`.
- **Dependência circular** (`blockedByTaskId` formando ciclo): `createTask`/
  `updateTask` rejeitam a gravação de `blockedByTaskId` se resultaria em
  ciclo (checado por BFS reaproveitando o padrão de
  `collectDescendantIds`, `kanban-tree.ts:10-26`, adaptado ao grafo de
  bloqueio em vez de `parentId`).
- **Aba em background durante run**: polling pausado (§2.3), mas o
  indicador de run vivo (RF-16) é alimentado pelo stream de conversa
  enquanto o painel estiver aberto; se o painel foi fechado, o indicador
  volta a atualizar no próximo `syncFromFile` ao reabrir/focar a aba.
- **Dois sistemas apontando pro mesmo workspace local** *(decisão nova
  desta SPEC, mesma origem de F-SPEC-8 — nem PRD nem TECH previam esse
  aviso)*: permitido — cada `AikSystem` tem seu próprio `id` e o arquivo
  `.openhands/aik/system.json` é por workspace, então dois sistemas no
  mesmo path **compartilhariam o mesmo arquivo**. Isso é uma armadilha de
  dado; `AikSystemForm` avisa (não bloqueia) quando o workspace escolhido
  já está associado a outro sistema existente no store. Sujeito à aprovação
  do usuário nesta fase; se rejeitado, cai para nenhum aviso (comportamento
  implícito do TECH §2.3, sem tratamento especial).
- **Renomear/excluir sistema com conversa principal aberta**: `deleteSystem`
  não aborta a conversa do agent-server (fora do escopo desta store) —
  apenas remove o sistema e suas fases/tarefas do store e do arquivo;
  qualquer run vivo daquele sistema fica órfão do ponto de vista da UI
  (mesmo comportamento hoje ao excluir board no kanban atual, não é
  regressão).

---

## 5. Mudanças arquivo a arquivo

| Caminho | Ação | O que muda |
|---|---|---|
| `src/routes.ts` | alterar | árvore única vira `route("*", "routes/host-gate.tsx")` |
| `src/routes/host-gate.tsx` | criar | detecção de hostname, delega pra `AgentCanvasApp` ou `AikRoutes` |
| `src/routes/agent-canvas-app.tsx` | criar | árvore de rotas atual (hoje em `routes.ts:8-49`) movida sem alteração de conteúdo |
| `src/routes/aik/aik-routes.tsx` | criar | árvore `<Routes>` do AIK (§2.1) |
| `src/routes/aik/aik-layout.tsx` | criar | shell: breadcrumb + outlet + painel de conversa |
| `src/routes/aik/aik-systems-board.tsx` | criar | kanban de sistemas |
| `src/routes/aik/aik-phases-board.tsx` | criar | kanban de fases |
| `src/routes/aik/aik-tasks-board.tsx` | criar | kanban de tarefas |
| `src/types/aik.ts` | criar | tipos do TECH §3 |
| `src/stores/aik-board-store.ts` | criar | store Zustand (§2.3) |
| `src/utils/aik-dependency-graph.ts` | criar | detecção de ciclo em `blockedByTaskId`, adaptado de `kanban-tree.ts:10-26` |
| `src/api/aik-board-file.api.ts` | criar | leitura/escrita/merge do `system.json` (§2.4) |
| `src/api/aik-pipeline.api.ts` | criar | briefing + `startAikAgentTask` (§2.5) |
| `src/components/features/aik/aik-breadcrumb.tsx` | criar | §2.6 |
| `src/components/features/aik/aik-conversation-panel.tsx` | criar | §2.6, monta o pacote de conversa (TECH §2.5) |
| `src/components/features/aik/aik-task-card.tsx` | criar | §2.6 |
| `src/components/features/aik/aik-timeline.tsx` | criar | §2.6 |
| `src/components/features/aik/aik-system-form.tsx` | criar | §2.6, cadastro de sistema |
| `src/components/features/aik/delete-phase-confirm-dialog.tsx` | criar | §4, bloqueio de exclusão com run vivo |
| `src/components/features/aik/delete-system-confirm-dialog.tsx` | criar | CA-30, confirmação de exclusão de sistema com contagem de fases + tarefas descendentes |
| `/etc/apache2/sites-available/aik.zadotec.com.br.conf` + `-le-ssl.conf` | criar (infra, fora do repo) | vhost espelhado, TECH §2.1 |
| `src/stores/kanban-board-store.ts` | nenhuma | não tocado |
| `src/routes/kanban-board.tsx`, `board-list.tsx`, `kanban-task-drawer.tsx` | nenhuma | não tocados |

---

## 6. Critérios de aceitação

| CA | Descrição | Cobre |
|---|---|---|
| CA-01 | `aik.zadotec.com.br/` renderiza `AikSystemsBoard`; `openhands.zadotec.com.br/` continua renderizando a home atual sem diferença de comportamento | RF-29, RF-01 |
| CA-02 | Deep link `aik.zadotec.com.br/<systemId>/fases/<phaseId>` carregado direto (sem navegação prévia) renderiza `AikTasksBoard` correto | RF-06, F-TECH-2 (regressão coberta) |
| CA-03 | Cadastro de sistema local lista `useLocalWorkspaces()`; cadastro de sistema cloud lista `useGitRepositories()` do backend escolhido, nunca os dois ao mesmo tempo | RF-02, Q2 |
| CA-04 | Card de sistema mostra contagem de tarefas `in_progress`/`in_review` e status do último health check sem precisar abrir o sistema | RF-03 |
| CA-05 | Abrir uma fase nunca abre modal sobre modal — é navegação de rota, com `AikBreadcrumb` mostrando o caminho completo | RF-06, RF-07 |
| CA-06 | Fase nunca exibe botão de Executar nem campo de briefing | RF-08 |
| CA-07 | As 5 combinações de estado de filhas (todas `done`; nenhuma filha; alguma `in_review`; alguma `in_progress`; mistura `backlog`/`done`) movem a fase para a coluna correta, coberto um teste por caso | RF-09 |
| CA-08 | Arrastar tarefa entre colunas persiste `columnId`+`order`. `AikPhasesBoard` não registra sensor de drag no card de fase (nenhum `useSortable`/`useDraggable`): tentar arrastar um card de fase não move o mouse-down em drag algum — o card simplesmente não é um item arrastável, não um item arrastável-que-recusa | RF-11 |
| CA-09 | Excluir fase com filhos (sem run vivo) pede confirmação mostrando a contagem de tarefas descendentes removidas | RF-12 (metade "fase") |
| CA-10 | Tarefa com `executorType:"agent"`, `agentBriefing` preenchido e backend acessível mostra Executar habilitado, sem qualquer campo de slug de feature visível | RF-13 |
| CA-11 | Com `system.activeAgentTaskId` ocupado, Executar em outra tarefa do mesmo sistema aparece desabilitado com o motivo visível, e `startAgent` não dispara chamada de rede | RF-13, O3 |
| CA-12 | Executar cria conversa, seta `linkedConversationId`, move a tarefa para `in_progress` | RF-14 |
| CA-13 | Parar aborta o run e devolve a tarefa ao topo de `backlog` | RF-15 |
| CA-14 | Indicador de run vivo e último evento aparecem no card sem sair da tela | RF-16 |
| CA-15 | Card mostra a lista de arquivos alterados pelo último run | RF-17 |
| CA-16 | Briefing enviado contém `agentSkill` só quando preenchido; sem ele, nenhuma skill é mencionada | RF-18 |
| CA-17 | Conclusão do agente sempre pousa em `in_review`, nunca direto em `done` | RF-19 |
| CA-18 | Aprovar move pra `done`; Devolver com feedback move pra `in_progress` e a mensagem de feedback chega na mesma conversa vinculada (não cria conversa nova) | RF-20 |
| CA-19 | Toda transição de estado, comentário, run iniciado/parado e feedback aparecem na timeline em ordem cronológica | RF-21 |
| CA-20 | O painel de conversa do sistema abre a partir de qualquer nível (sistema, fase, tarefa) sem perder o quadro de vista | RF-22 |
| CA-21 | A conversa principal roda no backend/workspace do sistema (nunca noutro) | RF-23 |
| CA-22 | Fase/tarefa criada pelo agente via conversa aparece no quadro sem recarregar a página | RF-24 |
| CA-23 | Alternar entre conversa do sistema e conversa da tarefa no mesmo painel troca o `conversationId` ativo corretamente | RF-25 |
| CA-24 | Sistema local: quadro persiste em `.openhands/aik/system.json` dentro do workspace | RF-26 |
| CA-25 | Sistema local com arquivo alterado externamente (simulando edição do agente) reflete a mudança na UI aberta em até 5s (polling de 4s) | RF-27, M6 |
| CA-26 | Duas escritas quase simultâneas (UI move card + agente edita outro card) não perdem nenhuma das duas mudanças após merge | RF-28 |
| CA-27 | `blockedByTaskId` circular é rejeitado na gravação (não decide silenciosamente ignorar) | caso de borda §4 |
| CA-28 | `aik.zadotec.com.br` serve sob TLS válido e `/sockets` conecta (WebSocket funcional) para o painel de conversa | RF-29, F-TECH-3 (regressão coberta) |
| CA-29 | Clicar num card de `AikSystemsBoard` navega para `/<systemId>` e renderiza `AikPhasesBoard` do sistema clicado (não outro) | RF-04 |
| CA-30 | Excluir um sistema com fases/tarefas pede confirmação mostrando a contagem total de fases + tarefas descendentes, via componente próprio (`delete-system-confirm-dialog.tsx`, §5) | RF-12 (metade "sistema" — ver correção em §5) |
| CA-31 | Um quadro com 200 tarefas carregadas (sem paginação) tem sua primeira pintura em ≤1s, medida com Chrome DevTools Performance contra o build de produção (`npm run build:app` + `npm run start`) | RNF-01 |
| CA-32 | Arrastar um card até soltar (`pointerup`) resulta em repaint da nova posição em ≤100ms, mesmo método de medição de CA-31 | RNF-01 |
| CA-33 | Navegar entre fase e tarefa do mesmo sistema já sincronizado não dispara nova chamada de `syncFromFile`/`readAikSystemFile` (inspecionável por spy/mock de rede no teste de integração) | RNF-02 |
| CA-34 | `buildAikAgentBriefing` com 1 tarefa e com 500 tarefas no sistema produz strings de tamanho igual (±o próprio conteúdo do card) — prova que o prompt não itera a lista completa | RNF-03 |
| CA-35 | Nenhuma `Backend.apiKey` aparece serializada em `AikSystemFile` gravado em disco, nem na URL, nem em `console.*` durante um fluxo completo de criar sistema → executar tarefa | RNF-04 |
| CA-36 | Texto vindo de `task.description`/`agentBriefing`/timeline (simulado como conteúdo hostil, ex.: `<img src=x onerror=...>`) é renderizado como texto literal, nunca como HTML executável | RNF-05 |
| CA-37 | Toda transição de coluna alcançável por arraste em `AikTasksBoard` também é alcançável via teclado (`KeyboardSensor`, mesmo padrão de `kanban-board.tsx:74-78`) | RNF-06 |
| CA-38 | Falha de `backend_down` e falha de `workspace_unreachable` produzem mensagens de erro visivelmente distintas na tela (strings diferentes, não o mesmo texto genérico) | RNF-08 |
| CA-39 | Um `system.json` com JSON malformado ou `version` desconhecida deixa aquele sistema em estado de erro isolado, sem impedir os demais sistemas do `AikSystemsBoard` de renderizar normalmente | RNF-09 |
| CA-40 | Toda string visível do AIK passa por `I18nKey`/`react-i18next` — nenhuma string hardcoded em português direto no JSX (checável por `grep` de literais de texto fora de `t(...)` nos arquivos novos de §5) | RNF-10 |
| CA-41 | `npm run lint` e `npm run test` passam sem novo erro/falha em relação à base pré-AIK (`git stash` antes/depois, mesmo método usado na validação deste próprio pipeline) | RNF-11 |

RNF-07 (contraste AA) não recebe CA de teste automatizado — é verificado por
inspeção visual manual em tema claro/escuro antes do Release 4 (mesmo método
já usado no restante do app, que não tem teste automatizado de contraste
hoje), registrado aqui para não ficar implicitamente descoberto.

---

## 7. Plano de testes

**Unidade** (`vitest`, mesmo runner do repo):
- `aik-board-store.test.ts`: CA-07 (5 casos de RF-09), CA-11 (bloqueio de
  segundo run), CA-13 (stop devolve ao topo), CA-17/CA-18 (máquina de
  estados de revisão), CA-27 (ciclo de dependência).
- `aik-board-file.api.test.ts`: CA-24, CA-26 (merge não perde escrita
  concorrente), caso `cloud_unsupported` (§2.4).
- `aik-pipeline.api.test.ts`: CA-16 (briefing sem skill quando ausente),
  RNF-03 (tamanho do briefing não cresce com N tarefas do sistema — mesmo
  padrão de `kanban-pipeline.api.test.ts:325`).
- `aik-dependency-graph.test.ts`: detecção de ciclo isolada (CA-27), casos
  com grafo desconectado e com autorreferência.

**Integração** (`vitest` + Testing Library, mesmo padrão de
`kanban-board-dnd.test.tsx`):
- `aik-systems-board.test.tsx`: CA-01, CA-03, CA-04, CA-29, CA-30, CA-39, CA-40.
- `aik-phases-board.test.tsx`: CA-05, CA-06, CA-08 (drag só em tarefa), CA-09, CA-33, CA-37.
- `aik-tasks-board.test.tsx`: CA-10, CA-12, CA-14, CA-15, CA-19, CA-36.
- `aik-board-store.test.ts` (unidade, listada acima) também cobre CA-31/CA-32
  de forma indireta (custo O(n) do reindex), mas a medição real de tempo
  fica no roteiro E2E (CA-31/CA-32), não em unidade — Vitest/jsdom não mede
  repaint real.
- `aik-conversation-panel.test.tsx`: CA-20, CA-21, CA-23.
- `host-gate.test.tsx`: hostname AIK monta `AikRoutes`; hostname padrão
  monta `AgentCanvasApp` — mock de `window.location.hostname` via
  `vi.stubGlobal`.

**E2E** (`playwright`, `playwright.config.ts` existente, sem config nova):
- Roteiro cobrindo CA-02 (deep link direto na URL final, sem navegação
  client-side prévia — único jeito de provar que o proxy/roteamento por
  hostname funciona de ponta a ponta) e CA-28 (TLS + `/sockets` real,
  rodado contra o vhost publicado, não contra `localhost`).
- Roteiro cobrindo M1 do PRD (≤4 cliques da raiz até Executar).
- Roteiro cobrindo CA-31/CA-32 (performance): popular 200 tarefas via
  `aik-board-store` diretamente (sem passar por 200 cliques de UI), medir
  first paint e latência de drag com Playwright Tracing.
- Roteiro cobrindo CA-34/CA-35 (tamanho de briefing e ausência de segredo),
  rodado contra o `aik-pipeline.api` real, não mockado.

**Manual, fora de automação** (registrado aqui porque depende de infra que
os testes automatizados não cobrem): confirmar em produção que
`openhands.zadotec.com.br` não regrediu depois do deploy do AIK — CA-01,
segunda metade.

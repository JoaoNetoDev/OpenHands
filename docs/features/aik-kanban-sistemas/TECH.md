# TECH — AIK: front de sistemas em kanban hierárquico

Slug: `aik-kanban-sistemas` · Depende de: `PRD.md` (aprovado)
Status: fase 2 de `/featdevelop` — aguardando aprovação

---

## 1. Estado atual da arquitetura nos pontos tocados

### 1.1 App é um único SPA React Router, um único bundle

- `src/routes.ts:8-49` — árvore de rotas única, `RouteConfig` do
  `@react-router/dev/routes`, tudo sob um `layout("routes/root-layout.tsx", …)`.
- `react-router.config.ts:128-134` — config única, `ssr: false`,
  `appDirectory: "src"`, `basename` global vindo de `VITE_BASE_PATH`
  (linhas 4-12). Não existe suporte nativo a múltiplos "apps" no mesmo
  `react-router.config.ts` — é `satisfies Config` único.
- `scripts/ingress.mjs` e `scripts/static-server.mjs` são proxy/servidor
  estático genéricos por prefixo (`--route "/api=…"`), agnósticos de
  framework: servem `build/` via `sirv` e proxeiam prefixos configurados —
  não sabem nada sobre rotas React Router.
- Produção: `openhands.zadotec.com.br` → Apache (`/etc/apache2/sites-enabled/
  openhands.zadotec.com.br-le-ssl.conf`) → `ProxyPass / http://127.0.0.1:8092/`
  → processo node do ingress (confirmado: `ss -ltnp` mostra node em `*:8092`).

### 1.2 Kanban existente é o modelo errado pra reaproveitar como store

- `src/stores/kanban-board-store.ts:114-134` — `KanbanBoardState` com
  `boardsByWorkspaceId: Record<string, KanbanBoard[]>` (linha 115) e
  `tasksByBoardId: Record<string, KanbanTask[]>` (linha 116), colunas fixas de
  `src/types/kanban.ts:1-11` (`KanbanColumnId`) amarradas ao fluxo
  `/featdevelop` (`featdevelop_prd`, `featdevelop_tech`, …).
- `src/api/kanban-board-file.api.ts:22-32` — `ALL_COLUMN_IDS` hardcoded para
  esse mesmo fluxo; `kanban-pipeline.api.ts:20-24` — mensagem inicial do
  agente fixa na skill `/featdevelop`.
- Reaproveitável de fato: `src/utils/kanban-tree.ts` inteiro
  (`collectDescendantIds`, `reindexAfterMove`) — é puro, desacoplado de tipo
  de store, opera só em `{id, parentId, columnId, order}`.
- **Decisão**: store novo e paralelo (§3), sem tocar em
  `useKanbanBoardStore`. Reaproveita `kanban-tree.ts` por import direto.

### 1.3 Runtime de conversa é reaproveitável, mas não é um componente solto

- `src/components/features/conversation/conversation-main/conversation-main.tsx:23`
  — `ConversationMain()` não recebe props; lê tudo de `useConversationStore`,
  `useBreakpoint`, `useConversationOverviewDrawerOptional`.
- Quem monta o contexto é a rota `src/routes/conversation.tsx`: o provider
  obrigatório é `WebSocketProviderWrapper` (import `:28`, uso `:212-215`),
  que recebe `conversationId` e conecta o socket. `<ConversationMain />` só
  roda dentro dele, e dentro de `EventHandler` +
  `ConversationOverviewDrawerProvider` (por volta de `:194-210`).
- `conversationId` vem de `useConversationId()` (`:5,35`), hoje acoplado ao
  param de URL `conversations/:conversationId`.
- `useActiveBackend()` (`:10,47`) guarda o backend no mount
  (`mountedBackendId`, `:48-52`) pra descartar fetch obsoleto se o backend
  ativo mudar enquanto a rota está montada.
- **Conclusão**: o pacote reaproveitável não é `ConversationMain` sozinho —
  é o conjunto `WebSocketProviderWrapper` + `EventHandler` +
  `ConversationOverviewDrawerProvider` + `ConversationMain`, do jeito que
  `AppContent`/`ConversationView` já compõe em `conversation.tsx:33,219-221`
  (arquivo tem 223 linhas ao todo — corrigido aqui após o validador
  adversarial apontar `:229-230` como fora do arquivo).

### 1.4 Backend ativo e criação de conversa

- `src/contexts/active-backend-context.tsx:38` — `ActiveBackendContext`;
  `useActiveBackend` o consome. `ActiveBackendProvider` (`:68`) usa
  `React.useSyncExternalStore` sobre `src/api/backend-registry/active-store.ts`
  (`subscribeActiveBackend`/`getSnapshot`, import `:3-11`).
- Troca programática existe: `setActive(backendId, orgId?)` (`:89-124`),
  exposta em `ActiveBackendContextValue.setActive` (`:33`). Resolve via
  `getRegisteredBackends()`, chama `setActiveSelection` (`:111`) e
  `retryBootstrapProbe()` (`:112`). Não precisa invalidar queries global —
  os hooks já incluem `backend.id`/`orgId` na query key.
- Criação de conversa: `AgentServerConversationService.createConversation({…})`
  (`src/api/conversation-service/agent-server-conversation-service.api.ts`,
  usado em `kanban-pipeline.api.ts:77`), devolve `app_conversation_id`. Quem
  decide local vs. cloud é o backend ativo no momento da chamada
  (`getActiveBackend()`, usado em `kanban-board-file.api.ts:1,162,205`).

### 1.5 Workspaces: só local tem listagem de path de filesystem

- `src/hooks/query/use-local-workspaces.ts:13-24` — `WorkspacesService
  .listWorkspaces()` é **local-only**, sempre contra o agent-server local,
  não filtra por backend ativo.
- Não existe "listar pastas" de um agent-server remoto. O equivalente mais
  próximo pra remoto é `src/hooks/query/use-git-repositories.ts:20-27` —
  lista **repositórios Git** (GitHub/GitLab) via API do backend/cloud, não
  filesystem (`shouldUseInstallationRepos(provider, active.backend.kind)`).
- **Consequência direta pra Q2 do PRD** (ver §2.2): "workspace" de um sistema
  remoto não pode ser um path de disco escolhido como no local — só pode ser
  um repositório Git resolvido pelo backend remoto, ou um workspace de
  conversa que o próprio agent-server remoto já gerencia internamente.

### 1.6 Persistência em arquivo é via terminal, e é local-only

- `src/api/kanban-board-file.api.ts` não usa API HTTP de arquivo. Leitura:
  `cat -- <path>` via `AgentServerRuntimeService.executeCommand` (`:167-172`).
  Escrita: `buildWriteFileCommand(path, contentBase64)` (`:215-219`), usando
  `toBase64`/`escapeSingleQuoted` de `kanban-sintering.api.ts` (`:3-7`).
- Explicitamente bloqueado pra cloud: `getActiveBackend().backend.kind ===
  "cloud"` devolve `cloud_unsupported` sem tentar nada (`:162-164`) —
  comando de shell sem conversa ativa só atinge o backend local.
- Faz merge por `updatedAt` antes de escrever (`mergeBoardFiles`, `:116-146`;
  uso em `:200-224`), pra não conflitar com o agente escrevendo o mesmo
  arquivo.
- **Consequência pra Q3 do PRD**: esse mecanismo (comando de terminal) só
  funciona com um backend local ou com uma conversa ativa contra um backend
  remoto que aceite `execute_bash_command`. Um sistema remoto **sem**
  conversa ativa não tem como ler/escrever seu arquivo de quadro por esse
  caminho.

---

## 2. Arquitetura proposta

### 2.1 Um app, um bundle, dois vhosts espelhados — divisão por hostname no
client, não por prefixo de URL reescrito no proxy

**Correção de desenho** (achado do validador adversarial, F-TECH-2/F-TECH-3):
a primeira versão deste documento propunha `ProxyPass / http://127.0.0.1:
8092/aik/` reescrevendo o path no lado do servidor, assumindo que isso faria
o React Router client-side entrar em `/aik`. Isso é falso: `ProxyPass`
reescreve só o destino da requisição HTTP ao backend — o `window.location
.pathname` no navegador continua sendo `/` (ou `/sistema-x/fase-y` num deep
link), e o roteador roda inteiramente no cliente contra esse pathname real.
Com `route("aik", …)` como prefixo literal em `routes.ts`, nenhum desses
pathnames bateria com a árvore do AIK — a home antiga (`index-home.tsx`,
`src/routes.ts:9-10`) apareceria em `aik.zadotec.com.br/`, e um deep link de
fase daria tela branca.

**Decisão corrigida**: a escolha de qual UI renderizar é feita inteiramente
no **cliente**, por hostname, sem prefixo de URL e sem reescrita de proxy —
os dois vhosts proxeiam de forma **idêntica** ao vhost existente (mesmo
padrão de `/etc/apache2/sites-enabled/openhands.zadotec.com.br-le-ssl.conf`,
incluindo a rota de WebSocket que a primeira versão deste TECH omitiu):

```apache
# aik.zadotec.com.br-le-ssl.conf (novo) — mesmo padrão do vhost existente,
# apenas ServerName e certificado trocados; NENHUMA reescrita de path.
<VirtualHost *:443>
    ServerName aik.zadotec.com.br
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass /sockets ws://127.0.0.1:8092/sockets
    ProxyPassReverse /sockets ws://127.0.0.1:8092/sockets
    ProxyPass /vault http://127.0.0.1:18030/vault retry=0 timeout=10
    ProxyPassReverse /vault http://127.0.0.1:18030/vault
    ProxyPass / http://127.0.0.1:8092/ retry=0 timeout=3600
    ProxyPassReverse / http://127.0.0.1:8092/
    RequestHeader set X-Forwarded-Proto "https"
    SSLCertificateFile /etc/letsencrypt/live/aik.zadotec.com.br/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/aik.zadotec.com.br/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
```

  (o bloco de `/git` do vhost original é específico do marketplace de
  skills servido só em `openhands.zadotec.com.br` — não é replicado aqui
  porque nada no PRD pede isso no AIK.)

- Continua **um único bundle, um único processo, uma única porta 8092** —
  `ingress.mjs`/`static-server.mjs` não mudam, e nenhum path é reescrito.
  Ambos os hosts recebem o mesmo `index.html` e o mesmo bundle JS.

- **Roteamento por hostname dentro do próprio app**, não por segmento de
  URL: as rotas do AIK entram em `src/routes.ts` como uma árvore separada,
  mas **sem prefixo `/aik`** — usam os mesmos segmentos de topo que o AIK
  precisa (`/`, `/:systemId`, `/:systemId/fases/:phaseId`), e é o layout raiz
  quem decide, em runtime, qual árvore está "ativa" pro pathname atual:

  ```ts
  // routes.ts — duas raízes independentes, roteadas por host em runtime,
  // não por prefixo de path (ver host-gate.tsx)
  export default [
    route("*", "routes/host-gate.tsx"), // decide host e delega
  ] satisfies RouteConfig;
  ```

  `host-gate.tsx` lê `window.location.hostname` uma vez no mount e renderiza
  `<AgentCanvasRoutes/>` (a árvore completa que hoje vive direto em
  `routes.ts:8-49`, movida sem alteração para um componente próprio) ou
  `<AikRoutes/>` (nova, com `<Routes>`/`<Route>` do pacote `react-router`
  usados imperativamente — suportado porque o app já depende de
  `react-router@7.18.2`, que exporta esses componentes independentemente do
  modo "file routes"). Cada árvore define seus próprios `index`/`route`
  internos sem colidir, porque só uma delas é montada por vez.

  SSR continua desligado (`ssr:false`, `react-router.config.ts:133`) — a
  decisão de host acontece só no cliente, o que é aceitável porque o app já
  é um SPA puro nessa configuração; não há regressão de SEO/first-paint pra
  proteger.

- Isso satisfaz RF-29 (host próprio) sem duplicar build, ingress, processo
  **ou** proxy — os dois vhosts são idênticos exceto `ServerName` e
  certificado, o que reduz o risco R4 do PRD a "um vhost a mais pra manter",
  não "uma estratégia de proxy a mais pra manter".

### 2.2 Sistema = par (Backend, referência de workspace) — resolve Q2

Decisão: `AikSystem.workspaceRef` tem forma discriminada por `backend.kind`:

```ts
type AikWorkspaceRef =
  | { kind: "local"; workspaceId: string; path: string }
  | { kind: "cloud"; repository: { provider: string; fullName: string } };
```

- Para `kind: "local"`: reaproveita `useLocalWorkspaces()` sem alteração —
  cadastro de sistema local escolhe um `LocalWorkspace` existente
  (`src/types/workspace.ts:1-11`), igual ao fluxo atual de `board-list.tsx`.
- Para `kind: "cloud"`: reaproveita `useGitRepositories()`
  (`src/hooks/query/use-git-repositories.ts:20`) — cadastro de sistema remoto
  escolhe um repositório Git do backend ativo, não um path de disco (§1.5
  já provou que não existe outra opção sem inventar API nova, que fica fora
  do escopo v1 por N1/N4 do PRD).
- **Resposta a Q2 do PRD**: "backend remoto" inclui `BackendKind === "cloud"`
  (OpenHands Cloud), mas o AIK v1 não lista filesystem de um agent-server
  remoto arbitrário fora do Cloud — só Cloud, via repositório Git. Um
  agent-server "próprio" remoto (self-hosted, fora do Cloud) fica fora do
  v1 e não é um `BackendKind` distinto hoje no código (`backend-registry/
  types.ts:1`: só `"local" | "cloud"`), então não requer trabalho extra pra
  ser explicitamente excluído.

### 2.3 Persistência: arquivo próprio, só para sistemas locais — resolve Q3

Decisão: **arquivo novo**, não migração do `board.json` existente.

- Caminho: `<workspacePath>/.openhands/aik/system.json` (mesmo diretório
  `.openhands/` que já hospeda `kanban/`, convenção mantida, arquivo
  irmão — nunca o mesmo, evitando qualquer colisão de schema com o kanban
  atual, que RF-29/N5 do PRD já proíbem migrar).
- Mecanismo de leitura/escrita: **o mesmo de `kanban-board-file.api.ts`**
  (`cat`/`write_file` via `AgentServerRuntimeService.executeCommand`),
  reaproveitando `mergeBoardFiles`-equivalente com merge por `updatedAt` e
  por card (RF-28), não por arquivo inteiro.
- **Isso é local-only por herança do mecanismo (§1.6)**. Para sistemas
  `kind: "cloud"`, a persistência do quadro (fases/tarefas) não pode usar
  esse caminho — decisão: para `kind: "cloud"`, o quadro é persistido
  **client-side apenas** (localStorage/IndexedDB do navegador) no v1, com um
  aviso visível de "este sistema não sincroniza com o agente por arquivo"
  (RNF-08 já pede diferenciar tipos de erro/estado — reaproveitado aqui como
  estado permanente, não erro transitório). RF-26 do PRD ("persistido dentro
  do próprio workspace") portanto **só se aplica a sistemas locais**; cloud
  fica com uma exceção documentada aqui, não uma reinterpretação silenciosa
  do requisito.

**Atualização ao vivo (RF-27, M6 ≤5s)** — achado do validador adversarial
(F-TECH-4): nem o mecanismo atual (`kanban-board-file.api.ts` +
`useKanbanBoardStore`) nem a primeira versão deste TECH tinham polling ou
watch de arquivo — `syncFromFile` só roda uma vez, ao montar a rota
(confirmado: nenhum `setInterval`/`watch` em `src/stores/kanban-board-store
.ts` nem em `src/routes/board-list.tsx`). Sem mecanismo novo, uma edição do
agente no `system.json` só apareceria no próximo mount de rota — viola
RF-27 e M6 diretamente. Decisão: `aik-board-store.ts` adiciona **polling
leve, novo em relação ao padrão existente**, só enquanto uma tela do
sistema está montada: `setInterval(() => syncFromFile(systemId), 4000)`,
cancelado no unmount, e pausado quando a aba perde foco
(`document.visibilityState`) pra não gastar ciclo com o usuário fora da
tela. 4s de intervalo cobre a janela de 5s de M6 com margem. Aplica-se só a
`workspaceRef.kind === "local"` — sistemas `cloud` não têm arquivo pra
sondar (§2.3 acima), então RF-27 não se aplica a eles (mesma exceção já
registrada para RF-26).

### 2.4 Store Zustand novo: `aik-board-store.ts`

Paralelo ao `useKanbanBoardStore`, shape equivalente mas com tipos próprios
(§3), sem `ALL_COLUMN_IDS` fixo nem mensagem de skill hardcoded — RF-18 exige
que a skill seja campo do card, não constante de código.

### 2.5 Execução e conversa: reaproveita o pacote do §1.3, duas instâncias

- **Conversa do sistema** (RF-22/23): uma instância do pacote
  `WebSocketProviderWrapper` + `EventHandler` +
  `ConversationOverviewDrawerProvider` + `ConversationMain`, montada no
  layout `/aik/:systemId` (não na rota de tarefa), com `conversationId`
  guardado no próprio `AikSystem` (`mainConversationId`), criada sob demanda
  na primeira mensagem (não no cadastro do sistema).
- **Conversa/run de uma tarefa** (RF-14/25): mesma composição, montada no
  painel lateral da tela de tarefas, alternando `conversationId` entre o do
  sistema e o `task.linkedConversationId` — RF-25 ("alternando o alvo")
  vira, tecnicamente, trocar qual `conversationId` é passado ao
  `WebSocketProviderWrapper` da instância ativa no painel, desmontando e
  remontando o pacote (o socket não sobrevive à troca de conversa; é o
  mesmo comportamento que já existe hoje ao navegar entre
  `/conversations/:id` diferentes).
- **Limite de um run por sistema (N1 do PRD)**: guardado como
  `activeAgentTaskId: string | null` no `AikSystem` do store — não em cada
  tarefa. `startAgent` falha (e a UI desabilita o botão, RF-13 revisado) se
  `activeAgentTaskId !== null` e for de outra tarefa.

### 2.6 Componentes propostos (novos, sob `src/components/features/aik/` e
`src/routes/aik/`)

| Componente | Responsabilidade | Reaproveita |
|---|---|---|
| `host-gate.tsx` | Único componente registrado em `routes.ts` (rota `*`); lê `window.location.hostname` e delega para `AgentCanvasRoutes` ou `AikRoutes` (§2.1) | — |
| `aik-routes.tsx` | Árvore `<Routes>`/`<Route>` imperativa do AIK (`react-router@7.18.2`), montada por `host-gate.tsx` | `react-router` (já dependência) |
| `aik-layout.tsx` | Shell do AIK: breadcrumb + slot de painel de conversa, primeiro elemento de `AikRoutes` | `ActiveBackendProvider`/`QueryClientProvider` (já acima, via `root.tsx`/`agent-server-ui-providers.tsx`, ver §2.1) |
| `aik-systems-board.tsx` | Kanban de sistemas (RF-01) | `KanbanColumn`/`KanbanCard` só como referência de padrão, tipos próprios |
| `aik-phases-board.tsx` | Kanban de fases de um sistema (RF-05) | idem |
| `aik-tasks-board.tsx` | Kanban de tarefas de uma fase (RF-10) | idem |
| `aik-breadcrumb.tsx` | Navegação sistema › fase › tarefa (RF-07) | — |
| `aik-conversation-panel.tsx` | Painel lateral, monta o pacote de conversa do §2.5 | `WebSocketProviderWrapper`, `ConversationMain`, `EventHandler` |
| `aik-task-card.tsx` | Card de tarefa com Executar/Parar/Aprovar/Devolver | `run-agent-button.tsx` só como referência de padrão de loading/disabled |
| `aik-timeline.tsx` | Timeline por card (RF-21) | — |
| `aik-board-store.ts` | Store Zustand (§2.4) | `kanban-tree.ts` (import direto, sem cópia) |
| `aik-board-file.api.ts` | Leitura/escrita do `system.json` (§2.3) | mecanismo de `kanban-board-file.api.ts`, código próprio |

---

## 3. Modelo de dados e migrações

Nenhuma migração — schema novo, arquivo novo, store novo. Tipos em
`src/types/aik.ts` (novo):

```ts
export type AikColumnId = "backlog" | "in_progress" | "in_review" | "done";
// Sistema usa um conjunto de colunas PRÓPRIO (Q1 do PRD):
export type AikSystemColumnId = "ativo" | "pausado" | "arquivado";

export interface AikWorkspaceRefLocal {
  kind: "local";
  workspaceId: string;
  path: string;
}
export interface AikWorkspaceRefCloud {
  kind: "cloud";
  repository: { provider: string; fullName: string };
}
export type AikWorkspaceRef = AikWorkspaceRefLocal | AikWorkspaceRefCloud;

export interface AikSystem {
  id: string;
  name: string;
  backendId: string; // Backend.id (backend-registry/types.ts)
  workspaceRef: AikWorkspaceRef;
  columnId: AikSystemColumnId; // sob controle humano, nunca derivada (RF‑09 não se aplica aqui)
  mainConversationId?: string;
  activeAgentTaskId: string | null; // limite N1
  createdAt: string;
  updatedAt: string;
}

export interface AikPhase {
  id: string;
  systemId: string;
  title: string;
  description?: string;
  columnId: AikColumnId; // DERIVADA (RF-09) — nunca gravada por drag
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface AikTimelineEntry {
  id: string;
  at: string; // ISO
  kind: "comment" | "status_change" | "run_started" | "run_stopped" | "review_feedback";
  text?: string;
  fromColumnId?: AikColumnId;
  toColumnId?: AikColumnId;
}

export interface AikTask {
  id: string;
  phaseId: string;
  systemId: string; // desnormalizado — evita subir a árvore pra achar o sistema (RNF-02/03)
  title: string;
  description?: string;
  executorType: "human" | "agent";
  agentBriefing?: string;
  agentSkill?: string; // RF-18: skill é campo do card, padrão vazio = execução livre
  priority: "p0" | "p1" | "p2" | "p3";
  columnId: AikColumnId;
  order: number;
  blockedByTaskId?: string;
  checklist?: KanbanChecklistItem[]; // reaproveitado de src/types/kanban.ts:22, sem alteração
  linkedConversationId?: string;
  lastRunFilesChanged?: string[]; // RF-17
  timeline: AikTimelineEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AikSystemFile {
  version: 1;
  systemId: string;
  phases: AikPhase[];
  tasks: AikTask[];
  updatedAt: string;
}
```

`KanbanChecklistItem` é importado sem cópia de `src/types/kanban.ts:22` —
único ponto de reaproveitamento de tipo entre os dois módulos, e é
deliberadamente inofensivo (tipo puro, sem acoplamento de store).

---

## 4. Contratos: APIs, eventos, tipos públicos, assinaturas

### 4.1 Store `useAikBoardStore` (Zustand, `src/stores/aik-board-store.ts`)

```ts
interface AikBoardState {
  systems: AikSystem[];
  phasesBySystemId: Record<string, AikPhase[]>;
  tasksBySystemId: Record<string, AikTask[]>; // achatado por sistema, filtrado por phaseId na UI
}

interface AikBoardActions {
  createSystem(input: Pick<AikSystem, "name" | "backendId" | "workspaceRef">): AikSystem;
  renameSystem(systemId: string, name: string): void;
  deleteSystem(systemId: string): void;
  moveSystem(systemId: string, toColumnId: AikSystemColumnId): void; // manual, não derivada

  createPhase(systemId: string, title: string): AikPhase;
  deletePhase(phaseId: string): void;
  // sem moveTask/movePhase por drag manual em fase — RF-09 é sempre derivada

  createTask(phaseId: string, input: Partial<AikTask> & Pick<AikTask, "title">): AikTask;
  updateTask(taskId: string, patch: Partial<AikTask>): void;
  moveTask(taskId: string, toColumnId: AikColumnId, toOrder: number): void; // reindexAfterMove de kanban-tree.ts
  deleteTask(taskId: string): void;

  startAgent(taskId: string): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }>;
  stopAgent(taskId: string): Promise<void>;
  approveTask(taskId: string): void; // in_review -> done
  returnTask(taskId: string, feedback: string): void; // in_review -> in_progress, timeline += review_feedback

  syncFromFile(systemId: string): Promise<void>; // só para workspaceRef.kind === "local"
}
```

`moveTask` reaproveita `reindexAfterMove` de `src/utils/kanban-tree.ts:33`
por import direto — mesma assinatura de `{id, parentId→phaseId, columnId,
order}` mapeada por adapter fino (`phaseId` no lugar de `parentId` porque
tarefa não tem filhos no AIK, RF-09 já cobre agregação de fase sem
precisar de `collectDescendantIds`).

### 4.2 `buildAikAgentBriefing(task, phase, system, contextText): string`
(`src/api/aik-pipeline.api.ts`, substitui `buildFeatdevelopInitialMessage`
de `kanban-pipeline.api.ts:20`)

Monta a partir de `task` + herança direta de `phase`/`system` (nunca da
lista completa de tarefas — RNF-03), incluindo `task.agentSkill` só se
preenchido (RF-18: sem skill fixa). Contrato de retorno ao agente é análogo
ao `board.json` atual, mas aponta pro arquivo novo:

```
Ao concluir esta tarefa, edite `.openhands/aik/system.json` e mova o objeto
desta tarefa (id abaixo) para columnId="in_review".
```

### 4.3 `startAikAgentTask(system, task): Promise<Result<{conversationId}>>`

Chama `AgentServerConversationService.createConversation` (mesmo serviço de
`kanban-pipeline.api.ts:77`), guarda `conversationId` em `task
.linkedConversationId` e em `system.activeAgentTaskId`. Rejeita
antecipadamente (sem round-trip de rede) se `system.activeAgentTaskId` já
está ocupado por outra tarefa — implementa RF-13 revisado.

---

## 5. Alternativas consideradas e por que foram rejeitadas

**Alternativa A — segundo bundle/app React Router**, com
`react-router.config.aik.ts`, `vite.config.aik.ts`, diretório de build
próprio, segundo processo e segunda porta no `ingress.mjs`. Rejeitada: o
reconhecimento (§1.1) mostrou que isso duplica config de proxy e de build
sem ganho — o AIK não precisa de runtime JS diferente, só de rotas e telas
diferentes, e o risco R4 do PRD (custo de manter dois fronts) fica pior, não
melhor, com dois processos.

**Alternativa B — migrar `board.json`/`useKanbanBoardStore` para o schema do
AIK.** Rejeitada porque N5 do PRD proíbe migração automática, e porque as
colunas do kanban atual (`featdevelop_*`) são semânticas de outro fluxo —
forçar essas duas formas no mesmo tipo criaria uniões impossíveis de
validar. Schema e store paralelos, tipo compartilhado só onde é
genuinamente neutro (`KanbanChecklistItem`).

**Alternativa C — persistência de sistemas cloud também por arquivo**, via
alguma API de arquivo do agent-server remoto (não encontrada em §1.6, e
fora do escopo confirmar/inventar uma nova API do agent-server neste TECH).
Rejeitada para v1: exigiria mudança de contrato no backend Python
(fora deste repo, ver memória de projeto: agent-server não roda deste
código). Fica registrada como trabalho futuro; v1 aceita a limitação
client-side de §2.3 com aviso explícito.

**Alternativa D — quarto nível de baia real (sub-tarefa como kanban, não
checklist).** Já rejeitada no PRD (N2); tecnicamente confirmaria a suspeita
do usuário sobre "separado e confuso" se reintroduzida agora — mantido fora.

---

## 6. Segurança, permissões e privacidade

- Nenhuma chave de API de backend trafega para o arquivo `system.json` — o
  arquivo guarda `backendId`, nunca `Backend.apiKey` (RNF-04). Confirmado por
  desenho: `AikSystem.backendId` é `string`, resolvido contra
  `getRegisteredBackends()` em runtime, nunca serializado com o segredo.
- Conteúdo de `AikTask.description`/`agentBriefing`/comentários da timeline
  vem de arquivo escrito por agente — tratado como texto puro na UI (sem
  `dangerouslySetInnerHTML`), atende RNF-05. Se algum campo precisar de
  markdown no futuro, passa pelo mesmo sanitizador já usado no chat
  (`rehype-sanitize`, dependência já presente em `package.json`), não um
  novo.
- Comando de terminal (`cat`/`write_file`) roda com os mesmos privilégios de
  qualquer execução de comando hoje — nenhuma superfície nova de execução,
  reaproveita `AgentServerRuntimeService.executeCommand` sem alteração de
  contrato.

---

## 7. Performance e escala

- RNF-01/02: `syncFromFile` só roda ao entrar na rota do sistema (mesmo
  padrão de `useEffect` de `board-list.tsx:186-192`), não a cada navegação
  entre fase/tarefa do mesmo sistema já carregado — o store mantém tudo em
  memória por `systemId` uma vez sincronizado.
- Reindexação de drag (`reindexAfterMove`) é O(n) nos irmãos da coluna
  afetada, não no board inteiro — mesma característica já testada em
  `kanban-tree.test.ts`.
- RNF-03: `buildAikAgentBriefing` (§4.2) não itera a lista completa de
  tarefas do sistema, só o item e seus dois ancestrais diretos.

---

## 8. Observabilidade — logs, métricas, erros

- RNF-08: `startAikAgentTask`/`syncFromFile`/leitura-escrita de arquivo
  devolvem `Result<T, {errorType: "backend_down" | "workspace_unreachable" |
  "cloud_unsupported" | "conflict"}>` — mesmo padrão de retorno explícito já
  usado em `kanban-board-file.api.ts` (não lança exceção, não usa toast
  genérico).
- `displayErrorToast` (já usado em `run-agent-button.tsx:7,59`) é
  reaproveitado sem alteração para superficiar esses erros.
- RNF-09: `syncFromFile` que falha ao fazer parse de `system.json`
  (`JSON.parse` malformado ou schema com `version` desconhecido) marca só
  aquele sistema como `{status: "error", detail}` no store — não lança, não
  derruba `aik-systems-board.tsx`.

---

## 9. Estratégia de testes

- **Unidade**: `aik-board-store.test.ts` (criar/mover/derivar coluna de
  fase — RF-09, casos (a)-(e) do PRD, um teste por caso), `aik-pipeline.api
  .test.ts` (briefing não cresce com N tarefas — RNF-03, mesmo padrão de
  `kanban-pipeline.api.test.ts:325`), `aik-board-file.api.test.ts` (merge por
  card, caminho `.openhands/aik/system.json`, análogo a
  `kanban-board-file.api.test.ts:331`).
- **Integração**: cada rota (`aik-systems-board.test.tsx`,
  `aik-phases-board.test.tsx`, `aik-tasks-board.test.tsx`) — CRUD, drag via
  `@dnd-kit` (mesmo padrão de `kanban-board-dnd.test.tsx`), limite de um run
  por sistema (N1).
- **E2E**: um roteiro Playwright cobrindo M1 do PRD (≤4 cliques até
  executar), reaproveitando `playwright.config.ts` existente, sem config
  nova.

---

## 10. Rollout, feature flag e rollback

- Sem feature flag — o AIK é isolado por rota (`/aik/*`) e por vhost
  (`aik.zadotec.com.br`). Nada em `openhands.zadotec.com.br` muda de
  comportamento (RF-29), então não há necessidade de flag pra desativar em
  produção: remover o vhost Apache já isola o AIK sem afetar o resto.
- Rollback: reverter o commit que adiciona `host-gate.tsx`/`aik-routes.tsx`
  e o vhost Apache `aik.zadotec.com.br` — nenhuma migração de dado a
  desfazer (schema próprio, arquivo próprio). Como `host-gate.tsx` decide
  por hostname, remover o AIK do bundle é seguro mesmo com o vhost ainda no
  ar por um tempo (ele passaria a servir a versão anterior do app até o
  DNS/vhost também ser removido).

---

## 11. Rastreabilidade PRD → TECH

| PRD | Onde é atendido aqui |
|---|---|
| RF-01–04 (sistemas) | §2.2, §2.6 (`aik-systems-board.tsx`), §3 (`AikSystem`) |
| RF-05–09 (fases) | §2.6 (`aik-phases-board.tsx`), §3 (`AikPhase`), RF-09 casos (a)-(e) em §3 |
| RF-10–12 (tarefas/CRUD) | §3 (`AikTask`), §4.1 (`createTask`/`moveTask`/`deleteTask`) |
| RF-13–18 (execução) | §2.5, §4.3, RF-13 revisado (N1) em §2.5 e §4.3 |
| RF-19–21 (revisão) | §4.1 (`approveTask`/`returnTask`), §3 (`AikTimelineEntry`) |
| RF-22–25 (conversa) | §2.5 |
| RF-26–28 (persistência/contrato, incl. atualização ao vivo) | §2.3 (inclui polling de 4s para RF-27/M6), §4.2 |
| RF-29 (host próprio) | §2.1 |
| RNF-01/02 | §7 |
| RNF-03 | §4.2, §7 |
| RNF-04/05 | §6 |
| RNF-06/07 | segue padrão já existente de `dnd-kit` + `KeyboardSensor` (kanban-board.tsx:74-78) e classes Tailwind já validadas AA no restante do app — sem desenho novo necessário |
| RNF-08/09 | §8 |
| RNF-10 | reaproveita `react-i18next`/`I18nKey` sem alteração de mecanismo |
| RNF-11 | §9 |
| Q1 (colunas de sistema) | §3: `ativo \| pausado \| arquivado`, confirmado |
| Q2 (backend remoto) | §2.2 |
| Q3 (arquivo de quadro) | §2.3 |
| Q4 (coluna de sistema deriva de fases?) | §3: não — `columnId` de `AikSystem` é sempre manual, confirmado |

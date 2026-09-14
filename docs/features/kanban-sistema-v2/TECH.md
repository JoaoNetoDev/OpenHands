# TECH — kanban-sistema-v2

## 1. Estado atual da arquitetura nos pontos tocados

- **Sidebar**: `src/components/features/sidebar/sidebar-rail-body.tsx:388-402` — bloco `!collapsed` final, contém `SidebarOnboardingChecklist`, depois um `div` de rodapé com `AgentCanvasVersionTile` + `BackendSelector` (linha 400). É o único lugar da sidebar hoje escopado ao backend ativo.
- **Settings nav**: `OSS_NAV_ITEMS` em `src/constants/settings-nav.tsx:15-74`; entrada "Sistema" hoje entre `agent-context` e `verification` (linhas ~52-54 conforme a última sprint que a adicionou).
- **Criação de workspace já pronta**: `OpenWorkspaceDialog` (`src/components/features/home/open-workspace-dialog.tsx:11-21`) — `{ isOpen, onClose, onConfirm(workspace: LocalWorkspace) }`, já usa `WorkspaceSelectionForm` internamente. Reaproveitável sem alteração.
- **Perfis de LLM vs. Perfis de Agente são conceitos diferentes no app**: `useLlmProfiles()` (`src/hooks/query/use-llm-profiles.ts`) lista perfis de modelo puro (nome + modelo), sem noção de provedor ACP. `useAgentProfiles()` (`src/hooks/query/use-agent-profiles.ts:22-33`) lista `AgentProfileSummary[]` — cada item tem `id/name/agent_kind` (`agent_kind: "openhands" | "acp"`), mas **não** tem `acp_server`/o provedor específico (Claude Code vs. Codex vs. Gemini). O provedor específico só existe no objeto de detalhe por perfil, `AgentProfilesService.getProfile(name) → ACPAgentProfile` (com `acp_server`), buscado sob demanda — é exatamente o padrão já usado em `src/hooks/mutation/use-switch-acp-model.ts:69-96` (lista dá o `agent_kind` grosseiro; detalhe do perfil ativo é buscado à parte, um de cada vez, nunca em lote pra lista inteira). **O Sistema hoje usa o dropdown errado** (`useLlmProfiles`) — precisa trocar para `useAgentProfiles()` para a lista, seguindo esse mesmo padrão de detalhe sob demanda para o provedor específico (não N+1 chamadas pra cada item da lista).
- `getAcpProviderDisplayName` (`src/constants/acp-providers.ts:485`) tem assinatura `(key: string | null | undefined): string | null` — recebe a **chave do provedor** (`acp_server`, uma string), não um objeto de perfil inteiro. Confirmado contra os call sites reais (`acp-credentials-section.tsx:36`, `setup-acp-secrets-step.tsx:87`, `conversation-card-footer.tsx:107`).
- **Board hoje é 1-por-workspace, só em `localStorage`**: `src/stores/kanban-board-store.ts` — `tasksByWorkspaceId: Record<string, KanbanTask[]>`, sem `boardId`, `persist`+`createJSONStorage(() => localStorage)`. `src/types/kanban.ts` não tem `KanbanBoard` nem campo de checklist.
- **Escrita segura em arquivo já existe**: `escapeSingleQuoted`/`buildWriteFileCommand`/`toBase64` em `src/api/kanban-sintering.api.ts` (auditados adversarialmente, zero bypass sobrevivente); `readFeatureDoc`/`listFeatureSprintFiles` em `src/api/kanban-pipeline.api.ts` já leem arquivo do workspace sem conversa, com revalidação de slug/path (2 bypasses de traversal já corrigidos nessa mesma base).
- **Mensagem inicial da conversa já é pequena**: `buildFeatdevelopInitialMessage` (`src/api/kanban-pipeline.api.ts`) já serializa só título/descrição/contexto do card acionado — RF-11 é regressão a proteger, não funcionalidade nova.

## 2. Arquitetura proposta

### 2.1 Sidebar (RF-01, RF-02)

`sidebar-rail-body.tsx`: adicionar um `SidebarNavLink` para `/settings/system` **dentro** do bloco de rodapé (`!collapsed`), depois de `<BackendSelector .../>`, não na lista de nav principal. Continua sendo a mesma rota/página já existente — a entrada em `OSS_NAV_ITEMS`/Configurações **permanece** (não remover; muitos usuários vão continuar achando "Sistema" dentro de Configurações também, é um atalho a mais, não uma migração de rota).

### 2.2 Criação de workspace embutida (RF-03)

`system-settings.tsx` (já existe): adicionar um `isCreateWorkspaceOpen` state; item extra `{ key: "__create__", label: t(I18nKey.SYSTEM_SETTINGS$CREATE_WORKSPACE) }` no topo da lista de itens de `SettingsDropdownInput` de workspace; `onSelectionChange` com `key === "__create__"` abre `<OpenWorkspaceDialog isOpen onConfirm={(ws) => { setWorkspaceInput(ws.id); setCreateOpen(false); }} />` em vez de selecionar.

### 2.3 Perfil de LLM padrão com provedor (RF-04)

Trocar a fonte de dados de `useLlmProfiles()` para `useAgentProfiles()` em `system-settings.tsx`. A lista (`AgentProfileSummary[]`, campos `id/name/agent_kind`) já é suficiente para um rótulo grosseiro por item: `${profile.name} — ${profile.agent_kind === "acp" ? t(I18nKey.SYSTEM_SETTINGS$PROVIDER_ACP) : "OpenHands"}` (badge "ACP" vs. "OpenHands", sem N+1 de chamadas de detalhe pra cada item da lista renderizada). O provedor ACP específico (Claude Code/Codex/Gemini/etc., via `acp_server`) só é resolvido para o item **selecionado no momento** (não para todos os itens do dropdown): ao trocar a seleção, um `useQuery` separado chama `AgentProfilesService.getProfile(name)` (mesmo padrão de `use-switch-acp-model.ts:69-96`) e, quando resolver, atualiza um rótulo secundário abaixo do dropdown com `getAcpProviderDisplayName(detail.acp_server)` — string, não o objeto de perfil inteiro. `SystemSettings.defaultLlmProfileName` é renomeado internamente para `defaultAgentProfileId` (id do `AgentProfile`, não mais nome de LLM profile). Como o valor já é uma string opaca em `localStorage`, a migração é só ler o valor antigo como "provavelmente inválido" (não bate com nenhum `AgentProfileSummary.id`) — a reconciliação já existente em `system-settings.tsx` trata isso como "não selecionado", sem exigir migração de dado explícita.

### 2.4 Múltiplos quadros por workspace (RF-05, RF-06)

```ts
// src/types/kanban.ts — novo tipo
export interface KanbanBoard {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
}
```

`KanbanTask` ganha `boardId: string` (obrigatório daqui pra frente; migração cobre os registros antigos). Store (`kanban-board-store.ts`) ganha `boardsByWorkspaceId: Record<string, KanbanBoard[]>` e as ações `createBoard`/`renameBoard`/`deleteBoard`; `tasksByWorkspaceId` é reparticionado para `tasksByBoardId: Record<string, KanbanTask[]>` (chave trocada de `workspaceId` para `boardId` — mudança de shape, coberta por RNF-02).

Rotas: `/board` vira a **lista de quadros** do workspace ativo (nova tela); `/board/:boardId` é o board de 3 níveis já existente, só trocando a prop que hoje é `workspaceId` direto por `boardId` resolvido da URL (o componente interno não muda de forma nenhuma, só a chave usada nas queries da store).

**Migração (RNF-02)**: no primeiro `useKanbanBoardStore` hidratado a encontrar `tasksByWorkspaceId` no `localStorage` antigo (schema pré-v2) e nenhum `boardsByWorkspaceId`, uma função `migrateLegacyBoardShape` roda uma vez: para cada `workspaceId` com tarefas, cria um `KanbanBoard` chamado "Padrão" (`t(I18nKey.KANBAN$DEFAULT_BOARD_NAME)`) e move as tarefas daquele workspace pra `tasksByBoardId[novoBoardId]`. Zustand `persist` tem `migrate`/`version` para isso — usar a opção nativa (`version: 2`, função `migrate(persistedState, version)`) em vez de lógica manual fora do middleware.

### 2.5 Checklist por nível (RF-07)

```ts
// src/types/kanban.ts
export interface KanbanChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
```

`KanbanBoard` e `KanbanTask` ganham `checklist?: KanbanChecklistItem[]`. Componente `src/components/features/kanban/checklist-panel.tsx` (novo) — lista com input de texto + Enter pra adicionar, checkbox por item, botão de remover; reaproveitado tanto no drawer de tarefa quanto (novo) num painel de detalhes do quadro.

### 2.6 Persistência em arquivo (RF-08) — maior risco técnico desta revisão

```ts
// src/api/kanban-board-file.api.ts (novo)
export interface KanbanBoardFile {
  version: 1;
  boards: KanbanBoard[];
  tasksByBoardId: Record<string, KanbanTask[]>;
  updatedAt: string;
}

export async function readBoardFile(workspacePath: string, workspaceId: string):
  Promise<{ ok: true; data: KanbanBoardFile } | { ok: false; error: string }>;

export async function writeBoardFile(workspacePath: string, workspaceId: string, data: KanbanBoardFile):
  Promise<{ ok: true } | { ok: false; error: string }>;
```

Caminho: `<workspacePath>/.openhands/kanban/<workspaceId>/board.json` (mesma convenção de diretório já usada por `sinterizeTask`). `writeBoardFile` serializa com `JSON.stringify`, converte pra base64 (`toBase64`, reaproveitado de `kanban-sintering.api.ts`) e grava via `buildWriteFileCommand`/`escapeSingleQuoted` — **mesmo mecanismo já auditado**, nenhuma nova superfície de shell. `readBoardFile` usa `cat --` (mesmo padrão de `readFeatureDoc`), faz `JSON.parse` com `try/catch` (arquivo ausente/corrompido → `{ ok: false }`, nunca lança) e **valida o schema lido campo a campo** antes de aceitar o conteúdo — obrigatório porque, com o agente podendo escrever esse arquivo diretamente (RF-09), o conteúdo lido não é mais garantidamente produzido só pelo próprio frontend (ver §2.7). Validação mínima exigida (não só o envelope): `version === 1`; cada `KanbanBoard` tem `id`/`workspaceId`/`name` como string não vazia; cada `KanbanTask` tem `id`/`boardId`/`level ∈ {1,2,3}`/`columnId` pertencente ao union `KanbanColumnId` válido (rejeita qualquer string fora do enum conhecido — é exatamente o campo que o agente escreve em RF-09, então é o mais provável de vir malformado); tarefa com `columnId` desconhecido é descartada individualmente (log + ignorada), não derruba a leitura do arquivo inteiro.

`KanbanTask` ganha `updatedAt: string` (ISO, atualizado em toda mutação de campo), necessário para o merge tarefa-a-tarefa descrito abaixo.

`localStorage`/Zustand `persist` passa a ser **cache local**, não fonte de verdade: `useKanbanBoardStore` ganha uma ação `syncFromFile(workspaceId, workspacePath)` chamada ao entrar em `/board` (lista de quadros) e ao entrar num board específico — lê `board.json`, **faz merge** com o estado em memória em vez de substituir (ver mitigação de concorrência abaixo), e persiste o resultado. Toda mutação (`createBoard`, `createTask`, `moveTask`, etc.) continua escrevendo em `localStorage` **imediatamente** (otimista, latência zero pro usuário) e dispara `writeBoardFile` em background (debounced, 800ms) — falha de escrita no arquivo vira toast de erro (mesmo padrão de `trySet` já existente), mas não desfaz a mutação local.

**Concorrência (risco real, mitigado por merge por-tarefa, não por overwrite de snapshot)**: como o agente pode escrever `board.json` diretamente enquanto o navegador também escreve, um `writeBoardFile` ingênuo que sempre grava o snapshot inteiro do estado em memória do navegador apagaria qualquer mudança que o agente tivesse feito entre a última leitura e essa escrita (inclusive a própria transição pra `"pending_validation"` que RF-09 depende). Por isso `writeBoardFile` faz **read-modify-write**: lê o `board.json` atual do disco imediatamente antes de escrever, faz merge tarefa-a-tarefa por `id` (a versão mais recente por `updatedAt` de cada tarefa individual vence, não o documento inteiro), e só então grava o resultado mesclado. Isso reduz a janela de corrida de "documento inteiro" para "uma única tarefa editada nos dois lados ao mesmo tempo" — esse caso residual (mesma tarefa, mesmo instante, dois escritores) continua sendo last-write-wins e é aceito conscientemente (não-objetivo de tempo real, PRD §8), mas não é mais o caso comum de "qualquer edição concorrente em qualquer lugar do board perde dados".

**Perda de dado na janela do debounce (800ms)**: se o usuário fechar a aba dentro desse intervalo após uma mutação, a escrita em `board.json` pode não ter acontecido — a mutação fica só no `localStorage` daquele navegador. Aceito conscientemente (mesmo risco que já existia antes desta revisão, quando tudo vivia só em `localStorage`); documentado aqui para não ser lido como descoberta nova em revisão futura.

### 2.7 Fluxo de validação humano/agente (RF-09, RF-10)

Coluna nova, universal (não específica do preset featdevelop): `"pending_validation"` adicionada a `KanbanColumnId`. `KanbanTask` ganha `rejectionReason?: string`.

**Contrato documentado para o agente** (não uma ferramenta MCP nova — instrução textual na mensagem inicial da conversa, `buildFeatdevelopInitialMessage`, ampliada): quando o card tiver `linkedConversationId` setado (ou seja, a conversa foi originada por "Rodar com agente"), a mensagem inicial inclui um parágrafo explicando: caminho de `board.json`, formato do objeto da tarefa, e a instrução "ao concluir, edite seu próprio registro em `tasksByBoardId` trocando `columnId` para `"pending_validation"` e salvando o arquivo". Isso funciona porque o agente, dentro da sua conversa, já tem acesso de shell/arquivo ao workspace — não precisamos de uma ferramenta nova, só de uma instrução clara e de o frontend saber ler esse arquivo de volta (§2.6, incluindo validação de schema por desconfiar do que foi escrito por fora).

UI: `sinterize-button.tsx`/card com `columnId === "pending_validation"` mostra duas ações novas — `ApproveCardButton` (`updateTask({ columnId: "done" })`, ação de "arquivar" simplificada nesta revisão como só mudar de coluna, sem tela de arquivo morto separada) e `RejectCardButton` (abre um input de texto obrigatório, `updateTask({ columnId: "todo", rejectionReason })`). `rejectionReason` é exibido no `card-context-panel.tsx` como um bloco destacado, visível tanto pro humano quanto — na próxima vez que "Rodar com agente" for clicado — incluído na mensagem inicial da nova conversa (retomada).

## 3. Modelo de dados e migrações

Ver §2.4 (migração de schema do Zustand `persist`, versão 2) e §2.6 (novo arquivo `board.json`, schema versionado com `version: 1` próprio, independente do versionamento do `persist`).

## 4. Contratos: APIs, eventos, tipos públicos, assinaturas

Ver §2.4 (`KanbanBoard`), §2.5 (`KanbanChecklistItem`), §2.6 (`readBoardFile`/`writeBoardFile`/`KanbanBoardFile`). `KanbanColumnId` ganha `"pending_validation"`. `KanbanTask` ganha `boardId`, `checklist?`, `rejectionReason?`.

## 5. Alternativas consideradas e por que foram rejeitadas

- **Ferramenta MCP dedicada para o agente mover cards**: rejeitada — exigiria expor um servidor MCP novo, registrar credenciais, e ainda assim o agente teria que ser instruído a usá-la; como o agente já tem shell/arquivo no seu próprio sandbox, editar `board.json` diretamente é estritamente mais simples e reaproveita 100% do que já existe. Custo: nenhuma garantia de schema na escrita do agente — mitigado validando na leitura (§2.6).
- **Trocar `localStorage` por `board.json` como única fonte de verdade (sem cache local)**: rejeitada — toda mutação passaria a depender de round-trip com `execute_bash_command` (latência perceptível, UX pior que hoje). Mantido como cache-then-sync.
- **Renomear/reaproveitar `LlmProfile` para carregar provedor**: rejeitada — `AgentProfile` já modela exatamente isso; duplicar o conceito em `LlmProfile` seria trabalho redundante e uma segunda fonte de verdade para a mesma informação.

## 6. Segurança, permissões e privacidade

`board.json` lido de volta é tratado como entrada não confiável (schema validado, nunca interpretado como código) — ver §2.6. Toda escrita feita pelo frontend continua 100% dentro do mecanismo já auditado (base64 + `escapeSingleQuoted` + `dirname` entre aspas duplas + revalidação de path). Nenhuma superfície de shell nova.

## 7. Performance e escala

Debounce de 800ms na escrita evita um `execute_bash_command` por tecla digitada. Leitura de `board.json` só ao entrar na lista de quadros/no board — sem polling.

## 8. Observabilidade — logs, métricas, erros

Falha de `writeBoardFile`/`readBoardFile` vira toast (mesmo padrão de `sinterizeTask`/`trySet`). `updatedAt` do arquivo fica visível na UI ("atualizado pela última vez em...") para o usuário perceber desatualização sem precisar de sincronização em tempo real (não-objetivo).

## 9. Estratégia de testes

- Unidade: `migrateLegacyBoardShape`/versão 2 do `persist` — estado v1 (sem `boardId`) vira um quadro "Padrão" por workspace, sem perda de tarefa.
- Unidade: `readBoardFile`/`writeBoardFile` — round-trip, schema inválido tratado como "não existe" (não lança, não quebra a UI), payloads adversariais no `workspacePath` (mesmos testes de segurança já usados nos sub-projetos anteriores).
- Integração: criar 2 quadros no mesmo workspace, confirmar isolamento total de tarefas.
- Integração: reprovar card grava `rejectionReason`, muda `columnId`, e a próxima mensagem inicial de conversa inclui o motivo.
- Unidade: `buildFeatdevelopInitialMessage` com um workspace de 50 tarefas simuladas → tamanho da mensagem não cresce com a quantidade de tarefas (RNF-03).

## 10. Rollout, feature flag e rollback

Sem feature flag. Rollback: reverter para ler só `localStorage` (a migração de schema do `persist` é aditiva — o `version: 2` só roda uma vez; reverter o código não desfaz dado já migrado, mas não perde nada, já que o shape v2 é um superconjunto do v1 por workspace). `board.json` órfão no workspace do usuário, se a feature for revertida, fica inofensivo (arquivo não lido por nada).

## 11. Rastreabilidade RF/RNF → onde é atendido

| Requisito | Onde |
|---|---|
| RF-01, RF-02 | §2.1 |
| RF-03 | §2.2 (`OpenWorkspaceDialog` reaproveitado) |
| RF-04 | §2.3 (`useAgentProfiles` + `getAcpProviderDisplayName`) |
| RF-05, RF-06 | §2.4 |
| RF-07 | §2.5 |
| RF-08 | §2.6 |
| RF-09, RF-10 | §2.7 |
| RF-11 | regressão coberta em §9 |
| RNF-01 | §6 |
| RNF-02 | §2.4 migração |
| RNF-03 | §9 |

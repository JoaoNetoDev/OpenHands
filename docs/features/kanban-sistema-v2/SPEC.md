# SPEC — kanban-sistema-v2

## 1. Resumo e escopo

Revisão em cima dos 4 sub-projetos já integrados: promove "Sistema" pra sidebar, adiciona criação de workspace embutida, perfil de agente ciente de provedor ACP, múltiplos quadros por workspace, checklist por nível, persistência do board em arquivo (`board.json`) com merge tarefa-a-tarefa, e fluxo de validação humano/agente via coluna "pending_validation".

## 2. Desenho detalhado por componente

### 2.1 Sidebar (`sidebar-rail-body.tsx`, alterar)

```tsx
{!collapsed ? (
  <>
    <div className="mb-2 shrink-0 pr-2.5">
      <SidebarOnboardingChecklist collapsed={collapsed} />
    </div>
    <div className={cn(/* footer classes já existentes */)}>
      <AgentCanvasVersionTile hideWhenUpToDate />
      <BackendSelector sidebarCollapsed={collapsed} openUpward />
      <SidebarNavLink
        to="/settings/system"
        icon={<Settings2 width={ICON_SIZE} height={ICON_SIZE} />}
        label={t(I18nKey.SETTINGS$NAV_SYSTEM)}
        testId="sidebar-system-link"
      />
    </div>
  </>
) : null}
```
No modo colapsado, adicionar o mesmo item ao popover de ícones colapsados que já existe pra outros atalhos (mesma estrutura do `collapsed-backend-selector-link`, adaptada).

### 2.2 Criação de workspace embutida (`system-settings.tsx`, alterar)

```tsx
const CREATE_WORKSPACE_KEY = "__create__";
// ...
<SettingsDropdownInput
  items={[
    { key: CREATE_WORKSPACE_KEY, label: t(I18nKey.SYSTEM_SETTINGS$CREATE_WORKSPACE) },
    ...workspaceItems,
  ]}
  onSelectionChange={(key) => {
    if (key === CREATE_WORKSPACE_KEY) { setIsCreateWorkspaceOpen(true); return; }
    setWorkspaceInput(key?.toString());
  }}
/>
<OpenWorkspaceDialog
  isOpen={isCreateWorkspaceOpen}
  onClose={() => setIsCreateWorkspaceOpen(false)}
  onConfirm={(ws) => { setWorkspaceInput(ws.id); setIsCreateWorkspaceOpen(false); }}
/>
```

### 2.3 Perfil de agente com provedor (`system-settings.tsx`, alterar)

```tsx
const { data: agentProfiles } = useAgentProfiles();
const selectedProfile = agentProfiles?.profiles.find((p) => p.id === profileInput);
const { data: profileDetail } = useQuery({
  queryKey: ["agent-profile-detail", selectedProfile?.name],
  queryFn: () => AgentProfilesService.getProfile(selectedProfile!.name),
  enabled: !!selectedProfile && selectedProfile.agent_kind === "acp",
});
const providerLabel = profileDetail?.acp_server
  ? getAcpProviderDisplayName(profileDetail.acp_server)
  : null;

const agentProfileItems = agentProfiles?.profiles.map((p) => ({
  key: p.id,
  label: `${p.name} — ${p.agent_kind === "acp" ? t(I18nKey.SYSTEM_SETTINGS$PROVIDER_ACP) : "OpenHands"}`,
})) ?? [];
```
Rótulo secundário abaixo do dropdown, visível só quando `providerLabel` resolve: `t(I18nKey.SYSTEM_SETTINGS$PROVIDER_DETAIL, { provider: providerLabel })`.

### 2.4 Múltiplos quadros (`src/types/kanban.ts`, `src/stores/kanban-board-store.ts`, alterar; `src/routes/board-list.tsx`, novo)

```ts
export interface KanbanBoard {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  checklist?: KanbanChecklistItem[];
}

export interface KanbanTask {
  // ...campos existentes
  boardId: string; // substitui a antiga partição por workspaceId
  updatedAt: string;
  checklist?: KanbanChecklistItem[];
}
```

Store:
```ts
interface KanbanBoardState {
  boardsByWorkspaceId: Record<string, KanbanBoard[]>;
  tasksByBoardId: Record<string, KanbanTask[]>;
}
```
`persist` com `version: 2` e `migrate(persistedState, version)`: se `version < 2`, lê o antigo `tasksByWorkspaceId`, cria um `KanbanBoard` "Padrão" por `workspaceId` com tarefas, popula `boardsByWorkspaceId`/`tasksByBoardId`, descarta a chave antiga.

`route("board", "routes/board-list.tsx")` (lista de quadros do workspace ativo, com criar/renomear/excluir) substitui o antigo `kanban-board.tsx` como destino de `/board`; `route("board/:boardId", "routes/kanban-board.tsx")` é o board de 3 níveis já existente, alterado só para resolver `boardId` da URL em vez de usar `workspaceId` direto nas queries da store.

### 2.5 Checklist (`src/components/features/kanban/checklist-panel.tsx`, novo)

```tsx
interface ChecklistPanelProps {
  items: KanbanChecklistItem[];
  onChange: (items: KanbanChecklistItem[]) => void;
}
```
Input de texto + Enter adiciona (`{ id: uuidv4(), text, done: false }`); cada item com checkbox (`onChange` troca `done`) e botão de remover. Integrado no `kanban-task-drawer.tsx` (qualquer nível) e num novo painel de detalhes de quadro (`board-detail-panel.tsx`, aberto a partir da lista de quadros).

### 2.6 Persistência em arquivo (`src/api/kanban-board-file.api.ts`, novo)

```ts
export interface KanbanBoardFile {
  version: 1;
  boards: KanbanBoard[];
  tasksByBoardId: Record<string, KanbanTask[]>;
  updatedAt: string;
}

function isValidColumnId(value: unknown): value is KanbanColumnId {
  return typeof value === "string" && ALL_COLUMN_IDS.includes(value as KanbanColumnId);
}

function parseBoardFile(raw: string): KanbanBoardFile | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Partial<KanbanBoardFile>;
  if (p.version !== 1 || !Array.isArray(p.boards) || typeof p.tasksByBoardId !== "object") return null;
  const boards = p.boards.filter((b) => typeof b?.id === "string" && typeof b?.workspaceId === "string" && typeof b?.name === "string");
  const knownBoardIds = new Set(boards.map((b) => b.id));
  const tasksByBoardId: Record<string, KanbanTask[]> = {};
  for (const [boardId, tasks] of Object.entries(p.tasksByBoardId ?? {})) {
    // boardId órfão (não bate com nenhum KanbanBoard válido, ex. quadro
    // apagado entre a leitura e a escrita) é descartado por inteiro aqui —
    // obrigatório, não opcional: sem este `if`, tarefas ficam presas sob uma
    // chave que a UI de listagem de quadros nunca itera, invisíveis mas
    // nunca limpas do arquivo.
    if (!knownBoardIds.has(boardId)) continue;
    tasksByBoardId[boardId] = (Array.isArray(tasks) ? tasks : []).filter(
      (t) => typeof t?.id === "string" && t?.boardId === boardId &&
        [1, 2, 3].includes(t?.level) && isValidColumnId(t?.columnId),
    );
  }
  return { version: 1, boards, tasksByBoardId, updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date(0).toISOString() };
}

export async function readBoardFile(
  workspacePath: string, workspaceId: string,
): Promise<{ ok: true; data: KanbanBoardFile } | { ok: false; error: string }> {
  // Local-only, mesma limitação já documentada em kanban-card-contexto-arquivos:
  // execute_bash_command sem conversa só funciona contra o agent-server local.
  // Chamador (kanban-board-store.ts) deve checar getActiveBackend().backend.kind
  // ANTES de chamar readBoardFile/writeBoardFile — em Cloud, nem tenta, e o
  // board permanece só em localStorage (mesmo comportamento da v1).
  if (getActiveBackend().backend.kind === "cloud") {
    return { ok: false, error: "cloud_unsupported" };
  }
  try {
    const path = `${workspacePath}/.openhands/kanban/${workspaceId}/board.json`;
    const result = await AgentServerRuntimeService.executeCommand(
      null, null, `cat -- ${escapeSingleQuoted(path)}`, workspacePath,
    );
    if (result.exit_code !== 0) return { ok: false, error: "not_found" };
    const parsed = parseBoardFile(result.stdout);
    if (!parsed) return { ok: false, error: "invalid_schema" };
    return { ok: true, data: parsed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}

export async function writeBoardFile(
  workspacePath: string, workspaceId: string, next: KanbanBoardFile,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (getActiveBackend().backend.kind === "cloud") {
    return { ok: false, error: "cloud_unsupported" };
  }
  try {
    // read-modify-write: mescla contra o que está no disco agora, tarefa a
    // tarefa por updatedAt, para não sobrescrever mudanças feitas pelo
    // agente entre a última leitura e esta escrita (TECH §2.6).
    const current = await readBoardFile(workspacePath, workspaceId);
    const merged = current.ok ? mergeBoardFiles(current.data, next) : next;
    const contentBase64 = await toBase64(new TextEncoder().encode(JSON.stringify(merged)).buffer);
    const path = `${workspacePath}/.openhands/kanban/${workspaceId}/board.json`;
    const result = await AgentServerRuntimeService.executeCommand(
      null, null, buildWriteFileCommand(path, contentBase64), workspacePath,
    );
    if (result.exit_code !== 0) return { ok: false, error: result.stderr || "write_failed" };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}

function mergeBoardFiles(disk: KanbanBoardFile, incoming: KanbanBoardFile): KanbanBoardFile {
  const tasksByBoardId: Record<string, KanbanTask[]> = {};
  const boardIds = new Set([...Object.keys(disk.tasksByBoardId), ...Object.keys(incoming.tasksByBoardId)]);
  for (const boardId of boardIds) {
    const byId = new Map<string, KanbanTask>();
    for (const t of disk.tasksByBoardId[boardId] ?? []) byId.set(t.id, t);
    for (const t of incoming.tasksByBoardId[boardId] ?? []) {
      const existing = byId.get(t.id);
      if (!existing || new Date(t.updatedAt) >= new Date(existing.updatedAt)) byId.set(t.id, t);
    }
    tasksByBoardId[boardId] = Array.from(byId.values());
  }
  const boardsById = new Map(disk.boards.map((b) => [b.id, b]));
  for (const b of incoming.boards) boardsById.set(b.id, b); // boards não têm updatedAt granular — incoming vence
  return { version: 1, boards: Array.from(boardsById.values()), tasksByBoardId, updatedAt: new Date().toISOString() };
}
```

Debounce de escrita: `debouncedWriteBoardFile` (800ms) em `kanban-board-store.ts`, chamado a cada mutação; falha vira `displayErrorToast(t(I18nKey.KANBAN$BOARD_FILE_SAVE_ERROR))`.

### 2.7 Fluxo de validação (`src/types/kanban.ts` alterar; `src/components/features/kanban/approve-reject-buttons.tsx`, novo)

`KanbanColumnId` ganha `"pending_validation"`. `KanbanTask.rejectionReason?: string`.

```tsx
function ApproveRejectButtons({ workspaceId, task }: Props) {
  if (task.columnId !== "pending_validation") return null;
  const [isRejecting, setIsRejecting] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const handleApprove = () => updateTask(workspaceId, task.id, { columnId: "done" });
  const handleReject = () => {
    if (!reason.trim()) return;
    updateTask(workspaceId, task.id, { columnId: "todo", rejectionReason: reason.trim() });
    setIsRejecting(false);
    setReason("");
  };
  // ...botões Aprovar / Reprovar (abre input de motivo obrigatório)
}
```

`buildFeatdevelopInitialMessage` (alterar, `kanban-pipeline.api.ts`): se `task.rejectionReason` estiver definido, inclui um parágrafo "Esta tarefa foi reprovada anteriormente pelo motivo: ...". Se `task.linkedConversationId` (ou seja, a conversa parte de um card do pipeline), inclui o parágrafo de contrato do `board.json`: caminho do arquivo, formato mínimo do objeto de tarefa, instrução de trocar `columnId` para `"pending_validation"` ao concluir.

## 3. Fluxo principal passo a passo e fluxos de erro

**Fluxo principal**: usuário troca de backend → vê "Sistema" logo abaixo do seletor → cria/seleciona workspace ali mesmo → escolhe perfil de agente (vê o provedor) → vai em "Quadro" → cria 2-3 quadros por módulo → entra num quadro → cria tarefas com checklist → roda o agente numa tarefa de nível 1 → agente termina, edita `board.json`, card aparece em "Aguardando validação" na próxima sincronização → humano aprova ou reprova com motivo.

**Fluxos de erro**:
- `board.json` corrompido/schema inválido → tratado como arquivo vazio na leitura (RNF do TECH §2.6), tarefas individuais malformadas são descartadas sem derrubar as demais.
- Escrita falha (disco cheio, permissão) → toast, mutação permanece só em `localStorage` até a próxima tentativa bem-sucedida.
- Dois escritores simultâneos na mesma tarefa → last-write-wins por `updatedAt` (aceito, TECH §2.6).
- Perfil de agente apagado depois de definido como padrão → mesma reconciliação já existente (SPEC v1 §2.4), trata como "não selecionado".

## 4. Casos de borda

- Workspace sem nenhum quadro ainda → lista de quadros mostra estado vazio com CTA "Criar quadro".
- Excluir um quadro com tarefas → confirmação com contagem total de tarefas (todos os níveis), mesma UX de `delete-task-confirm-dialog.tsx`.
- Migração de schema roda uma única vez por navegador (Zustand `persist` versiona o estado, não reexecuta a cada load).
- Tarefa com `columnId: "pending_validation"` escrita pelo agente com um `boardId` que não existe mais (quadro apagado nesse meio tempo) → descartada na leitura (`parseBoardFile` acima já faz esse cross-check contra `knownBoardIds`, CA-08b).
- Backend ativo é Cloud → `readBoardFile`/`writeBoardFile` retornam `{ ok: false, error: "cloud_unsupported" }` imediatamente, sem tentar `execute_bash_command`; board permanece só em `localStorage` (mesmo comportamento da v1, CA-12).

## 5. Mudanças arquivo a arquivo

| Arquivo | Ação | O que muda |
|---|---|---|
| `src/components/features/sidebar/sidebar-rail-body.tsx` | alterar | link "Sistema" no rodapé |
| `src/routes/system-settings.tsx` | alterar | criação de workspace embutida, perfil de agente+provedor |
| `src/types/kanban.ts` | alterar | `KanbanBoard`, `KanbanChecklistItem`, `boardId`/`updatedAt`/`checklist`/`rejectionReason` em `KanbanTask`, `"pending_validation"` em `KanbanColumnId` |
| `src/stores/kanban-board-store.ts` | alterar | `boardsByWorkspaceId`/`tasksByBoardId`, migração v2, ações de quadro, `debouncedWriteBoardFile` |
| `src/api/kanban-board-file.api.ts` | criar | `readBoardFile`/`writeBoardFile`/`mergeBoardFiles`/`parseBoardFile` |
| `src/routes/board-list.tsx` | criar | lista de quadros do workspace |
| `src/routes/kanban-board.tsx` | alterar | resolve `boardId` da URL em vez de `workspaceId` direto |
| `src/components/features/kanban/checklist-panel.tsx` | criar | checklist reutilizável |
| `src/components/features/kanban/board-detail-panel.tsx` | criar | detalhe/checklist de quadro |
| `src/components/features/kanban/approve-reject-buttons.tsx` | criar | aprovar/reprovar |
| `src/api/kanban-pipeline.api.ts` | alterar | `buildFeatdevelopInitialMessage` inclui contrato de `board.json` + motivo de rejeição |
| `src/routes.ts` | alterar | `board` vira lista, `board/:boardId` vira o board de 3 níveis |
| `src/components/features/kanban/delete-task-confirm-dialog.tsx` | reaproveitar (referência) | padrão de confirmação com contagem, copiado para exclusão de quadro (não alterado em si) |
| `src/i18n/declaration.ts`, `src/i18n/translation.json` | alterar | chaves novas |

## 6. Critérios de aceitação

- **CA-01**: item "Sistema" navega a partir da sidebar sem passar por `/settings`.
- **CA-02**: criar workspace pelo dropdown do Sistema persiste e seleciona automaticamente, sem navegação de rota.
- **CA-03**: dropdown de perfil mostra `agent_kind` (ACP/OpenHands) por item, e o provedor específico (ex. "Claude Code") aparece ao selecionar um perfil ACP.
- **CA-04**: criar 2 quadros no mesmo workspace mantém tarefas totalmente isoladas (`getChildren`/leitura por `boardId`).
- **CA-05**: migração v1→v2 do `persist` transforma tarefas antigas (sem `boardId`) num quadro "Padrão", sem perda.
- **CA-06**: checklist adiciona/marca/remove item em um card e num quadro.
- **CA-07**: `writeBoardFile` faz merge tarefa-a-tarefa (teste: disco tem tarefa A editada depois da leitura do navegador; escrita do navegador não apaga a edição de A, só grava o que o navegador de fato mudou).
- **CA-08**: `readBoardFile` com schema inválido retorna erro sem lançar; com uma tarefa malformada no meio de uma lista válida, descarta só aquela tarefa.
- **CA-09**: card em "pending_validation" mostra Aprovar/Reprovar; Aprovar move para "done"; Reprovar exige motivo, grava `rejectionReason`, move para "todo".
- **CA-10**: `buildFeatdevelopInitialMessage` para card com `rejectionReason` inclui o motivo; para card sem `linkedConversationId` não inclui o contrato de `board.json` (só cards de pipeline precisam dessa instrução).
- **CA-11**: mensagem inicial não cresce com o número de tarefas do workspace (RNF-03, teste com 50 tarefas simuladas).
- **CA-08b** (RF-09, robustez): `board.json` com uma tarefa referenciando um `boardId` que não está em `boards[]` é descartada na leitura, sem aparecer em nenhum quadro nem quebrar o parse do restante do arquivo.
- **CA-12** (RNF-01, não-objetivo de Cloud documentado): com `getActiveBackend().backend.kind === "cloud"` mockado, `readBoardFile`/`writeBoardFile` retornam `cloud_unsupported` sem chamar `executeCommand`.
- **CA-13** (RNF-04): `npm run make-i18n` roda sem erro após as chaves novas (mesma verificação indireta já usada nos sub-projetos anteriores — falha do `check-translation-completeness` no pre-commit hook é o gate real).

## 7. Plano de testes

- Unidade: `parseBoardFile`/`mergeBoardFiles` — schema válido, inválido, tarefa malformada isolada, merge por `updatedAt`, `boardId` órfão descartado.
- Unidade: migração de `persist` v1→v2.
- Integração: fluxo completo de CA-01 a CA-06, CA-09, CA-10.
- Unidade: `readBoardFile`/`writeBoardFile` com os mesmos payloads adversariais já usados em `kanban-sintering.api.test.ts`/`kanban-pipeline.api.test.ts` (aspas, backticks, `$()`, `..`, espaço no path) — reaproveitar o mesmo arsenal de teste, não reinventar.

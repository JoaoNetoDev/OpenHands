# TECH — kanban-3-niveis

## 1. Estado atual da arquitetura nos pontos tocados

- **Sem board hoje**: confirmado por busca — nenhuma implementação de kanban/drag-and-drop em `src/` (único hit é o ícone decorativo `SquareKanban`, `src/components/features/conversation-panel/conversation-card/conversation-tag-icons.ts:24,94,133`).
- **Sem biblioteca de DnD**: `package.json` não lista `@dnd-kit/*`, `react-dnd` nem `react-beautiful-dnd`.
- **Padrão de estado local persistente já estabelecido no projeto**: Zustand + middleware `persist` + `createJSONStorage(() => localStorage)`, visto em `src/stores/archived-conversations-store.ts:1-2,33-83` (inclusive o padrão de "estado indexado por uma chave de escopo" — ali por `backendId`, aqui será por `workspaceId`) e `src/stores/sidebar-store.ts:1-2,17-30`. Este é o padrão a seguir, não o `localStorage` cru usado no sub-projeto 1 (lá optou-se por não trazer Zustand para um caso de 3 campos; aqui o caso justifica, dado o volume de dados em árvore).
- **Geração de id**: `uuid` já é dependência direta (`package.json:68`), usado em `src/api/conversation-service/agent-server-conversation-service.api.ts:13,479` e `src/stores/model-store.ts:3,94`. Usar o mesmo padrão (`import { v4 as uuidv4 } from "uuid"`) em vez de `crypto.randomUUID()` (que também aparece no repo só em `src/mocks/*`, não em código de produção).
- **Workspace ativo**: `useSystemSettings()` (sub-projeto `sistema-settings-menu`) expõe `settings.defaultWorkspaceId`; workspace atualmente selecionado na sessão vem de um mecanismo já existente fora desta feature (contexto/rota já usado por `files-tab.tsx` e o seletor de workspace) — a TECH não deve reimplementar isso, só consumir o id do workspace ativo, seja qual for a fonte.
- **Componentes de UI**: `@heroui/react@2.8.10` está instalado; possui `Card`/`Button`/`Chip` prontos, usados em outras telas do projeto (padrão a seguir para os cards do board).

## 2. Arquitetura proposta

### 2.1 Nova dependência: drag-and-drop

Adicionar `@dnd-kit/core` + `@dnd-kit/sortable` (+ `@dnd-kit/utilities`) como dependências novas. Critério de escolha (declarado, não assumido): mantido ativamente, sem dependência de `react-dom` legada tipo `react-beautiful-dnd` (arquivado), suporte nativo a teclado (`KeyboardSensor`) exigido por RNF-02, e tree-shakeable (não traz um runtime pesado). Esta é uma dependência nova e deve constar explicitamente na SPEC como mudança de `package.json` — ao contrário do episódio do sub-projeto 1 (onde uma dependência transitiva foi erroneamente tratada como já disponível), aqui a introdução é assumida e documentada desde já.

### 2.2 Modelo de dados

```ts
// src/types/kanban.ts (novo)
export type KanbanColumnId = "todo" | "in_progress" | "done";

export interface KanbanTask {
  id: string;
  parentId: string | null; // null = nível 1
  level: 1 | 2 | 3;
  title: string;
  description?: string;
  columnId: KanbanColumnId;
  order: number; // posição dentro da coluna, entre irmãos de mesmo parentId
  createdAt: string; // ISO
}
```

Árvore representada de forma achatada (`KanbanTask[]`), não aninhada — mais simples de reordenar/persistir e de consultar "todos os filhos de X" via `filter(t => t.parentId === id)`. Nível é redundante com a profundidade de `parentId` mas guardado explicitamente para não recalcular recursivamente a cada render (trade-off de espaço por simplicidade de leitura, aceitável para até ~200 cards por RNF-01).

### 2.3 Store

```ts
// src/stores/kanban-board-store.ts (novo)
interface KanbanBoardState {
  tasksByWorkspaceId: Record<string, KanbanTask[]>;
}
interface KanbanBoardActions {
  createTask: (workspaceId: string, input: { title: string; description?: string; parentId: string | null }) => void;
  updateTask: (workspaceId: string, taskId: string, patch: Partial<Pick<KanbanTask, "title" | "description">>) => void;
  deleteTask: (workspaceId: string, taskId: string) => void; // remove descendentes em cascata
  moveTask: (workspaceId: string, taskId: string, toColumnId: KanbanColumnId, toOrder: number) => void;
  getChildren: (workspaceId: string, parentId: string | null) => KanbanTask[];
}
```

Segue exatamente o formato de `archived-conversations-store.ts:33-83` (estado indexado por chave de escopo, ações que leem `get()` antes de `set()`), trocando `archivesByBackendId` por `tasksByWorkspaceId` e `backendId` por `workspaceId`. `persist` com `name: "openhands-kanban-board"`, `storage: createJSONStorage(() => localStorage)`, `partialize` devolvendo só `tasksByWorkspaceId` (mesmo padrão de `archived-conversations-store.ts:78-82`).

`deleteTask` calcula descendentes por BFS sobre `parentId` antes de filtrar o array — função pura auxiliar `collectDescendantIds(tasks, taskId)` testável isoladamente, com um `Set<string>` de visitados desde o início do percurso: qualquer id já visitado é ignorado em vez de reenfileirado, o que também limita o algoritmo a `O(n)` mesmo se o dado tiver sido corrompido manualmente em `localStorage` (ex.: `parentId` formando um ciclo, ou auto-referência `task.parentId === task.id`) — sem essa guarda, uma BFS ingênua sobre um ciclo trava em loop infinito.

`createTask` recusa (retorna sem efeito, chamador não deveria nem oferecer a ação na UI) criar filho de uma tarefa de nível 3 — a UI nunca oferece "adicionar subtarefa" num card de nível 3 (RF-04), então a guarda na store é defensiva, não o único ponto de checagem.

### 2.4 UI

- `src/routes/kanban-board.tsx` (nova rota, fora do bloco `settings` em `src/routes.ts` — ex.: `route("board", "routes/kanban-board.tsx")` no nível do layout raiz, ao lado de `conversations`/`launch`).
- `src/components/features/kanban/kanban-column.tsx` — uma das 3 colunas fixas, área de `useDroppable` (dnd-kit).
- `src/components/features/kanban/kanban-card.tsx` — card individual (`useSortable` do dnd-kit), mostra título, contagem de subtarefas concluídas (RF-08) quando `getChildren(...).length > 0`, botão para abrir o nível seguinte.
- `src/components/features/kanban/kanban-task-drawer.tsx` — painel/drawer que abre ao clicar num card, mostrando seus filhos como um mini-board do nível seguinte (mesmas 3 colunas, escopadas a `parentId`), permitindo navegar Nível 1 → 2 → 3 sem trocar de rota.
- `src/components/features/kanban/create-task-modal.tsx` — formulário mínimo (título + descrição) reaproveitado nos 3 níveis via prop `parentId`.
- `src/components/features/kanban/delete-task-confirm-dialog.tsx` — confirmação com contagem de descendentes (RF-06), usando `collectDescendantIds` para exibir "isso vai remover N subtarefas".

## 3. Modelo de dados e migrações

Sem backend/migração. Chave `localStorage`: `openhands-kanban-board` (gerenciada pelo `persist` do Zustand, não por código manual — diferente do sub-projeto 1, que não usou Zustand). Sem versionamento de schema nesta v1 (mesmo trade-off do sub-projeto 1, documentado como YAGNI).

## 4. Contratos: APIs, eventos, tipos públicos, assinaturas

Ver §2.2 (`KanbanTask`) e §2.3 (`useKanbanBoardStore` — ações listadas). Este é o contrato que o sub-projeto `kanban-card-contexto-arquivos` estende (adicionando campos ao `KanbanTask`, não trocando a store) e que `kanban-pipeline-featdevelop` consome para customizar `KanbanColumnId`/rótulos.

## 5. Alternativas consideradas e por que foram rejeitadas

- **`react-beautiful-dnd`**: arquivado (sem manutenção ativa) — rejeitado por risco de segurança/compatibilidade de longo prazo.
- **Árvore aninhada em vez de lista achatada com `parentId`**: mais intuitiva para renderizar recursivamente, mas complica reordenar dentro de uma coluna (teria que navegar a árvore para achar irmãos) e complica persistência incremental via `persist`. Lista achatada + índice por `parentId` calculado em memória (`getChildren`) é mais simples de testar e de estender no sub-projeto 3.
- **Uma store por nível** (3 stores): rejeitada — nível é um atributo do dado, não uma partição natural de estado; uma store só simplifica `deleteTask` em cascata (teria que coordenar 3 stores).

## 6. Segurança, permissões e privacidade

Sem dados sensíveis. Título/descrição são texto simples (não HTML) nesta fase — sem necessidade de sanitização (o campo de HTML rico fica no sub-projeto 3, escopado ao contexto do card, não ao título/descrição).

## 7. Performance e escala

`@dnd-kit` já é otimizado para listas de centenas de itens sem virtualização adicional; RNF-01 (200 cards) fica dentro do que a biblioteca suporta sem otimização extra. Nenhuma paginação necessária nesta escala.

## 8. Observabilidade — logs, métricas, erros

Sem chamada de rede. O middleware `persist` do Zustand falha *silenciosamente* por padrão em caso de erro de `localStorage` (mantém o estado em memória, mas não notifica ninguém) — isso não satisfaz RNF-04, que exige toast visível ao usuário. Correção: usar a opção `onRehydrateStorage`/o retorno de erro do `persist` (`options.onRehydrateStorage` expõe `(state, error) => void` no callback) e, adicionalmente, envolver as chamadas de ação da store que persistem (`createTask`, `updateTask`, `deleteTask`, `moveTask`) num wrapper que tenta escrever e, se o `storage.setItem` subjacente lançar, dispara `displayErrorToast` (mesmo utilitário do sub-projeto 1) mantendo o `set()` em memória já aplicado — ou seja, a UI não perde a edição do usuário, só avisa que ela não persistiu.

## 9. Estratégia de testes

- Unidade: `collectDescendantIds` (casos: sem filhos, 1 nível, 3 níveis, id inexistente, ciclo de `parentId` corrompido, auto-referência) — confirma que a versão com `Set` de visitados termina e não trava.
- Unidade: `useKanbanBoardStore` — criar/editar/mover/excluir (com cascata), isolamento entre `workspaceId`s diferentes.
- Integração: fluxo de criar tarefa L1 → L2 → L3 → mover entre colunas → excluir L1 com confirmação de cascata, usando `@testing-library/react` + simulação de drag-and-drop do `@dnd-kit` (a própria biblioteca documenta um padrão de teste via disparo de eventos de sensor).
- Manual: navegação por teclado entre colunas (RNF-02), 200 cards (RNF-01).

## 10. Rollout, feature flag e rollback

Sem feature flag — rota nova, aditiva. Rollback: remover a rota/entrada de navegação; chave de `localStorage` órfã não quebra nada.

## 11. Rastreabilidade RF/RNF → onde é atendido

| Requisito | Onde |
|---|---|
| RF-01 | nova rota `kanban-board.tsx` + entrada de navegação |
| RF-02 | `KanbanColumnId` fixo (`todo`/`in_progress`/`done`) |
| RF-03, RF-04 | `createTask` + `create-task-modal.tsx` (prop `parentId`/`level`) |
| RF-05 | `updateTask` |
| RF-06 | `deleteTask` + `collectDescendantIds` + `delete-task-confirm-dialog.tsx` |
| RF-07 | `moveTask` + `@dnd-kit` sensors |
| RF-08 | `getChildren` usado em `kanban-card.tsx` |
| RF-09 | `persist` por `workspaceId` em `tasksByWorkspaceId` |
| RF-10 | estado vazio em `kanban-column.tsx`/`kanban-board.tsx` |
| RNF-01 | §7 |
| RNF-02 | `KeyboardSensor` do `@dnd-kit` |
| RNF-03 | novas chaves i18n |
| RNF-04 | comportamento padrão do `persist` (§8) |

# SPEC — kanban-3-niveis

## 1. Resumo e escopo

Board de 3 níveis por workspace: CRUD de tarefas, drag-and-drop entre 3 colunas fixas, persistência local via Zustand+`persist`. Fora de escopo: contexto/arquivos por card (sub-projeto 3), pipeline featdevelop (sub-projeto 4).

## 2. Desenho detalhado por componente

### 2.1 `src/types/kanban.ts` (novo) — ver TECH §2.2, sem alteração.

### 2.2 `src/utils/kanban-tree.ts` (novo)

```ts
export function collectDescendantIds(tasks: KanbanTask[], taskId: string): Set<string> {
  const visited = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = tasks.filter((t) => t.parentId === current);
    for (const child of children) {
      if (visited.has(child.id) || child.id === taskId) continue; // guarda contra ciclo/auto-referência
      visited.add(child.id);
      queue.push(child.id);
    }
  }
  return visited; // NÃO inclui taskId em si — chamador decide se remove o próprio nó também
}
```

### 2.3 `src/stores/kanban-board-store.ts` (novo)

```ts
export const useKanbanBoardStore = create<KanbanBoardState & KanbanBoardActions>()(
  persist(
    (set, get) => ({
      tasksByWorkspaceId: {},

      createTask: (workspaceId, input) => {
        const tasks = get().tasksByWorkspaceId[workspaceId] ?? [];
        const parent = input.parentId
          ? tasks.find((t) => t.id === input.parentId)
          : null;
        if (input.parentId && !parent) return; // parent inexistente: no-op defensivo
        if (parent && parent.level === 3) return; // nível 3 não tem filhos
        const level = parent ? ((parent.level + 1) as 1 | 2 | 3) : 1;
        const siblings = tasks.filter((t) => t.parentId === (input.parentId ?? null) && t.columnId === "todo");
        const newTask: KanbanTask = {
          id: uuidv4(),
          parentId: input.parentId ?? null,
          level,
          title: input.title,
          description: input.description,
          columnId: "todo",
          order: siblings.length,
          createdAt: new Date().toISOString(),
        };
        trySet(set, workspaceId, [...tasks, newTask]);
      },

      updateTask: (workspaceId, taskId, patch) => {
        const tasks = get().tasksByWorkspaceId[workspaceId] ?? [];
        trySet(set, workspaceId, tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
      },

      deleteTask: (workspaceId, taskId) => {
        const tasks = get().tasksByWorkspaceId[workspaceId] ?? [];
        const toRemove = collectDescendantIds(tasks, taskId);
        toRemove.add(taskId);
        trySet(set, workspaceId, tasks.filter((t) => !toRemove.has(t.id)));
      },

      moveTask: (workspaceId, taskId, toColumnId, toOrder) => {
        const tasks = get().tasksByWorkspaceId[workspaceId] ?? [];
        // reindexa `order` dos irmãos na coluna de destino e na de origem
        trySet(set, workspaceId, reindexAfterMove(tasks, taskId, toColumnId, toOrder));
      },

      getChildren: (workspaceId, parentId) =>
        (get().tasksByWorkspaceId[workspaceId] ?? []).filter((t) => t.parentId === parentId),
    }),
    {
      name: "openhands-kanban-board",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tasksByWorkspaceId: state.tasksByWorkspaceId }),
    },
  ),
);
```

`trySet(set, workspaceId, nextTasks)` — helper interno (não exportado) que chama `set()` otimisticamente (estado em memória sempre atualiza) e, em seguida, tenta `localStorage.setItem` fora do ciclo do `persist` só para detectar quota estourada *antes* de confiar que persistiu; se lançar, chama `displayErrorToast(t(I18nKey.KANBAN$SAVE_ERROR))`. Implementação: como o middleware `persist` do Zustand já serializa em cada `set()`, `trySet` efetivamente faz `set(...)` e depois lê `localStorage.getItem("openhands-kanban-board")` para confirmar que o novo valor está lá; se não estiver (ou getItem lançar), dispara o toast. Isso evita reimplementar a serialização, só verifica o resultado.

`reindexAfterMove` — função pura auxiliar, recalcula `order` sequencial (0..n-1) para os irmãos de mesmo `parentId` na coluna de origem e na de destino após mover `taskId` para a posição `toOrder` da coluna `toColumnId`.

### 2.4 Componentes de UI

- `kanban-board.tsx` (rota): resolve `workspaceId` ativo (via `useSystemSettings().settings.defaultWorkspaceId` ou o workspace de sessão — o que estiver disponível primeiro), renderiza `<KanbanColumn>` × 3 para o nível 1, estado vazio (RF-10) se não houver tarefas de nível 1.
- `kanban-column.tsx`: `useDroppable({ id: columnId })` do `@dnd-kit/core`; lista `KanbanCard` ordenados por `order`.
- `kanban-card.tsx`: `useSortable({ id: task.id })`; mostra título, `X de Y` (RF-08) via `getChildren(...)`, clique abre `kanban-task-drawer.tsx` passando `parentId=task.id`.
- `kanban-task-drawer.tsx`: mesma estrutura de `kanban-board.tsx`, mas escopada a `getChildren(workspaceId, parentTaskId)` — reaproveita `KanbanColumn`/`KanbanCard` recursivamente (nível 2 dentro do drawer aberto do nível 1; nível 3 dentro do drawer aberto do nível 2; nível 3 não oferece "adicionar subtarefa").
- `create-task-modal.tsx`: campos título (obrigatório, `required`) e descrição; `onSubmit` chama `createTask`.
- `delete-task-confirm-dialog.tsx`: calcula `collectDescendantIds(tasks, taskId).size` antes de exibir, texto condicional ("Isso também vai remover N subtarefas." só aparece se `size > 0`).

### 2.5 Navegação

`src/routes.ts` — adicionar `route("board", "routes/kanban-board.tsx")` como irmã de `route("launch", "routes/launch.tsx")` dentro do bloco do `layout` raiz (`routes.ts:8-41`, antes de `route("customize", ...)`). Entrada de navegação nova em `src/components/features/sidebar/sidebar.tsx` (mesmo padrão dos itens de nav existentes ali — ícone sugerido: `LayoutGrid` de `lucide-react`, ainda não usado no arquivo).

## 3. Fluxo principal passo a passo e fluxos de erro

**Fluxo principal:** abrir `/board` → ver colunas do nível 1 → criar tarefa → abrir card → criar subtarefas (nível 2) → abrir subtarefa → criar sub-subtarefas (nível 3) → arrastar cards entre colunas em qualquer nível → fechar drawers → reload → tudo permanece.

**Fluxos de erro:**
- `createTask` com `parentId` de uma tarefa já excluída (race condition de UI, ex. dois cliques rápidos) → no-op defensivo (§2.3), nenhum card órfão criado.
- `localStorage` cheio durante `moveTask` → estado em memória reflete a nova coluna imediatamente (drag-and-drop não "volta" visualmente), mas toast de erro avisa que não persistiu — próximo reload perde esse último movimento (aceito, RNF-04 exige aviso, não exige garantia transacional).
- Exclusão de card com filhos sem confirmação → bloqueada pela própria UI (RF-06): o botão de excluir sempre abre o diálogo de confirmação, nunca exclui direto.

## 4. Casos de borda

- Coleção de descendentes com dado corrompido (ciclo de `parentId`): `collectDescendantIds` termina graças ao `Set` de visitados (TECH §2.3, F-TECH2-6 corrigido) — testado explicitamente.
- Dois workspaces diferentes nunca compartilham `order`/`id` — `tasksByWorkspaceId` já isola por chave.
- Criar tarefa de nível 1 sem nenhum workspace ativo (nem `defaultWorkspaceId` nem sessão) → botão de criar fica desabilitado com tooltip explicando que é preciso um workspace ativo (RF-01 pressupõe workspace ativo; sem ele, o board mostra o estado vazio de "nenhum workspace selecionado", distinto do estado vazio "nenhuma tarefa ainda").

## 5. Mudanças arquivo a arquivo

| Arquivo | Ação | O que muda |
|---|---|---|
| `src/types/kanban.ts` | criar | `KanbanTask`, `KanbanColumnId` |
| `src/utils/kanban-tree.ts` | criar | `collectDescendantIds`, `reindexAfterMove` |
| `src/utils/kanban-tree.test.ts` | criar | testes de unidade |
| `src/stores/kanban-board-store.ts` | criar | `useKanbanBoardStore` |
| `src/stores/kanban-board-store.test.ts` | criar | testes de unidade |
| `src/routes/kanban-board.tsx` | criar | tela do board |
| `src/routes/kanban-board.test.tsx` | criar | teste de integração |
| `src/components/features/kanban/kanban-column.tsx` | criar | coluna droppable |
| `src/components/features/kanban/kanban-card.tsx` | criar | card sortable |
| `src/components/features/kanban/kanban-task-drawer.tsx` | criar | navegação entre níveis |
| `src/components/features/kanban/create-task-modal.tsx` | criar | formulário de criação |
| `src/components/features/kanban/delete-task-confirm-dialog.tsx` | criar | confirmação com cascata |
| `src/routes.ts` | alterar | nova rota `board` |
| `src/components/features/sidebar/sidebar.tsx` | alterar | nova entrada de navegação |
| `package.json` | alterar | adicionar `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `src/i18n/declaration.ts`, `src/i18n/translation.json` | alterar | chaves novas (`KANBAN$*`) |

## 6. Critérios de aceitação

- **CA-01** (RF-01, RF-10): `/board` sem tarefas mostra estado vazio com CTA de criação.
- **CA-02** (RF-03): criar tarefa de nível 1 aparece na coluna "A Fazer".
- **CA-03** (RF-04): criar subtarefa dentro de um card de nível 1 gera `level: 2`, `parentId` correto; card de nível 3 não oferece a ação de criar filho.
- **CA-04** (RF-05): editar título/descrição reflete imediatamente e após reload.
- **CA-05** (RF-06): excluir card com 2 filhos e 1 neto exibe confirmação mencionando 3 descendentes; confirmar remove os 4 (o próprio + 3).
- **CA-06** (RF-07): mover card via simulação de drag-and-drop do `@dnd-kit` muda `columnId` e persiste após reload.
- **CA-07** (RF-08): card com 2 de 5 filhos concluídos mostra "2 de 5".
- **CA-08** (RF-09): dois `workspaceId` diferentes mantêm arrays de tarefas independentes.
- **CA-09** (RNF-04): `localStorage.setItem` mockado para lançar erro → toast exibido, estado em memória preservado (card continua na nova coluna visualmente).
- **CA-10**: `collectDescendantIds` com ciclo de `parentId` retorna em tempo finito e sem incluir o próprio `taskId` de partida no conjunto de "filhos" (mas o chamador `deleteTask` adiciona-o separadamente).
- **CA-11** (RNF-03): todas as chaves i18n novas (`KANBAN$*`) existem em `declaration.ts` e `translation.json`, verificável por `npm run make-i18n`.
- **CA-12** (RNF-02, manual): mover um card de coluna usando apenas teclado (foco + tecla de ativação do sensor de teclado do `@dnd-kit`) funciona sem mouse — checklist de PR, não automatizado.

## 7. Plano de testes

- Unidade: `kanban-tree.test.ts` (casos do TECH §9, incluindo ciclo/auto-referência), `kanban-board-store.test.ts` (CRUD, isolamento por workspace, CA-09).
- Integração: `kanban-board.test.tsx` cobrindo CA-01 a CA-08 com `@dnd-kit` testado via disparo de eventos de sensor (ou, se a simulação de drag real for frágil em jsdom, teste de integração cobre criação/edição/exclusão via clique e um teste unitário separado cobre `moveTask`/`reindexAfterMove` diretamente na store, sem depender do gesto de arrastar).
- Manual: 200 cards (RNF-01), navegação por teclado entre colunas (RNF-02).

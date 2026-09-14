# TECH — kanban-pipeline-featdevelop

## 1. Estado atual da arquitetura nos pontos tocados

- **Criação de conversa com mensagem inicial e diretório de trabalho**: `ConversationService.createConversation({ initialUserMsg, workingDirOverride, ... }): Promise<AppConversationStartTask>` (`src/api/conversation-service/agent-server-conversation-service.api.ts:425-469` para o ramo local, que resolve `settings`/`profiles` e monta o payload) é o mecanismo já existente para abrir uma conversa nova apontando a um workspace específico.
- **Leitura de arquivo tentada via hook ligado a conversa ativa**: `useWorkspaceFileContent(relativePath)` (`src/hooks/query/use-workspace-file-content.ts:142`) depende de `useActiveConversation()`/`useWorkspaceSession()` (linhas 5-10) — não serve para ler arquivos de um workspace **sem** conversa ativa, que é exatamente o caso de um card antes de "Rodar com agente" ser clicado.
- **Leitura via `execute_bash_command` sem conversa (já usada no sub-projeto `kanban-card-contexto-arquivos`)**: `AgentServerRuntimeService.executeCommand(null, null, command, workspacePath)` funciona para o backend local sem exigir conversa (mesma base do sub-projeto 3, `src/api/runtime-service/agent-server-runtime-service.ts:24-64`). Esta feature reaproveita esse padrão para leitura, em vez de introduzir uma segunda forma de tocar o sistema de arquivos.
- **Estrutura de saída da skill `featdevelop`**: `docs/features/<slug>/{PRD,TECH,SPEC}.md` e `docs/features/<slug>/sprints/SPRINT-NN.md` (`/root/.claude/skills/featdevelop/SKILL.md:12-23`) — convenção fixa, usada como está.
- **Coluna como string livre**: `KanbanColumnId` (sub-projeto `kanban-3-niveis`, `src/types/kanban.ts`) foi definida como union de strings especificamente para permitir um preset diferente sem migração (PRD daquele sub-projeto, seção 8) — esta feature exercita exatamente essa previsão.

## 2. Arquitetura proposta

### 2.1 Extensão do modelo

```ts
// src/types/kanban.ts — ampliar
export type KanbanColumnId =
  | "todo" | "in_progress" | "done" // preset genérico (sub-projeto 2)
  | "featdevelop_todo" | "featdevelop_prd" | "featdevelop_tech"
  | "featdevelop_spec" | "featdevelop_sprints" | "featdevelop_done"; // preset featdevelop

export interface KanbanTask {
  // ...campos existentes (sub-projetos 2 e 3)
  featureSlug?: string; // presença = card usa o preset "featdevelop"
  linkedConversationId?: string;
}
```

Criar um card com `featureSlug` definido inicializa `columnId: "featdevelop_todo"` em vez de `"todo"`; a UI escolhe qual conjunto de 6 (ou 3) colunas renderizar olhando `task.featureSlug` — sem exigir migração dos cards já existentes (que não têm `featureSlug`, então continuam no preset de 3 colunas).

### 2.2 `src/utils/kanban-slug.ts` (novo)

```ts
export function isValidFeatureSlug(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}
```

Mesma convenção kebab-case que a skill já usa (`SKILL.md:14`).

### 2.3 `src/api/kanban-pipeline.api.ts` (novo)

```ts
export function buildFeatdevelopInitialMessage(task: KanbanTask, contextText: string): string {
  return [
    `Use a skill /featdevelop para planejar a feature "${task.title}" com slug "${task.featureSlug}".`,
    task.description ? `Descrição: ${task.description}` : null,
    contextText ? `Contexto adicional do usuário:\n${contextText}` : null,
  ].filter(Boolean).join("\n\n");
}

export async function startFeatdevelopConversation(
  workspacePath: string,
  task: KanbanTask,
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  try {
    const contextText = htmlToPlainText(task.userContextHtml ?? ""); // reaproveita o mesmo helper de "html para texto" do sub-projeto 3 (buildMarkdown)
    const result = await ConversationService.createConversation({
      initialUserMsg: buildFeatdevelopInitialMessage(task, contextText),
      workingDirOverride: workspacePath,
    });
    // `AppConversationStartTask.app_conversation_id` é o id da conversa em
    // si (`id` é o id da *tarefa* de criação, não da conversa —
    // `src/api/conversation-service/agent-server-conversation-service.types.ts:103-111`).
    // No ramo local, `app_conversation_id` já vem preenchido igual a `id`
    // (`agent-server-conversation-service.api.ts:568`), mas usar o campo
    // certo evita quebrar quando o ramo Cloud divergir os dois valores.
    if (!result.app_conversation_id) {
      return { ok: false, error: "Conversa criada sem id retornado" };
    }
    return { ok: true, conversationId: result.app_conversation_id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Falha ao iniciar conversa" };
  }
}

export async function readFeatureDoc(
  workspacePath: string,
  relativePath: string,
): Promise<{ exists: true; content: string } | { exists: false }> {
  // `relativePath` é sempre montado internamente a partir de um slug já
  // validado por `isValidFeatureSlug` (feature-slug-input.tsx valida na
  // entrada; esta função valida de novo aqui, em profundidade, para nunca
  // depender só da UI ter feito a checagem antes de chamar):
  const slugMatch = relativePath.match(/^docs\/features\/([^/]+)\//);
  if (slugMatch && !isValidFeatureSlug(slugMatch[1])) return { exists: false };
  const result = await AgentServerRuntimeService.executeCommand(
    null, null, `cat -- ${escapeSingleQuoted(`${workspacePath}/${relativePath}`)}`, workspacePath,
  );
  // reaproveita escapeSingleQuoted de src/api/kanban-sintering.api.ts (sub-projeto 3) — mesmo
  // motivo: relativePath vem de um slug validado, mas workspacePath pode conter espaço.
  if (result.exit_code !== 0) return { exists: false };
  return { exists: true, content: result.stdout };
}

export async function listFeatureSprintFiles(
  workspacePath: string,
  slug: string,
): Promise<string[]> {
  if (!isValidFeatureSlug(slug)) return []; // defesa em profundidade, não confia só na validação de UI
  const result = await AgentServerRuntimeService.executeCommand(
    null, null,
    `ls -1 -- ${escapeSingleQuoted(`${workspacePath}/docs/features/${slug}/sprints`)} 2>/dev/null || true`,
    workspacePath,
  );
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}
```

`readFeatureDoc`/`listFeatureSprintFiles` nunca lançam por "arquivo/pasta não existe" — tratam `exit_code !== 0` do `cat`/`ls` como estado normal (RNF-01), não como erro; usam `--` antes do caminho para impedir que um caminho começando por `-` seja lido como flag do comando; e revalidam o slug internamente em vez de confiar apenas na validação já feita pela UI (`isValidFeatureSlug` chamada de novo em ambas, não só em `feature-slug-input.tsx`).

### 2.4 UI

- `src/components/features/kanban/feature-slug-input.tsx` (novo): campo de texto com validação `isValidFeatureSlug`, só visível/editável em cards de Nível 1.
- `src/components/features/kanban/run-agent-button.tsx` (novo): habilitado só com `featureSlug` e workspace resolvidos; chama `startFeatdevelopConversation`, salva `linkedConversationId` via `updateTask`, mostra link "Abrir conversa" (`NavigationLink` para `/conversations/:id`, mesmo padrão usado em `app-settings.tsx:249-254`).
- `src/components/features/kanban/feature-docs-panel.tsx` (novo): usa `readFeatureDoc`/`listFeatureSprintFiles` (via `useQuery`, refetch manual por botão "Atualizar" — sem polling automático, YAGNI) para renderizar PRD/TECH/SPEC como Markdown (reaproveitando `react-markdown`, já usado no chat, `src/components/features/markdown/*`) e a lista de sprints como links.
- `kanban-column.tsx`/`kanban-board.tsx` (sub-projeto 2, alterar): função `getColumnsForTask(task)` decide entre os dois presets de `KanbanColumnId` baseado em `task.featureSlug`.

## 3. Modelo de dados e migrações

Sem migração — `featureSlug`/`linkedConversationId` são opcionais; cards existentes (sem esses campos) continuam no preset genérico (RF-02, RNF-03).

## 4. Contratos: APIs, eventos, tipos públicos, assinaturas

Ver §2.3. `startFeatdevelopConversation` e `readFeatureDoc`/`listFeatureSprintFiles` são as três funções públicas desta feature; nenhuma lança.

## 5. Alternativas consideradas e por que foram rejeitadas

- **Detectar automaticamente a fase atual da skill (ex.: parseando mensagens da conversa) para mover o card sozinho**: rejeitada — exigiria parsear a saída da conversa de forma frágil (a skill não emite nenhum evento estruturado hoje); PRD trata isso como não-objetivo explícito.
- **Usar `useWorkspaceFileContent`/`useActiveConversation` para ler os documentos**: rejeitada — exige uma conversa ativa vinculada, que não existe até o usuário rodar o agente pela primeira vez; a leitura via `execute_bash_command` (mesma técnica do sub-projeto 3) funciona mesmo sem conversa.
- **Reaproveitar a mesma conversa em execuções repetidas (RF-06)**: rejeitada — a skill `featdevelop` é uma sessão de principio a fim; reabrir a mesma conversa para "recomeçar" misturaria contexto de duas rodadas de planejamento na mesma trajetória.

## 6. Segurança, permissões e privacidade

`readFeatureDoc`/`listFeatureSprintFiles` interpolam `workspacePath` (não controlado pelo usuário via este card — vem do workspace resolvido) e `slug`/`relativePath` (controlado pelo usuário, mas restrito por `isValidFeatureSlug` antes de qualquer leitura) através do mesmo `escapeSingleQuoted` do sub-projeto 3 — nenhuma string nova entra crua num comando de shell.

## 7. Performance e escala

Leitura sob demanda (botão "Atualizar", sem polling) — sem custo contínuo. Documentos de feature são tipicamente pequenos (KBs de Markdown).

## 8. Observabilidade — logs, métricas, erros

`startFeatdevelopConversation` retorna erro específico se `createConversation` rejeitar (ex.: sem backend disponível) — mesmo padrão de toast das features anteriores.

## 9. Estratégia de testes

- Unidade: `isValidFeatureSlug` (casos válidos/inválidos: maiúsculas, espaço, underscore, vazio).
- Unidade: `buildFeatdevelopInitialMessage` — presença/ausência de descrição e contexto.
- Unidade: `readFeatureDoc`/`listFeatureSprintFiles` com `executeCommand` mockado retornando `exit_code` 0 e ≠0 — confirma que ausência de arquivo nunca lança.
- Integração: card sem `featureSlug` continua com preset de 3 colunas (regressão explícita, RNF-03).
- Integração: card com `featureSlug` usa preset de 6 colunas; "Rodar com agente" cria conversa mockada e salva `linkedConversationId`.

## 10. Rollout, feature flag e rollback

Sem feature flag — campos opcionais, aditivos. Rollback: remover os componentes novos; cards com `featureSlug` órfão simplesmente não têm mais UI para ele (dado inofensivo em `localStorage`).

## 11. Rastreabilidade RF/RNF → onde é atendido

| Requisito | Onde |
|---|---|
| RF-01 | `feature-slug-input.tsx` + `isValidFeatureSlug` |
| RF-02 | `getColumnsForTask` em `kanban-board.tsx`/`kanban-column.tsx` |
| RF-03 | `run-agent-button.tsx` + `startFeatdevelopConversation` |
| RF-04 | `linkedConversationId` + link `/conversations/:id` |
| RF-05 | `feature-docs-panel.tsx` + `readFeatureDoc`/`listFeatureSprintFiles` |
| RF-06 | `startFeatdevelopConversation` sempre cria conversa nova |
| RNF-01 | tratamento de `exit_code !== 0` como estado normal |
| RNF-02 | chaves i18n novas |
| RNF-03 | `getColumnsForTask` preserva preset genérico quando `featureSlug` ausente |

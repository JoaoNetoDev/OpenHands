# SPEC — kanban-pipeline-featdevelop

## 1. Resumo e escopo

Vincula cards de Nível 1 a um slug de feature `docs/features/<slug>/`, troca o preset de colunas para refletir as fases da skill `featdevelop`, permite abrir uma conversa que roda a skill naquele workspace, e mostra os documentos gerados em painel de leitura.

## 2. Desenho detalhado por componente

### 2.1 `src/types/kanban.ts` (alterar) — ver TECH §2.1.

### 2.2 `src/utils/kanban-slug.ts` (novo) — `isValidFeatureSlug`, ver TECH §2.2.

### 2.3 `src/api/kanban-pipeline.api.ts` (novo) — ver TECH §2.3, com a correção de `app_conversation_id` e a revalidação de slug em profundidade.

### 2.4 `src/components/features/kanban/feature-slug-input.tsx` (novo)

```tsx
function FeatureSlugInput({ task }: { task: KanbanTask }) {
  if (task.level !== 1) return null; // só Nível 1 pode virar um "feature" do pipeline
  const [value, setValue] = React.useState(task.featureSlug ?? "");
  const isValid = value === "" || isValidFeatureSlug(value);
  const handleBlur = () => {
    if (isValid) updateTask(workspaceId, task.id, { featureSlug: value || undefined });
  };
  return (
    <SettingsInput
      testId="feature-slug-input"
      label={t(I18nKey.KANBAN$FEATURE_SLUG_LABEL)}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      isInvalid={!isValid}
      errorMessage={!isValid ? t(I18nKey.KANBAN$FEATURE_SLUG_INVALID) : undefined}
    />
  );
}
```

Definir `featureSlug` também reseta `columnId` do card para `"featdevelop_todo"` se ele ainda estiver em `"todo"` (não força se o card já tiver sido movido manualmente para outra coluna do preset genérico — nesse caso o usuário decide manualmente a coluna equivalente, evitando surpresa).

### 2.5 `src/components/features/kanban/run-agent-button.tsx` (novo)

```tsx
function RunAgentButton({ workspacePath, task }: Props) {
  const isDisabled = !task.featureSlug || !workspacePath;
  const [isPending, setIsPending] = React.useState(false);

  const handleClick = async () => {
    setIsPending(true);
    const result = await startFeatdevelopConversation(workspacePath!, task);
    setIsPending(false);
    if (result.ok) {
      updateTask(workspaceId, task.id, { linkedConversationId: result.conversationId });
    } else {
      displayErrorToast(result.error);
    }
  };

  return (
    <>
      <Button isDisabled={isDisabled || isPending} onPress={handleClick}>
        {t(I18nKey.KANBAN$RUN_AGENT)}
      </Button>
      {task.linkedConversationId && (
        <NavigationLink to={`/conversations/${task.linkedConversationId}`}>
          {t(I18nKey.KANBAN$OPEN_CONVERSATION)}
        </NavigationLink>
      )}
    </>
  );
}
```

### 2.6 `src/components/features/kanban/feature-docs-panel.tsx` (novo)

```tsx
function FeatureDocsPanel({ workspacePath, slug }: { workspacePath: string; slug: string }) {
  const [docs, setDocs] = React.useState<Record<string, { exists: boolean; content?: string }>>({});
  const [sprintFiles, setSprintFiles] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const refresh = async () => {
    setIsLoading(true);
    const entries = await Promise.all(
      ["PRD.md", "TECH.md", "SPEC.md"].map(async (name) => {
        const result = await readFeatureDoc(workspacePath, `docs/features/${slug}/${name}`);
        return [name, result.exists ? { exists: true, content: result.content } : { exists: false }] as const;
      }),
    );
    setDocs(Object.fromEntries(entries));
    setSprintFiles(await listFeatureSprintFiles(workspacePath, slug));
    setIsLoading(false);
  };

  React.useEffect(() => { void refresh(); }, [workspacePath, slug]);

  return (
    <div>
      <Button onPress={refresh} isDisabled={isLoading}>{t(I18nKey.KANBAN$REFRESH_DOCS)}</Button>
      {["PRD.md", "TECH.md", "SPEC.md"].map((name) => (
        <details key={name}>
          <summary>{name} {docs[name]?.exists ? "" : `(${t(I18nKey.KANBAN$DOC_NOT_GENERATED_YET)})`}</summary>
          {docs[name]?.exists && <ReactMarkdown>{docs[name]!.content!}</ReactMarkdown>}
        </details>
      ))}
      <ul>{sprintFiles.map((f) => <li key={f}>{f}</li>)}</ul>
    </div>
  );
}
```

Sem polling automático — `refresh()` roda no mount e no clique de "Atualizar" (YAGNI, PRD não pede tempo real).

### 2.7 Colunas por preset

`src/components/features/kanban/kanban-column-presets.ts` (novo):

```ts
export function getColumnsForTask(task: KanbanTask): { id: KanbanColumnId; label: string }[] {
  if (task.featureSlug) {
    return [
      { id: "featdevelop_todo", label: t(I18nKey.KANBAN$COLUMN_TODO) },
      { id: "featdevelop_prd", label: "PRD" },
      { id: "featdevelop_tech", label: "TECH" },
      { id: "featdevelop_spec", label: "SPEC" },
      { id: "featdevelop_sprints", label: "SPRINTS" },
      { id: "featdevelop_done", label: t(I18nKey.KANBAN$COLUMN_DONE) },
    ];
  }
  return [
    { id: "todo", label: t(I18nKey.KANBAN$COLUMN_TODO) },
    { id: "in_progress", label: t(I18nKey.KANBAN$COLUMN_IN_PROGRESS) },
    { id: "done", label: t(I18nKey.KANBAN$COLUMN_DONE) },
  ];
}
```

`kanban-board.tsx` (sub-projeto 2, alterar): em vez de sempre renderizar as 3 colunas fixas, itera `getColumnsForTask(...)` — como todos os cards de Nível 1 de um mesmo board podem ter presets diferentes (alguns com slug, outros sem), o board passa a agrupar/renderizar por preset em vez de assumir um único conjunto global de colunas (mudança estrutural pequena: a coluna deixa de ser "do board" e passa a ser "do card mais o seu preset", coerente porque `moveTask` já recebia `columnId` por tarefa individual desde o sub-projeto 2, nunca um estado global de colunas).

## 3. Fluxo principal passo a passo e fluxos de erro

**Fluxo principal:** card de Nível 1 → definir slug → coluna muda para o preset featdevelop → "Rodar com agente" → conversa abre → usuário acompanha a skill na conversa → conforme o `featdevelop` aprova cada fase, usuário arrasta o card manualmente → painel de documentos mostra PRD/TECH/SPEC/sprints conforme vão sendo escritos.

**Fluxos de erro:**
- Slug inválido (maiúscula, espaço, `_`) → campo marca erro, não salva (RF-01).
- `createConversation` falha (sem backend, erro de rede) → toast de erro, `linkedConversationId` não é definido, botão continua disponível para nova tentativa.
- Documento ainda não gerado → painel mostra "(ainda não gerado)", nunca um erro (RNF-01).
- Slug definido mas workspace não resolvido → botão "Rodar com agente" desabilitado (mesma lógica de "sem workspace" dos sub-projetos anteriores).

## 4. Casos de borda

- Card de Nível 2/3 nunca mostra `FeatureSlugInput`/preset featdevelop — a feature é exclusiva de Nível 1 (RF-01 implícito: "pipeline" é por definição da tarefa grande, não de sub-tarefas).
- Remover o `featureSlug` de um card já vinculado (limpar o campo) não apaga os documentos já gerados no workspace nem desvincula a conversa — só volta a UI para o preset genérico de 3 colunas; `columnId` atual (um dos 6 valores `featdevelop_*`) fica "órfão" até o usuário mover o card manualmente para `todo`/`in_progress`/`done` (aceito, é um estado transitório raro e não perde dados).
- `readFeatureDoc` chamado com um slug que passou pela validação de UI mas foi manipulado depois (ex.: dado editado direto em devtools) → revalidado internamente (§TECH 2.3, correção pós-review), retorna `exists: false` em vez de tentar ler.

## 5. Mudanças arquivo a arquivo

| Arquivo | Ação | O que muda |
|---|---|---|
| `src/types/kanban.ts` | alterar | `KanbanColumnId` ganha 6 novos valores; `KanbanTask` ganha `featureSlug`, `linkedConversationId` |
| `src/utils/kanban-slug.ts` | criar | `isValidFeatureSlug` |
| `src/utils/kanban-slug.test.ts` | criar | testes de validação |
| `src/api/kanban-pipeline.api.ts` | criar | `startFeatdevelopConversation`, `readFeatureDoc`, `listFeatureSprintFiles`, `buildFeatdevelopInitialMessage` |
| `src/api/kanban-pipeline.api.test.ts` | criar | testes de unidade |
| `src/components/features/kanban/feature-slug-input.tsx` | criar | campo de slug |
| `src/components/features/kanban/run-agent-button.tsx` | criar | ação de rodar agente |
| `src/components/features/kanban/feature-docs-panel.tsx` | criar | painel de documentos |
| `src/components/features/kanban/kanban-column-presets.ts` | criar | `getColumnsForTask` |
| `src/components/features/kanban/kanban-task-drawer.tsx` | alterar | inclui os três componentes novos quando `task.level === 1` |
| `src/routes/kanban-board.tsx` / `kanban-column.tsx` | alterar | usa `getColumnsForTask` em vez de conjunto fixo |
| `src/i18n/declaration.ts`, `src/i18n/translation.json` | alterar | chaves `KANBAN$FEATURE_SLUG_*`, `KANBAN$RUN_AGENT`, `KANBAN$OPEN_CONVERSATION`, `KANBAN$*_DOCS*`, `KANBAN$COLUMN_*` |

## 6. Critérios de aceitação

- **CA-01** (RF-01): slug inválido não salva; slug válido salva e persiste após reload.
- **CA-02** (RF-02, RNF-03): card com slug usa as 6 colunas featdevelop; card sem slug usa as 3 colunas genéricas (regressão explícita contra o sub-projeto 2).
- **CA-03** (RF-03, RF-06): clicar "Rodar com agente" duas vezes cria duas conversas diferentes (`createConversation` mockado chamado 2x, dois ids distintos salvos em sequência).
- **CA-04** (RF-04): após sucesso, link "Abrir conversa" aponta para `/conversations/<id correto — app_conversation_id>`.
- **CA-05** (RF-05, RNF-01): `readFeatureDoc` mockado retornando "não existe" para todos os três arquivos → painel mostra "(ainda não gerado)" para os três, sem erro.
- **CA-06** (RF-05): `readFeatureDoc` mockado retornando conteúdo para `PRD.md` → painel renderiza esse conteúdo como Markdown.
- **CA-07** (segurança, defesa em profundidade): `readFeatureDoc`/`listFeatureSprintFiles` chamados diretamente (bypassando a UI) com um slug inválido retornam "não existe"/lista vazia, nunca tentam executar o comando.

## 7. Plano de testes

- Unidade: `kanban-slug.test.ts` (CA-01 parte de validação), `kanban-pipeline.api.test.ts` (CA-03 a CA-07, incluindo o caso do campo `app_conversation_id` correto).
- Integração: `kanban-column-presets.test.ts` (CA-02).
- Integração: drawer completo do card de Nível 1 com os três componentes novos.

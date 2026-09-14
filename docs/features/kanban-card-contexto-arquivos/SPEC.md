# SPEC — kanban-card-contexto-arquivos

## 1. Resumo e escopo

Estende `KanbanTask` com contexto de usuário/agente (rich-text) e anexos; adiciona a ação "Sinterizar" que grava um `.md` + anexos no workspace via `execute_bash_command` local, com escrita segura contra injeção de comando. Só funciona com backend local.

## 2. Desenho detalhado por componente

### 2.1 `src/types/kanban.ts` (alterar) — ver TECH §2.1.

### 2.2 `src/api/kanban-sintering.api.ts` (novo)

```ts
export function escapeSingleQuoted(value: string): string { /* TECH §2.2 */ }

export function buildWriteFileCommand(absolutePath: string, contentBase64: string): string { /* TECH §2.2, corrigido: dirname entre aspas duplas */ }

async function toBase64(bytes: ArrayBuffer): Promise<string> {
  // TextEncoder/Uint8Array -> base64, sem depender de window.btoa direto
  // (que quebra em conteúdo não-Latin1); usa a mesma técnica de chunks de
  // Uint8Array -> String.fromCharCode -> btoa já necessária para suportar
  // contexto em qualquer idioma.
}

function buildMarkdown(task: KanbanTask): string {
  // título, nível, coluna, descrição, contexto do usuário (texto extraído
  // do HTML sanitizado — não reinjeta as tags HTML no .md, converte para
  // Markdown simples via um helper de "html para texto com listas/negrito"
  // já suficiente dado que a allowlist de tags é pequena, TECH sub-projeto 1 §3),
  // contexto do agente (idem), lista de anexos com caminho relativo.
}

export async function sinterizeTask(
  workspacePath: string,
  task: KanbanTask,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const mdPath = `${workspacePath}/.openhands/kanban/${task.id}.md`;
    const mdBase64 = await toBase64(new TextEncoder().encode(buildMarkdown(task)).buffer);
    const mdResult = await AgentServerRuntimeService.executeCommand(
      null, null, buildWriteFileCommand(mdPath, mdBase64), workspacePath,
    );
    if (mdResult.exit_code !== 0) {
      return { ok: false, error: mdResult.stderr || "Falha ao gravar o arquivo .md" };
    }
    for (const attachment of task.attachments ?? []) {
      const attPath = `${workspacePath}/.openhands/kanban/${task.id}/attachments/${attachment.fileName}`;
      const attResult = await AgentServerRuntimeService.executeCommand(
        null, null, buildWriteFileCommand(attPath, attachment.contentBase64), workspacePath,
      );
      if (attResult.exit_code !== 0) {
        return { ok: false, error: `Falha ao gravar o anexo "${attachment.fileName}": ${attResult.stderr}` };
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erro desconhecido ao sinterizar" };
  }
}
```

### 2.3 `src/components/features/kanban/card-context-panel.tsx` (novo)

Dois `RichTextInput` (reaproveitado sem alteração de `src/components/features/settings/system-settings/rich-text-input.tsx`), `onChange` chamando `updateTask(workspaceId, task.id, { userContextHtml })`/`{ agentContextHtml }`.

### 2.4 `src/components/features/kanban/card-attachments.tsx` (novo)

```tsx
const MAX_ATTACHMENT_BYTES = 256 * 1024;
const CONTROL_CHAR_RE = /[\x00-\x1f]/;

function handleFileSelect(files: FileList) {
  for (const file of Array.from(files)) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      displayErrorToast(t(I18nKey.KANBAN$ATTACHMENT_TOO_LARGE, { name: file.name }));
      continue;
    }
    const safeName = getSafeUploadFileName(file.name); // reaproveitado de src/api/workspace-upload-path.ts:15-24
    if (CONTROL_CHAR_RE.test(safeName)) {
      displayErrorToast(t(I18nKey.KANBAN$ATTACHMENT_INVALID_NAME, { name: file.name }));
      continue;
    }
    // lê o arquivo, converte para base64 (toBase64 de kanban-sintering.api.ts),
    // chama updateTask adicionando ao array attachments do card.
  }
}
```

### 2.5 `src/components/features/kanban/sinterize-button.tsx` (novo)

```tsx
function SinterizeButton({ workspacePath, task }: Props) {
  const isCloud = getActiveBackend().backend.kind === "cloud";
  const isDisabled = isCloud || !workspacePath;
  const [isPending, setIsPending] = React.useState(false);

  const handleClick = async () => {
    setIsPending(true);
    const result = await sinterizeTask(workspacePath!, task);
    setIsPending(false);
    if (result.ok) {
      updateTask(workspaceId, task.id, { lastSinteredAt: new Date().toISOString() });
      displaySuccessToast(t(I18nKey.KANBAN$SINTERED));
    } else {
      displayErrorToast(result.error);
    }
  };

  return (
    <Tooltip content={isCloud ? t(I18nKey.KANBAN$SINTERIZE_CLOUD_UNAVAILABLE) : undefined}>
      <Button isDisabled={isDisabled || isPending} onPress={handleClick}>
        {task.lastSinteredAt ? t(I18nKey.KANBAN$RESINTERIZE) : t(I18nKey.KANBAN$SINTERIZE)}
      </Button>
    </Tooltip>
  );
}
```

Indicador de sucesso (RF-08): `task.lastSinteredAt` renderizado como timestamp relativo (reaproveitar utilitário de data já usado em outros cards de conversa, se existir; senão `Intl.RelativeTimeFormat` direto).

## 3. Fluxo principal passo a passo e fluxos de erro

**Fluxo principal:** abrir card → digitar contexto do usuário/agente (RF-01) → anexar arquivo(s) (RF-02) → clicar "Sinterizar" → sucesso → `.md` e anexos aparecem no workspace, indicador de sucesso no card.

**Fluxos de erro:**
- Backend Cloud ativo → botão desabilitado com tooltip explicando o motivo (RF-03/RNF-04), sem sequer tentar a chamada.
- Anexo maior que 256 KB → recusado antes de entrar no array `attachments`, toast explicando o teto.
- Falha na escrita do `.md` (permissão, disco cheio, path inválido) → `sinterizeTask` retorna erro antes de tentar qualquer anexo (RF-07); card **não** ganha `lastSinteredAt`.
- Falha num anexo no meio da lista → erro específico menciona qual anexo falhou; anexos anteriores àquele já foram gravados no disco (efeito colateral aceito — reexecutar a sinterização sobrescreve tudo de novo, RF-06, então não há inconsistência permanente).

## 4. Casos de borda

- Caminho de workspace com espaço (`/home/john doe/repo`) → coberto pela correção do `dirname` entre aspas duplas (TECH §2.2) — teste de regressão dedicado.
- Título de tarefa contendo aspas simples/backticks/`$(...)` → nunca entra na string de comando (só `task.id`, um UUID, entra no caminho; o título só entra no **conteúdo** do `.md`, que é base64) — teste adversarial dedicado.
- Reexecutar sinterização do mesmo card → sobrescreve `.md` e todos os anexos (RF-06); anexo removido do card entre uma sinterização e outra continua existindo no disco da sinterização anterior (não há "limpeza" de anexos órfãos nesta versão — não é requisito do PRD, mas documentado aqui para não ser lido como bug).
- `contentBase64` corrompido por algum bug futuro fora do alfabeto esperado → `buildWriteFileCommand` lança antes de montar o comando (defesa em profundidade, TECH §2.2).

## 5. Mudanças arquivo a arquivo

| Arquivo | Ação | O que muda |
|---|---|---|
| `src/types/kanban.ts` | alterar | `KanbanTaskAttachment`, campos novos em `KanbanTask` |
| `src/api/kanban-sintering.api.ts` | criar | `escapeSingleQuoted`, `buildWriteFileCommand`, `toBase64`, `buildMarkdown`, `sinterizeTask` |
| `src/api/kanban-sintering.api.test.ts` | criar | testes adversariais (TECH §9) |
| `src/components/features/kanban/card-context-panel.tsx` | criar | dois campos rich-text |
| `src/components/features/kanban/card-attachments.tsx` | criar | seleção/validação de anexos |
| `src/components/features/kanban/card-attachments.test.tsx` | criar | testes de validação de tamanho/nome |
| `src/components/features/kanban/sinterize-button.tsx` | criar | ação de sinterizar |
| `src/components/features/kanban/sinterize-button.test.tsx` | criar | testes de habilitação/erro/sucesso |
| `src/components/features/kanban/kanban-task-drawer.tsx` | alterar | inclui `card-context-panel`, `card-attachments`, `sinterize-button` |
| `src/i18n/declaration.ts`, `src/i18n/translation.json` | alterar | chaves `KANBAN$SINTERIZE*`, `KANBAN$ATTACHMENT_*` |

## 6. Critérios de aceitação

- **CA-01** (RF-01): editar contexto do usuário/agente persiste no card (via `useKanbanBoardStore` já existente) e sobrevive a reload.
- **CA-02** (RF-02, RNF-02): anexar arquivo de 300 KB é recusado; anexar arquivo de 100 KB é aceito.
- **CA-03** (RF-03, RNF-04): com backend Cloud mockado, botão "Sinterizar" desabilitado com tooltip; com backend local, habilitado.
- **CA-04** (RF-04, RF-05): sinterizar um card com contexto e 1 anexo grava `.md` e 1 anexo no caminho esperado (verificado por `executeCommand` mockado capturando os comandos chamados).
- **CA-05** (RF-06): sinterizar duas vezes o mesmo card gera exatamente 1 `.md` (comando de escrita é sempre o mesmo caminho, sobrescreve).
- **CA-06** (RF-07): `executeCommand` mockado retornando `exit_code: 1` → `sinterizeTask` retorna `ok: false`, card não ganha `lastSinteredAt`.
- **CA-07** (RF-08): após sucesso, `task.lastSinteredAt` definido e renderizado no card.
- **CA-08** (RNF-01): payloads adversariais (`$(whoami)`, backtick, `; rm -rf /`, aspas simples aninhadas) no título/descrição/contexto nunca aparecem fora do conteúdo base64 do `.md` — teste roda o comando de fato num diretório temporário e confirma que nenhum efeito colateral além da escrita esperada ocorre.
- **CA-09**: caminho de workspace com espaço grava no diretório correto (regressão do bug do `dirname`).

## 7. Plano de testes

- Unidade: `kanban-sintering.api.test.ts` — todos os casos do TECH §9 + CA-08/CA-09 (execução real do comando gerado num diretório temporário, não só inspeção de string).
- Unidade: `card-attachments.test.tsx` — CA-02.
- Integração: `sinterize-button.test.tsx` — CA-03, CA-06, CA-07.
- Integração: fluxo completo de drawer com os três componentes novos — CA-01, CA-04, CA-05.

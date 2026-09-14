# TECH — kanban-card-contexto-arquivos

## 1. Estado atual da arquitetura nos pontos tocados

- **Execução de comando local sem conversa**: `AgentServerRuntimeService.executeCommand(conversationUrl, sessionApiKey, command, cwd, timeout = 30)` (`src/api/runtime-service/agent-server-runtime-service.ts:24-30` assinatura, timeout default na linha 30) aceita `conversationUrl`/`sessionApiKey` nulos; nesse caso cai em `new RemoteWorkspace(getAgentServerClientOptions({ conversationUrl, sessionApiKey })).executeCommand(...)` (linhas 58-64), que resolve o agent-server **local** via `getEffectiveLocalBackend()` (`src/api/agent-server-client-options.ts:52-58`) — sem exigir conversa. Este é o mesmo caminho que `use-workspace-files.ts` já usa para listar arquivos (`src/hooks/query/use-workspace-files.ts:57,60`, comentário "Local only").
- **Backend Cloud não tem esse atalho**: o ramo Cloud de `executeCommand` (linhas 34-53) exige `conversationUrl` de uma conversa já provisionada, resolvida via `callCloudProxy`. Um card do board não tem conversa associada — por isso RF-03 desabilita a ação em Cloud.
- **Sanitização de nome de arquivo já existe**: `getSafeUploadFileName` (`src/api/workspace-upload-path.ts:15-24`) remove diretórios do nome e rejeita `.`/`..` — reaproveitado aqui para nomear anexos, mas não rejeita caracteres de controle (ex.: NUL) no nome; esta feature adiciona uma checagem extra (`/^[^\x00-\x1f]+$/`) antes de aceitar o nome, para não depender só do comportamento de truncamento do sistema de arquivos.
- **Rich text mínimo já existe**: `RichTextInput` do sub-projeto `sistema-settings-menu` (`src/components/features/settings/system-settings/rich-text-input.tsx`) é reaproveitado como está, sem alteração, para os dois campos de contexto (RF-01).
- **Modelo de dados do card**: `KanbanTask` (`src/types/kanban.ts`, sub-projeto `kanban-3-niveis`) hoje só tem `title`/`description`.

## 2. Arquitetura proposta

### 2.1 Extensão do modelo de dados

```ts
// src/types/kanban.ts — adicionar campos opcionais a KanbanTask
export interface KanbanTaskAttachment {
  id: string;
  fileName: string; // já sanitizado com getSafeUploadFileName
  sizeBytes: number;
  contentBase64: string; // conteúdo bruto do arquivo, guardado até a sinterização
}

export interface KanbanTask {
  // ...campos existentes (id, parentId, level, title, description, columnId, order, createdAt)
  userContextHtml?: string;
  agentContextHtml?: string;
  attachments?: KanbanTaskAttachment[];
  lastSinteredAt?: string; // ISO — presença = RF-08 (indicador visual)
}
```

Guardar `contentBase64` no mesmo registro do card (persistido pelo `useKanbanBoardStore` do sub-projeto 2, sem mudar a store) é aceitável dado o teto de tamanho de RNF-02 (ver §3) — evita inventar um segundo mecanismo de armazenamento só para anexos pendentes.

### 2.2 Escrita segura no workspace (núcleo de segurança da feature)

`src/api/kanban-sintering.api.ts` (novo):

```ts
function escapeSingleQuoted(value: string): string {
  // Shell-safe: fecha a aspa simples, insere uma aspa literal escapada, reabre.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildWriteFileCommand(absolutePath: string, contentBase64: string): string {
  if (!/^[A-Za-z0-9+/=]*$/.test(contentBase64)) {
    // Nunca deveria acontecer (só chamado com saída de um encoder base64
    // próprio), mas é a última linha de defesa antes de montar o comando:
    // se o alfabeto não bate, aborta em vez de interpolar algo desconhecido.
    throw new Error("contentBase64 contém caracteres fora do alfabeto base64");
  }
  const escapedPath = escapeSingleQuoted(absolutePath);
  // `$(dirname ...)` é interpolado SEM aspas ao redor de todo o `mkdir -p`
  // — isso desfaz o escape de `escapedPath` para esse passo, porque a saída
  // da substituição de comando ainda passa por word-splitting/glob do shell
  // (ex.: um caminho com espaço vira dois argumentos de `mkdir`). A correção
  // é envolver a substituição inteira em aspas duplas: `"$(dirname ...)"`.
  return `mkdir -p "$(dirname ${escapedPath})" && printf '%s' '${contentBase64}' | base64 -d > ${escapedPath}`;
}
```

**Por que base64 e não heredoc/aspas diretas**: qualquer conteúdo de usuário (título, descrição, contexto HTML) pode conter aspas simples, backticks, `$(...)`, `;` — interpolar isso cru numa string de comando é injeção de comando garantida (RNF-01). Codificando o **conteúdo** do arquivo inteiro em base64 antes de montar o comando, o único texto que entra na string de shell é o alfabeto base64 (validado por regex antes de montar o comando, não só confiado por contrato de tipo) mais o **caminho do arquivo**, que é escapado com aspas simples (`escapeSingleQuoted`) seguindo a técnica padrão POSIX (fechar aspa, inserir `\'`, reabrir aspa) — e cuja substituição via `dirname` fica adicionalmente entre aspas duplas para não reabrir word-splitting/glob no resultado.

`sinterizeTask(workspacePath, task)`:
1. Monta o corpo do `.md` (template determinístico — título, nível, coluna, descrição, contexto do usuário, contexto do agente, lista de anexos com caminho relativo) como uma string JS comum (sem tocar shell ainda).
2. `btoa`/`Buffer`-equivalente no browser (`window.btoa` não lida bem com UTF-8 diretamente — usar `TextEncoder` + conversão manual para base64, padrão já necessário para qualquer conteúdo não-ASCII nos campos de contexto).
3. Chama `AgentServerRuntimeService.executeCommand(null, null, buildWriteFileCommand(mdPath, mdContentBase64), workspacePath)` para o `.md`.
4. Para cada anexo, chama o mesmo comando com `contentBase64` já armazenado (RF-05) e caminho `<workspace>/.openhands/kanban/<taskId>/attachments/<fileName>`.
5. Verifica `exit_code === 0` em cada chamada; na primeira falha, aborta e propaga erro (RF-07) sem marcar `lastSinteredAt`.
6. Sucesso em todas as chamadas → `updateTask(workspaceId, task.id, { lastSinteredAt: new Date().toISOString() })` (ação já existente na store do sub-projeto 2, estendida para aceitar este campo).

### 2.3 UI

- `src/components/features/kanban/card-context-panel.tsx` (novo): dois `RichTextInput` (contexto usuário/agente) dentro do `kanban-task-drawer.tsx` existente, dado um `task`.
- `src/components/features/kanban/card-attachments.tsx` (novo): `<input type="file" multiple>`, valida tamanho (RNF-02) antes de ler, usa `FileReader.readAsArrayBuffer` + conversão para base64, chama `updateTask` para anexar ao array `attachments`.
- `src/components/features/kanban/sinterize-button.tsx` (novo): desabilitado com tooltip explicativo (RF-04/RNF-04) quando `getActiveBackend().backend.kind === "cloud"` ou quando não há workspace resolvido; chama `sinterizeTask`; mostra spinner durante a chamada e toast de erro em falha (RF-07); mostra o indicador de sucesso (RF-08) lendo `task.lastSinteredAt`.

## 3. Modelo de dados e migrações

Sem migração de backend. `KanbanTaskAttachment.sizeBytes` limitado a **256 KB** por anexo (RNF-02) — suficiente para prints/logs de texto, pequeno o bastante para não estourar o timeout padrão de `executeCommand` (30s, `agent-server-runtime-service.ts:29`) mesmo com a expansão de ~33% do base64. Validação client-side antes de adicionar ao array `attachments` (recusa com mensagem, não trunca silenciosamente).

## 4. Contratos: APIs, eventos, tipos públicos, assinaturas

```ts
// src/api/kanban-sintering.api.ts
export async function sinterizeTask(
  workspacePath: string,
  task: KanbanTask,
): Promise<{ ok: true } | { ok: false; error: string }>;
```

Não lança — a função inteira roda dentro de um `try/catch` que captura tanto falhas esperadas (código de saída ≠ 0) quanto exceções de infraestrutura (`getAgentServerClientOptions` lançando `NoBackendAvailableError`, `callCloudProxy` rejeitando, `buildWriteFileCommand` rejeitando base64 fora do alfabeto) e as converte todas em `{ ok: false, error }` — o chamador (`sinterize-button.tsx`) nunca precisa de `try/catch` próprio.

## 5. Alternativas consideradas e por que foram rejeitadas

- **Interpolar o conteúdo direto num heredoc (`cat <<'EOF' > path`)**: rejeitada — o delimitador `EOF` pode colidir com conteúdo do usuário que contenha a palavra `EOF` numa linha isolada, e ainda exige escapar o caminho; base64 evita ambos os problemas com uma técnica mais simples de auditar.
- **Endpoint de upload existente (`uploadFilesToConversation`)**: rejeitada para esta feature — exige uma conversa provisionada (`conversationUrl`/`sessionApiKey`), que um card do board não tem; obrigaria criar uma conversa só para escrever um arquivo, custo desproporcional.
- **Guardar anexos permanentemente em `localStorage` (sem sinterizar)**: rejeitada — contradiz o objetivo do PRD de que o conteúdo sobreviva fora do navegador; `localStorage` também tem teto de alguns MB por origem, insuficiente para múltiplos anexos por card.

## 6. Segurança, permissões e privacidade

Ver §2.2 — injeção de comando é o risco central desta feature e é mitigado estruturalmente (base64 + escape de aspas simples), não por validação de allowlist de caracteres (mais frágil, mais fácil de esquecer um caso). `escapeSingleQuoted` e `buildWriteFileCommand` são funções puras, 100% testáveis com payloads adversariais (aspas, backticks, `$(...)`, `;`, `\n`, nomes de arquivo com espaço).

## 7. Performance e escala

Cada sinterização é sequencial (`.md` + N anexos, um `executeCommand` por vez) — aceitável porque cards não têm dezenas de anexos (RNF-02 já limita o caso de uso a anotações pequenas). Sem necessidade de paralelizar dado o timeout generoso (30s) por chamada.

## 8. Observabilidade — logs, métricas, erros

`sinterizeTask` retorna `{ ok: false, error }` com a mensagem do `stderr`/`exit_code` da chamada que falhou — suficiente para o toast de erro (RF-07) ser específico (ex.: "sem permissão de escrita" vs. "workspace não encontrado") sem inventar categorização adicional.

## 9. Estratégia de testes

- Unidade: `escapeSingleQuoted`/`buildWriteFileCommand` com payloads adversariais (aspas simples, backticks, `$(whoami)`, `; rm -rf /`, newline, caminho com espaço) — confirma que o comando resultante, executado de fato num sandbox de teste (`child_process.execSync` num diretório temporário do runner de teste, não só inspeção de string), nunca cria/apaga nada fora do caminho alvo, e que um caminho com espaço gera exatamente um diretório (regressão direta do bug do `dirname` sem aspas duplas).
- Unidade: `buildWriteFileCommand` lança se `contentBase64` tiver caractere fora do alfabeto base64.
- Unidade: sanitização de nome de anexo rejeita caracteres de controle além do que `getSafeUploadFileName` já cobre.
- Unidade: `sinterizeTask` com `AgentServerRuntimeService.executeCommand` mockado — sucesso, falha na escrita do `.md` (aborta antes dos anexos), falha num anexo do meio da lista.
- Integração: `card-attachments.tsx` recusa arquivo acima de 256 KB com mensagem clara, sem chamar `updateTask`.
- Integração: `sinterize-button.tsx` desabilitado com Cloud ativo (mock de `getActiveBackend`), habilitado com backend local.

## 10. Rollout, feature flag e rollback

Sem feature flag — campos novos em `KanbanTask` são opcionais (`?`), cards existentes do sub-projeto 2 continuam válidos sem migração. Rollback: remover os componentes novos e os campos opcionais deixam de ser lidos (dado órfão em `localStorage`, inofensivo).

## 11. Rastreabilidade RF/RNF → onde é atendido

| Requisito | Onde |
|---|---|
| RF-01 | `card-context-panel.tsx` + `RichTextInput` reaproveitado |
| RF-02 | `card-attachments.tsx` + `KanbanTaskAttachment` |
| RF-03, RNF-04 | `sinterize-button.tsx` (checagem de backend + workspace) |
| RF-04 | `sinterizeTask` (template do `.md`) |
| RF-05 | `sinterizeTask` (loop de anexos) |
| RF-06 | caminho determinístico `<taskId>.md`/`<taskId>/attachments/` — escrita sempre sobrescreve |
| RF-07 | retorno `{ ok: false, error }` + toast |
| RF-08 | `task.lastSinteredAt` |
| RNF-01 | §2.2 (base64 + escape) |
| RNF-02 | limite de 256 KB em `card-attachments.tsx` |
| RNF-03 | chaves i18n novas |

# TECH — sistema-settings-menu

## 1. Estado atual da arquitetura nos pontos tocados

- **Navegação de settings**: `src/constants/settings-nav.tsx:15-68` exporta `OSS_NAV_ITEMS: SettingsNavItem[]` (ícone, `to`, `text`, `subtitle`), consumido por `src/hooks/use-settings-nav-items.ts:20` (`useSettingsNavItems()`), renderizado pelo shell `src/routes/settings.tsx`. Rotas filhas são registradas em `src/routes.ts:24-33` dentro do bloco `route("settings", "routes/settings.tsx", [...])`.
- **Página de exemplo mais próxima (padrão a seguir)**: `src/routes/app-settings.tsx` — formulário React Router (`action={formAction}`), estado local de "mudou desde o último save" por campo, `useSettings()`/`useSaveSettings()` para o que é persistido via API, e um padrão de seção com `<div className="border-t ...">` para agrupar campos relacionados (linhas 225-297).
- **Persistência local sem API**: `src/utils/workspace-mode.ts:14-35` é o padrão de referência — `readStored*`/`writeStored*` com `try/catch` silencioso ao redor de `window.localStorage`, guardado por `typeof window === "undefined"` para SSR-safety.
- **Perfis de LLM**: `src/hooks/query/use-llm-profiles.ts:12-22` (`useLlmProfiles()`) retorna `{ profiles: LlmProfile[] }` via `ProfilesService.listProfiles`; `formatModelNameForDisplay` (`src/utils/format-model-name.ts:28-33`) formata o nome do modelo para exibição, ambos já usados em `app-settings.tsx:23,25,36-37,72-80`.
- **Workspaces locais**: `src/hooks/query/use-local-workspaces.ts:13-25` (`useLocalWorkspaces()`) retorna `WorkspacesListResponse` via `WorkspacesService.listWorkspaces()`. Tipo de item: `LocalWorkspace`/`LocalWorkspaceParent` em `src/types/workspace.ts` (id, name, path).
- **Sanitização HTML**: `dompurify@3.4.14` está hoje só em `overrides` no `package.json:190` (pin de versão para as dependências transitivas de `monaco-editor`/`posthog-js`, confirmado via `npm ls dompurify`) — **não** é uma dependência direta do projeto. Importar `dompurify` em código de produção sem promovê-lo a `dependencies` é frágil (some da árvore se os pacotes transitivos deixarem de usá-lo). Esta feature promove `dompurify` a dependência direta.
- **Achado corrigido na revisão adversarial do TECH**: a hipótese inicial de que `misc_settings.app_preferences` seria um modelo fechado do SDK do agent-server está errada — o tipo gerado do SDK (`node_modules/@openhands/typescript-client/dist/generated/agent-server-schema.d.ts:9997-10000,10043`) documenta `misc_settings` como **contêiner opaco**: `"an opaque container for frontend-owned data that the agent-server persists but does not interpret"`, tipado como `{ [key: string]: unknown }`. `APP_PREFERENCE_FIELDS` (`src/api/settings-service/settings-service.api.ts:26-35`) é uma lista **autoral do frontend**, não um contrato do SDK — nada impede tecnicamente adicionar uma categoria-irmã (`system_settings`) dentro do mesmo `misc_settings` opaco.
- **Decisão de escopo (não de impossibilidade técnica)**: mesmo sendo tecnicamente viável, adicionar uma categoria nova a `misc_settings` exige tocar a extração/leitura compartilhada em `settings-service.api.ts` (`extractAppPreferences`-like, linhas 641-668 para escrita e 331,363 para leitura) e reproduzir o mesmo tratamento no caminho cloud (linhas 683-702, que hoje só achata `app_preferences`, não outras categorias de `misc_settings`, para a Cloud). Isso significa risco de regressão num módulo compartilhado por todas as outras telas de settings, para um ganho (sync entre máquinas) que não é requisito desta feature (RF-05 não pede sync entre dispositivos). Por isso esta feature usa `localStorage` como decisão de escopo v1, documentada como revisável — não como limitação técnica inexistente.

## 2. Arquitetura proposta

Três pedaços novos, sem tocar em nenhum contrato de API existente:

1. **Rota + entrada de menu**: `route("system", "routes/system-settings.tsx")` dentro do bloco `settings` de `src/routes.ts:24-34`; nova entrada em `OSS_NAV_ITEMS` (`settings-nav.tsx`) apontando para `/settings/system`.
2. **Módulo de persistência local** `src/utils/system-settings-storage.ts`: funções puras `readSystemSettings()` / `writeSystemSettings(partial)` sobre uma única chave `localStorage` (`"openhands-system-settings"`), guardando um objeto JSON `{ defaultWorkspaceId?: string; defaultLlmProfileName?: string; globalUserContextHtml?: string }`. Segue o padrão try/catch de `workspace-mode.ts:14-35`, mas usa **uma chave JSON única** (não uma chave por campo) porque os três campos formam um único registro coerente salvo atomicamente pelo formulário.
3. **Hook de leitura reativa** `src/hooks/use-system-settings.ts`: `useSystemSettings()` — lê a chave no mount via `useState(() => readSystemSettings())`, expõe `settings` (valor bruto salvo, sem reconciliação) e `saveSystemSettings(partial)` que persiste e atualiza o estado local (não há cache entre abas nesta versão — fora de escopo; ver Não-objetivos do PRD). O hook **não** conhece a lista de workspaces/perfis — quem reconcilia "o padrão salvo ainda existe?" (RF-07) é a tela `system-settings.tsx`, que já tem `useLocalWorkspaces()`/`useLlmProfiles()` carregados para os dropdowns: ela computa `effectiveDefaultWorkspaceId = workspaces.some(w => w.id === settings.defaultWorkspaceId) ? settings.defaultWorkspaceId : undefined` (mesma lógica já usada para `title_llm_profile` apagado em `app-settings.tsx:55-61`), e o mesmo para o perfil de LLM. Consumido pela tela e, futuramente, pelos sub-projetos 2–4 (que importam o mesmo hook, não a função de storage direto, e replicam a mesma reconciliação onde precisarem do valor "efetivo").
4. **Tela** `src/routes/system-settings.tsx` + subcomponentes em `src/components/features/settings/system-settings/`:
   - `default-workspace-input.tsx` — `SettingsDropdownInput` alimentado por `useLocalWorkspaces()`.
   - `default-llm-profile-input.tsx` — `SettingsDropdownInput` alimentado por `useLlmProfiles()`, mesmo formato de label de `app-settings.tsx:72-80`.
   - `global-user-context-input.tsx` — componente de rich-text mínimo (ver §3).
5. **Componente de rich text mínimo** `src/components/features/settings/system-settings/rich-text-input.tsx`: `<div contentEditable>` controlado, toolbar com 4 botões (negrito/itálico/lista/link) usando `document.execCommand`. Já há um precedente pontual de `execCommand` no repo (`src/hooks/chat/use-chat-input-events.ts:56`, `execCommand("insertText", ...)`), mas só para um caso (colar texto) — o uso aqui é maior (4 comandos, incluindo `insertUnorderedList`/`createLink`, notoriamente inconsistentes entre engines mesmo dentro do Chromium). API depreciada na spec mas funcional no Chromium embarcado pelo Electron; risco de comportamento inconsistente é aceito e coberto por teste manual explícito antes do merge (ver §9), não só teste automatizado de sanitização. `onBlur`/`onInput` sanitiza com `DOMPurify.sanitize(el.innerHTML, { ALLOWED_TAGS: [...] })` antes de subir ao estado do formulário.

Nenhum componente novo depende de rede; toda a tela funciona offline.

## 3. Modelo de dados e migrações

Não há migração de banco (nada no backend muda). Estrutura local:

```ts
// src/utils/system-settings-storage.ts
export interface SystemSettings {
  defaultWorkspaceId?: string;
  defaultLlmProfileName?: string;
  globalUserContextHtml?: string;
}
```

- Chave: `"openhands-system-settings"` (padrão de nome já usado por `LAST_LOCAL_WORKSPACE_MODE_STORAGE_KEY`, `workspace-mode.ts:7-8`).
- Sem versionamento de schema: campo ausente = `undefined`, tratado como "não definido" em todo consumidor. Se o formato mudar no futuro, o hook decide na leitura (out of scope detalhar agora — YAGNI).
- Lista de tags HTML permitidas no `DOMPurify.sanitize`: `b`, `strong`, `i`, `em`, `ul`, `ol`, `li`, `a`, `br`, `p` — suficiente para o toolbar mínimo do RF-04 e nada além disso (nenhuma tag de script, iframe, estilo inline).

## 4. Contratos: APIs, eventos, tipos públicos, assinaturas

```ts
// src/utils/system-settings-storage.ts
export function readSystemSettings(): SystemSettings;
export function writeSystemSettings(next: SystemSettings): void; // try/catch interno, sem throw

// src/hooks/use-system-settings.ts
export function useSystemSettings(): {
  settings: SystemSettings;
  saveSystemSettings: (next: SystemSettings) => void;
};
```

Este é o contrato público que os sub-projetos 2–4 desta decomposição devem importar (`useSystemSettings().settings.defaultWorkspaceId` etc.) — não devem ler `localStorage` diretamente.

## 5. Alternativas consideradas e por que foram rejeitadas

- **Persistir via nova categoria em `misc_settings` (API)**: tecnicamente viável (`misc_settings` é opaco ao agent-server, ver §1) e daria sync entre máquinas de graça. Rejeitada para v1 porque exigiria alterar a extração/leitura compartilhada de `settings-service.api.ts` usada por todas as telas de settings (risco de regressão) e replicar o tratamento no caminho Cloud, que hoje só normaliza `app_preferences` — custo desproporcional a um requisito (RF-05) que não pede sync entre dispositivos. Revisitável se um sub-projeto futuro precisar de sync.
- **Adicionar biblioteca de rich-text (Tiptap/Quill/Slate)**: rejeitada para este escopo — nenhuma dependência de editor rico existe hoje (`package.json` confirmado); o conjunto mínimo pedido (negrito/itálico/lista/link) não justifica uma dependência nova de dezenas de KB. Revisitável se o sub-projeto de contexto por card (`kanban-card-contexto-arquivos`) precisar de mais recursos de edição — nesse caso a decisão de biblioteca é revisitada lá, não aqui.
- **Markdown em vez de HTML para o contexto global**: mais barato (reaproveitaria `react-markdown`, já usado no chat) e mais seguro por padrão. Rejeitada apenas porque o usuário pediu explicitamente "campo HTML" — registrada aqui como a alternativa mais simples caso o campo HTML se mostre um problema na implementação.

## 6. Segurança, permissões e privacidade

- Toda leitura/escrita do campo HTML passa por `DOMPurify.sanitize` com allowlist fechada (§3) — nunca `dangerouslySetInnerHTML` sobre valor bruto.
- Dado é local ao navegador/perfil do SO — não trafega para nenhum backend, não é sincronizado entre máquinas. Isso deve estar visível na UI (texto de ajuda: "salvo apenas neste computador").
- Sem dados sensíveis nesta feature (não há segredo, token ou credencial nos três campos).

## 7. Performance e escala

Leitura/escrita de `localStorage` é síncrona e da ordem de microssegundos para um payload desse tamanho (nomes de workspace/perfil + texto curto) — sem necessidade de debounce ou lazy loading. `document.execCommand`, apesar de depreciado na spec HTML, permanece funcional no Chromium embarcado pelo Electron (`electron-builder.config.mjs` confirma uso de Electron) e nos browsers modernos suportados pela versão web; não há orçamento nesta feature para escrever um editor de comandos próprio sem `execCommand` — risco aceito e documentado.

## 8. Observabilidade — logs, métricas, erros

Sem chamada de rede, não há métrica de API a instrumentar. Único ponto de falha (`localStorage.setItem` lançando por quota/modo privado) é capturado no `try/catch` de `writeSystemSettings` e reportado ao usuário via toast de erro (`displayErrorToast`, mesmo utilitário de `app-settings.tsx:16-18`).

## 9. Estratégia de testes

- **Unidade**: `src/utils/system-settings-storage.test.ts` — round-trip de `write`/`read`, comportamento com `localStorage` ausente/lançando erro, comportamento com JSON corrompido salvo manualmente.
- **Unidade**: `src/components/features/settings/system-settings/rich-text-input.test.tsx` — sanitização remove tags fora da allowlist (`<script>`, `<img onerror>`), preserva tags permitidas.
- **Manual (checklist de PR, não automatizado)**: os 4 botões de toolbar (negrito, itálico, lista, link) testados manualmente no build Electron e num browser Chromium antes do merge — cobre a inconsistência conhecida de `execCommand('insertUnorderedList'/'createLink')` que teste automatizado de `jsdom` não reproduz fielmente.
- **Integração**: `src/routes/system-settings.test.tsx` — render com `useLocalWorkspaces`/`useLlmProfiles` mockados (padrão de MSW já usado no repo via `src/mocks/`), seleciona workspace e perfil, digita no campo rich-text, salva, recarrega o componente e confirma que os valores persistidos aparecem pré-selecionados.
- **Integração**: estado vazio — nenhum workspace/perfil cadastrado → dropdown mostra link (RF-06); workspace/perfil padrão apagado na origem → tela trata como "não definido" sem erro (RF-07), espelhando o teste existente de `title_llm_profile` apagado (procurar teste equivalente em `app-settings.test.tsx` para reaproveitar o padrão de mock).

## 10. Rollout, feature flag e rollback

Sem feature flag — é uma tela nova e aditiva, não altera comportamento de telas existentes. Rollback trivial: remover a entrada de `OSS_NAV_ITEMS` e a rota; nenhum dado migrado precisa ser revertido (chave de `localStorage` órfã não quebra nada se a tela for removida depois).

## 11. Rastreabilidade RF/RNF → onde é atendido

| Requisito | Onde |
|---|---|
| RF-01 | `settings-nav.tsx` (nova entrada) + `routes.ts` (nova rota) |
| RF-02 | `default-workspace-input.tsx` + `useLocalWorkspaces()` |
| RF-03 | `default-llm-profile-input.tsx` + `useLlmProfiles()` |
| RF-04 | `rich-text-input.tsx` + `DOMPurify.sanitize` |
| RF-05 | `system-settings-storage.ts` + `use-system-settings.ts` |
| RF-06 | estado vazio nos dois `*-input.tsx`, reaproveitando o link de `app-settings.tsx:249-254` |
| RF-07 | `use-system-settings.ts` valida, na leitura, que o id/nome salvo ainda existe na lista atual de workspaces/perfis |
| RNF-01 | `DOMPurify` allowlist (§3, §6) |
| RNF-02 | reaproveita `SettingsDropdownInput`/`SettingsInput` (acessibilidade herdada) |
| RNF-03 | skeleton enquanto `useLocalWorkspaces`/`useLlmProfiles` carregam, mesmo padrão de `AppSettingsInputsSkeleton` |
| RNF-04 | `try/catch` em `writeSystemSettings` + toast |
| RNF-05 | novas chaves i18n em `declaration.ts`/`translation.json` |

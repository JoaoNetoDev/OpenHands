# SPEC — sistema-settings-menu

## 1. Resumo e escopo

Nova tela `/settings/system` ("Sistema") com três campos persistidos em `localStorage`: workspace padrão, perfil de LLM padrão, contexto global do usuário (HTML sanitizado). Escopo fechado nesta SPEC: navegação, persistência local, formulário e reconciliação contra listas atuais de workspaces/perfis. Fora de escopo: qualquer consumo desses valores pelo board Kanban (sub-projetos seguintes).

## 2. Desenho detalhado por componente

### 2.1 `src/utils/system-settings-storage.ts` (novo)

```ts
export interface SystemSettings {
  defaultWorkspaceId?: string;
  defaultLlmProfileName?: string;
  globalUserContextHtml?: string;
}

export const SYSTEM_SETTINGS_STORAGE_KEY = "openhands-system-settings";

export function readSystemSettings(): SystemSettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SYSTEM_SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSystemSettings(next: SystemSettings): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      SYSTEM_SETTINGS_STORAGE_KEY,
      JSON.stringify(next),
    );
    return true;
  } catch {
    return false;
  }
}
```

`writeSystemSettings` retorna `boolean` (não lança) para que o chamador decida o toast de erro sem `try/catch` na tela.

### 2.2 `src/hooks/use-system-settings.ts` (novo)

```ts
export function useSystemSettings(): {
  settings: SystemSettings;
  saveSystemSettings: (next: SystemSettings) => boolean;
} {
  const [settings, setSettings] = React.useState<SystemSettings>(() =>
    readSystemSettings(),
  );
  const saveSystemSettings = React.useCallback((next: SystemSettings) => {
    const ok = writeSystemSettings(next);
    if (ok) setSettings(next);
    return ok;
  }, []);
  return { settings, saveSystemSettings };
}
```

Sem reconciliação aqui (ver 2.4) — devolve exatamente o que está salvo.

### 2.3 `src/components/features/settings/system-settings/rich-text-input.tsx` (novo)

Props: `{ testId: string; label: string; defaultValueHtml: string; onChange: (html: string) => void }`.

- `<div contentEditable role="textbox" aria-label={label} dangerouslySetInnerHTML={{ __html: sanitize(defaultValueHtml) }} onInput={handleInput} />` — `dangerouslySetInnerHTML` usado uma única vez, só com saída já sanitizada por `sanitize()` (nunca o HTML bruto do evento).
- Toolbar de 4 botões (`<button type="button">`) chamando `document.execCommand("bold"|"italic"|"insertUnorderedList", false)` e um quinto fluxo para link: `prompt`-free — usa um pequeno input inline para URL antes de `execCommand("createLink", false, url)` (evitar `window.prompt`, que não funciona em todos os shells do Electron).
- `handleInput` lê `event.currentTarget.innerHTML`, sanitiza com `sanitize()` (função local que chama `DOMPurify.sanitize(html, { ALLOWED_TAGS: ["b","strong","i","em","ul","ol","li","a","br","p"], ALLOWED_ATTR: ["href"] })`), e só então chama `onChange(sanitizedHtml)`.
- Não recria o DOM a cada render (evita perder a posição do cursor) — só sincroniza `innerHTML` quando `defaultValueHtml` muda por fonte externa (ex.: reset de formulário), via `useEffect` com guarda de igualdade.

### 2.4 `src/routes/system-settings.tsx` (novo)

```tsx
function SystemSettingsScreen() {
  const { settings, saveSystemSettings } = useSystemSettings();
  const { data: workspacesData, isLoading: workspacesLoading } = useLocalWorkspaces();
  const { data: llmProfiles, isLoading: profilesLoading } = useLlmProfiles();

  const effectiveDefaultWorkspaceId =
    workspacesData?.workspaces.some((w) => w.id === settings.defaultWorkspaceId)
      ? settings.defaultWorkspaceId
      : undefined;
  const effectiveDefaultLlmProfileName =
    llmProfiles?.profiles.some((p) => p.name === settings.defaultLlmProfileName)
      ? settings.defaultLlmProfileName
      : undefined;

  // form state: workspaceInput/profileInput/contextHtmlInput seed from effective* values,
  // dirty-tracking idêntico ao padrão de app-settings.tsx (useState + hasChanged por campo)

  const handleSave = () => {
    const ok = saveSystemSettings({
      defaultWorkspaceId: workspaceInput,
      defaultLlmProfileName: profileInput,
      globalUserContextHtml: contextHtmlInput,
    });
    if (ok) displaySuccessToast(t(I18nKey.SETTINGS$SAVED));
    else displayErrorToast(t(I18nKey.SYSTEM_SETTINGS$SAVE_ERROR));
  };
  // ...
}
```

Estrutura visual: mesmo padrão de seções com `<div className="border-t ...">` de `app-settings.tsx:225-297`; skeleton (`workspacesLoading || profilesLoading`) reaproveitando `AppSettingsInputsSkeleton` como referência visual (novo componente `SystemSettingsInputsSkeleton` porque os campos são diferentes).

Nota de rodapé fixa na tela: texto de ajuda avisando que os três valores são salvos só neste navegador (RNF de privacidade).

### 2.5 Navegação

`src/constants/settings-nav.tsx` — adicionar ao array `OSS_NAV_ITEMS` (após o item `agent-context`, antes de `verification`, refletindo a ordem "configuração de agente" → "configuração de sistema" → "verificação"):

```tsx
{
  icon: <Settings2 className="size-4" strokeWidth={2} aria-hidden />, // lucide-react, já uma dependência (settings-nav.tsx:1)
  to: "/settings/system",
  text: "SETTINGS$NAV_SYSTEM",
  subtitle: "SETTINGS$PAGE_SYSTEM_SUBLINE",
},
```

`src/routes.ts` — adicionar `route("system", "routes/system-settings.tsx")` dentro do bloco `settings` (`routes.ts:24-34`), entre `agent-context` e `verification`.

### 2.6 `package.json`

Mover `dompurify` de `overrides` (linha 190) para `dependencies`, fixando `"dompurify": "3.4.14"` (mesma versão já resolvida hoje, sem mudança de comportamento em runtime).

## 3. Fluxo principal passo a passo e fluxos de erro

**Fluxo principal:**
1. Usuário navega para `/settings/system`.
2. Tela carrega workspaces e perfis de LLM (skeleton enquanto pendente).
3. Tela lê `localStorage` (síncrono) e pré-seleciona os valores efetivos (reconciliados).
4. Usuário troca o workspace padrão, o perfil padrão, e/ou edita o texto rico.
5. Usuário clica "Salvar" → `writeSystemSettings` → toast de sucesso.
6. Ao recarregar a página, os três valores reaparecem pré-selecionados.

**Fluxos de erro:**
- `localStorage.setItem` lança (quota excedida / modo privado restritivo) → `writeSystemSettings` retorna `false` → toast de erro, formulário permanece com os valores digitados (não perde o que o usuário escreveu).
- `localStorage.getItem` retorna JSON corrompido → `readSystemSettings` captura o erro de `JSON.parse` e retorna `{}` — tela abre com os três campos vazios, sem crash.
- Workspace ou perfil salvo como padrão não existe mais na lista atual → reconciliação (§2.4) trata como não selecionado, sem erro visível.
- Nenhum workspace/perfil cadastrado → dropdown mostra estado vazio com link (RF-06): para workspace, link para a home (`/`); para perfil de LLM, link para `/settings/llm` (mesmo padrão de `app-settings.tsx:249-254`).

## 4. Casos de borda

- **Concorrência**: duas abas do Canvas abertas — a segunda aba só reflete o valor salvo pela primeira após reload (sem `storage` event listener nesta versão; documentado como limitação aceita, não é requisito do PRD).
- **HTML colado de fora** (ex.: colar de um Google Doc): `onInput` sanitiza a cada evento, incluindo o evento disparado por paste em `contentEditable`; coberto por um teste dedicado de paste em `rich-text-input.test.tsx` (§7) em vez de assumido — browsers podem variar a sequência exata de eventos, então o teste dispara `paste` diretamente (não só `input`) para não depender de timing.
- **Campo de contexto vazio**: `globalUserContextHtml: undefined` é um estado válido, não obrigatório (RF-04 não diz que é obrigatório).
- **Link sem `https://`/`http://`**: `createLink` aceita qualquer string; sanitização mantém o atributo `href` como está (XSS via `javascript:` é neutralizado pelo próprio `DOMPurify`, que remove `javascript:` de atributos `href` por padrão).

## 5. Mudanças arquivo a arquivo

| Arquivo | Ação | O que muda |
|---|---|---|
| `src/utils/system-settings-storage.ts` | criar | `SystemSettings`, `readSystemSettings`, `writeSystemSettings` |
| `src/utils/system-settings-storage.test.ts` | criar | testes de unidade (§ Plano de testes) |
| `src/hooks/use-system-settings.ts` | criar | `useSystemSettings()` |
| `src/components/features/settings/system-settings/rich-text-input.tsx` | criar | editor rich-text mínimo + sanitização |
| `src/components/features/settings/system-settings/rich-text-input.test.tsx` | criar | testes de sanitização |
| `src/components/features/settings/system-settings/system-settings-inputs-skeleton.tsx` | criar | skeleton de carregamento |
| `src/routes/system-settings.tsx` | criar | tela "Sistema" |
| `src/routes/system-settings.test.tsx` | criar | teste de integração da tela |
| `src/routes.ts` | alterar | nova `route("system", ...)` dentro do bloco `settings` |
| `src/constants/settings-nav.tsx` | alterar | novo item em `OSS_NAV_ITEMS` |
| `src/i18n/declaration.ts` | alterar | novas chaves `SETTINGS$NAV_SYSTEM`, `SETTINGS$PAGE_SYSTEM_SUBLINE`, `SYSTEM_SETTINGS$*` |
| `src/i18n/translation.json` | alterar | traduções para as chaves novas (idiomas já suportados pelo repo) |
| `package.json` | alterar | `dompurify` movido de `overrides` para `dependencies` |

## 6. Critérios de aceitação

- **CA-01** (RF-01): a entrada "Sistema" aparece no menu de settings e navega para `/settings/system`.
- **CA-02** (RF-02): selecionar um workspace e salvar persiste `defaultWorkspaceId`; após reload, o mesmo workspace aparece selecionado.
- **CA-03** (RF-03): selecionar um perfil de LLM e salvar persiste `defaultLlmProfileName`; após reload, o mesmo perfil aparece selecionado.
- **CA-04** (RF-04, RNF-01): digitar `<script>alert(1)</script>` (via devtools, simulando paste malicioso) no campo de contexto resulta em HTML persistido sem a tag `<script>`.
- **CA-05** (RF-05): `writeSystemSettings` grava sob a chave `openhands-system-settings` e o valor é lido de volta idêntico (round-trip).
- **CA-06** (RF-06): com zero workspaces cadastrados, o dropdown de workspace mostra o link para cadastro em vez de lista vazia.
- **CA-06b** (RF-06): com zero perfis de LLM cadastrados, o dropdown de perfil mostra o link para `/settings/llm` em vez de lista vazia.
- **CA-07** (RF-07): salvar um workspace como padrão, apagá-lo na tela de origem, reabrir `/settings/system` — o campo aparece "não selecionado", sem erro no console.
- **CA-08** (RNF-04): mock de `localStorage.setItem` lançando erro → toast de erro exibido, valores do formulário preservados.
- **CA-09** (RNF-02): os três campos têm `label`/`aria-label` associados corretamente (teste via `getByRole` com `name` acessível, não `getByTestId`).
- **CA-10** (RNF-03): com `useLocalWorkspaces`/`useLlmProfiles` em estado `isLoading`, a tela renderiza `SystemSettingsInputsSkeleton` em vez do formulário, sem lançar erro por dado ainda ausente.
- **CA-11** (RNF-05): todas as chaves i18n novas (`SETTINGS$NAV_SYSTEM`, `SETTINGS$PAGE_SYSTEM_SUBLINE`, `SYSTEM_SETTINGS$SAVE_ERROR`, etc.) existem em `src/i18n/declaration.ts` e têm entrada em `src/i18n/translation.json` (verificável pelo script `make-i18n` já usado em `npm run test`, `package.json:84`, que falha se uma chave usada em código não existir na declaração).

## 7. Plano de testes

- **Unidade** (`system-settings-storage.test.ts`): round-trip read/write; `localStorage` indisponível; JSON corrompido; `write` retornando `false` em erro.
- **Unidade** (`rich-text-input.test.tsx`): sanitização remove `<script>`/`onerror`/`javascript:`; preserva `<b>`,`<i>`,`<ul>`,`<a href>`; dispara evento `paste` com HTML malicioso e confirma que o valor sanitizado chega em `onChange`.
- **Unidade/integração** (`system-settings.test.tsx`): CA-09 (acessibilidade via `getByRole`), CA-10 (skeleton durante `isLoading`), CA-11 coberto indiretamente pelo `make-i18n` do pipeline de teste do projeto (`package.json:84`).
- **Integração** (`system-settings.test.tsx`): fluxo completo de CA-01 a CA-07 com `useLocalWorkspaces`/`useLlmProfiles` mockados via MSW (padrão `src/mocks/`).
- **Manual** (checklist de PR, não automatizado): os 4 botões de toolbar testados no build Electron real (ver TECH §9) — cobre a flakiness conhecida de `execCommand` que `jsdom` não reproduz.

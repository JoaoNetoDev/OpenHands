# SPRINT-03 — Tela "Sistema", navegação e i18n

## Objetivo
Tela completa acessível em `/settings/system`, integrada ao menu de settings.

## Depende de
SPRINT-01, SPRINT-02

## Onda
3

## Arquivos previstos
- `src/routes/system-settings.tsx` — criar
- `src/routes/system-settings.test.tsx` — criar
- `src/components/features/settings/system-settings/system-settings-inputs-skeleton.tsx` — criar
- `src/routes.ts` — alterar — nova rota `system` dentro do bloco `settings`
- `src/constants/settings-nav.tsx` — alterar — novo item `OSS_NAV_ITEMS`
- `src/i18n/declaration.ts` — alterar — novas chaves
- `src/i18n/translation.json` — alterar — traduções das novas chaves

## Passos de implementação
1. Criar `SystemSettingsInputsSkeleton` (mesmo padrão visual de `AppSettingsInputsSkeleton`).
2. Criar `system-settings.tsx` conforme SPEC §2.4: reconciliação de valores efetivos, dropdowns, editor rich-text, botão salvar, texto de ajuda sobre escopo local.
3. Registrar a rota em `routes.ts` e o item de nav em `settings-nav.tsx` (ícone `Settings2` de `lucide-react`).
4. Adicionar chaves i18n (`SETTINGS$NAV_SYSTEM`, `SETTINGS$PAGE_SYSTEM_SUBLINE`, `SYSTEM_SETTINGS$*`) em `declaration.ts` e traduções em `translation.json` para todos os idiomas já suportados.
5. Rodar `npm run make-i18n` para validar que toda chave usada existe declarada.

## Testes obrigatórios
- Fluxo completo CA-01 a CA-03, CA-06, CA-06b, CA-07, CA-09, CA-10 com MSW mockando `useLocalWorkspaces`/`useLlmProfiles`.
- CA-08: `localStorage.setItem` mockado para lançar erro.

## Critérios de aceitação
- [ ] CA-01, CA-02, CA-03, CA-06, CA-06b, CA-07, CA-08, CA-09, CA-10, CA-11.

## Comandos de verificação
```bash
npm run make-i18n
npm run typecheck
npx vitest run src/routes/system-settings.test.tsx
npm run lint
```

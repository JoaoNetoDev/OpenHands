# SPRINT-02 — Editor rich-text mínimo

## Objetivo
Componente `RichTextInput` isolado, sanitizado e testado, sem depender da tela final.

## Depende de
SPRINT-01 (usa `dompurify` já promovido a dependência)

## Onda
2

## Arquivos previstos
- `src/components/features/settings/system-settings/rich-text-input.tsx` — criar
- `src/components/features/settings/system-settings/rich-text-input.test.tsx` — criar

## Passos de implementação
1. Implementar `RichTextInput` conforme SPEC §2.3: `contentEditable`, toolbar de 4 botões, sanitização via `DOMPurify.sanitize` com a allowlist do TECH §3.
2. Implementar o fluxo de link sem `window.prompt` (input inline de URL).
3. Garantir que a sincronização de `defaultValueHtml` externo não reseta o cursor durante digitação (guarda de igualdade no `useEffect`).

## Testes obrigatórios
- Sanitização remove `<script>`, atributos `on*`, `javascript:` em `href`.
- Preserva tags da allowlist (`<b>`, `<i>`, `<ul>`, `<a href>`).
- Evento `paste` com HTML malicioso é sanitizado antes de chegar em `onChange`.

## Critérios de aceitação
- [ ] CA-04: `<script>` nunca sobrevive à sanitização.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/components/features/settings/system-settings/rich-text-input.test.tsx
```

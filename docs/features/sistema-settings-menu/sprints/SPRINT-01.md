# SPRINT-01 — Persistência local e hook de sistema

## Objetivo
Ter `readSystemSettings`/`writeSystemSettings`/`useSystemSettings` prontos e testados, sem UI ainda.

## Depende de
nenhuma

## Onda
1

## Arquivos previstos
- `src/utils/system-settings-storage.ts` — criar — `SystemSettings`, `readSystemSettings`, `writeSystemSettings`
- `src/utils/system-settings-storage.test.ts` — criar — testes de unidade
- `src/hooks/use-system-settings.ts` — criar — `useSystemSettings()`
- `package.json` — alterar — mover `dompurify` de `overrides` para `dependencies`

## Passos de implementação
1. Criar `SystemSettings` e as duas funções de storage conforme SPEC §2.1.
2. Criar `useSystemSettings()` conforme SPEC §2.2.
3. Mover a entrada `dompurify` em `package.json` de `overrides` para `dependencies`, mesma versão (`3.4.14`).
4. Rodar `npm install` para atualizar o lockfile.

## Testes obrigatórios
- Round-trip read/write.
- `localStorage` lançando erro em `getItem`/`setItem`.
- JSON corrompido salvo manualmente na chave.

## Critérios de aceitação
- [ ] CA-05: round-trip idêntico.
- [ ] CA-08 (parte de storage): `writeSystemSettings` retorna `false` em erro, sem lançar.

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/utils/system-settings-storage.test.ts
```

# SPRINT-01 — Sidebar, workspace embutido, perfil com provedor

## Objetivo
Os 3 itens independentes do resto (RF-01 a RF-04) — melhoria visível mais rápida.

## Depende de
nenhuma (parte do que já está integrado nos 4 sub-projetos anteriores)

## Onda
1

## Arquivos previstos
- `src/components/features/sidebar/sidebar-rail-body.tsx` — alterar
- `src/routes/system-settings.tsx` — alterar
- `src/i18n/declaration.ts`, `src/i18n/translation.json` — alterar

## Passos de implementação
1. Link "Sistema" no rodapé da sidebar, abaixo de `BackendSelector` (SPEC §2.1), incluindo o modo colapsado.
2. Dropdown de workspace ganha item "Criar workspace", abre `OpenWorkspaceDialog` reaproveitado (SPEC §2.2).
3. Trocar `useLlmProfiles()` por `useAgentProfiles()`; rótulo grosseiro por item (`agent_kind`); detalhe de provedor sob demanda só para o perfil selecionado, via `AgentProfilesService.getProfile` + `getAcpProviderDisplayName(acp_server)` (SPEC §2.3 — string, não objeto).

## Testes obrigatórios
- CA-01, CA-02, CA-03.

## Critérios de aceitação
- [ ] CA-01, CA-02, CA-03.

## Comandos de verificação
```bash
npm run make-i18n && npm run typecheck
npx vitest run src/routes/system-settings.test.tsx
npm run lint
```

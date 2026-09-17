# SPRINT-04 — Briefing do agente e criação de conversa

## Objetivo
Montar o texto enviado ao agente a partir de tarefa/fase/sistema e disparar
a criação de conversa no backend/workspace corretos, para local e cloud.

## Depende de
SPRINT-01 (tipos `AikTask`/`AikPhase`/`AikSystem`)

## Onda
2

## Arquivos previstos
- `src/api/aik-pipeline.api.ts` — criar — `buildAikAgentBriefing`,
  `startAikAgentTask` (SPEC §2.5)
- `src/api/aik-pipeline.api.test.ts` — criar

## Passos de implementação
1. `buildAikAgentBriefing(task, phase, system, contextText)`: montar nesta
   ordem, filtrando linhas vazias — skill (só se `task.agentSkill`
   preenchido), título, descrição, contexto herdado (fase+sistema, nunca a
   lista completa), checklist não concluído, `contextText`, contrato de
   arquivo (só se `task.linkedConversationId` já existe) — conforme SPEC
   §2.5, mesmo padrão de `buildFeatdevelopInitialMessage`
   (`kanban-pipeline.api.ts:20-24`).
2. `startAikAgentTask(system, phase, task)`: chama
   `AgentServerConversationService.createConversation` (mesmo serviço de
   `kanban-pipeline.api.ts:77`) com o briefing como mensagem inicial.
   Parâmetro de workspace por `system.workspaceRef.kind`:
   - `"local"` → `workingDirOverride: workspaceRef.path`
   - `"cloud"` → `metadata: {selected_repository:
     workspaceRef.repository.fullName, git_provider:
     workspaceRef.repository.provider}`
   (mapeamento exato definido em SPEC §2.5, achado F-SPEC-4).
3. Não toca store — devolve `{ok,conversationId}` ou `{ok:false,error}`.

## Testes obrigatórios
- Briefing sem `agentSkill` não menciona skill nenhuma; com `agentSkill`
  menciona exatamente uma linha `Use a skill /X.`.
- Briefing com 1 tarefa vs. briefing com uma tarefa idêntica mas o sistema
  tendo 500 tarefas no total: tamanho igual (RNF-03/CA-34) — prova via
  mock de um `system`/`phase` grande sem que `buildAikAgentBriefing` receba
  a lista de tarefas do sistema como parâmetro (assinatura já garante isso;
  o teste documenta a garantia).
- Contrato de arquivo só aparece quando `linkedConversationId` já existe.
- `startAikAgentTask` local: `createConversation` chamado com
  `workingDirOverride`. Cloud: chamado com `metadata.selected_repository`/
  `git_provider`, nunca com `workingDirOverride`.

## Critérios de aceitação
- [ ] CA-16, CA-21 (metade cloud), CA-34

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/api/aik-pipeline.api.test.ts
```

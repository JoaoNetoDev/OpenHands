# BUILD-STATE — aik-kanban-sistemas — CONCLUÍDO

Todas as 11 sprints, 5 ondas, integradas na branch `sprint/openhands-tray-03`.
Motor: nativo em todas as sprints (M3 indisponível — falta pwsh).

## Verificação final (árvore integrada completa)
- `npm run typecheck`: limpo.
- `npm run check-translation-completeness`: completo, 15 idiomas.
- Suíte AIK completa (`aik.ts`, dependency-graph, board-file, pipeline, store,
  componentes, rotas): 13 arquivos, 119 testes, 119 passando.
- Baseline pré-existente (não afetado): 19 arquivos/92 testes falhando desde
  antes do AIK, confirmado no início do build.

## Todas as sprints
| Sprint | Onda | Rodadas | Achados relevantes |
|---|---|---|---|
| 01 — tipos + grafo de dependência | 1 | 1 | 0 findings |
| 02 — roteamento por hostname | 1 | 2 | BLOQUEANTE: `<Routes>` imperativo quebrava `clientLoader` (crash real em `/automations/new/:id`); corrigido com fallback `/__aik` documentado na SPEC |
| 03 — persistência de arquivo | 2 | 1 | 1 nota |
| 04 — briefing + conversa | 2 | 2 | 2 médios (ordem de briefing sem teste; cast de provider não validado) corrigidos |
| 05 — breadcrumb + timeline | 2 | 1 | 0 BLOQ (traduções corrigidas manualmente) |
| 06 — store (cérebro) | 3 | 1 | 0 findings |
| 07 — shell + conversa | 4 | 1 | 0 findings (achou e corrigiu dependência de NavigationContext não documentada no TECH) |
| 08 — kanban de sistemas | 4 | 1 | 2 baixa (traduções corrigidas manualmente) |
| 09 — kanban de fases | 4 | 1 | 1 nota |
| 10 — kanban de tarefas | 4 | 1 | 2 baixa (traduções + allowlist corrigidas) |
| 11 — publicação (código) | 5 | 2 | BLOQUEANTE: lint falhando + specs E2E com timeout — corrigidos. Achou e corrigiu bug crítico: `AikLayout` sem `ReactRouterNavigationProvider`, navegação inteira do AIK era no-op silencioso desde a onda 4. NOTA não-bloqueante: M1 do PRD medido incorretamente pelo spec (conta cliques de criação de sistema que o PRD não inclui nessa métrica) — dívida de teste + UI de criar fase/tarefa ainda inexistente |

## Fora do escopo deste build (por decisão do usuário, pendente)
- Vhost Apache `aik.zadotec.com.br` + certificado TLS — infraestrutura de
  produção, requer confirmação explícita antes de executar.

## Trabalho de terceiros preservado
Durante a onda 4/5, detectado trabalho concorrente de outro processo no
mesmo worktree principal (`src/utils/file-validation.ts`,
`.openhands/memory/MEMORY.md`, bump de limite de anexo). Mantido intocado,
não commitado, fora de todos os merges do AIK — confirmado presente e
intacto ao final do build.

## Estado final
Tudo integrado em `sprint/openhands-tray-03`, NÃO commitado além dos merges
de sprint já feitos — a integração final (`git log`) está pronta para revisão
de diff do usuário. Nenhum push, nenhuma PR.

## Publicação (2026-09-16, confirmado pelo usuário)
- Vhost `/etc/apache2/sites-available/aik.zadotec.com.br.conf` (porta 80) +
  `-le-ssl.conf` (porta 443, gerado por certbot) criados e habilitados.
- Certificado TLS emitido via certbot (Let's Encrypt), reaproveitando a conta
  já registrada neste host. Expira 2026-12-15, renovação automática já
  agendada pelo certbot.
- Corrigido manualmente `X-Forwarded-Proto` de "http" pra "https" no vhost SSL
  (certbot copiou o valor errado do vhost porta-80 original).
- Verificado: HTTP 200 em `https://aik.zadotec.com.br/`, redirect 301 de
  HTTP pra HTTPS, endpoint `/sockets` respondendo.

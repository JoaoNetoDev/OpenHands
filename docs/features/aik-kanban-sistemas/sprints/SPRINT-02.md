# SPRINT-02 — Spike e esqueleto de roteamento por hostname

## Objetivo
Provar (com um navegador real, não só tipos) que `host-gate.tsx` consegue
decidir entre o Agent Canvas atual e o AIK por hostname, com `<Routes>`
imperativo do `react-router@7.18.2` funcionando dentro do data router de
framework mode já montado pelo app — o risco mais alto do plano (SPEC §2.1,
achado F-SPEC-5).

## Depende de
nenhuma

## Onda
1

## Arquivos previstos
- `src/routes.ts` — alterar — árvore única vira `route("*",
  "routes/host-gate.tsx")` (SPEC §5)
- `src/routes/host-gate.tsx` — criar — detecção de `window.location
  .hostname`, delega para `AgentCanvasApp` ou `AikRoutes`
- `src/routes/agent-canvas-app.tsx` — criar — a árvore de rotas atual (hoje
  em `src/routes.ts:8-49`) movida sem alteração de conteúdo
- `src/routes/aik/aik-routes.tsx` — criar — `<Routes>` do AIK com as 3 rotas
  (`index`, `:systemId`, `:systemId/fases/:phaseId`), **importando desde já
  os caminhos finais** dos componentes reais (`./aik-layout`,
  `./aik-systems-board`, `./aik-phases-board`, `./aik-tasks-board`) — este
  arquivo não é tocado de novo por nenhum sprint posterior (ver nota
  abaixo, correção ao achado F-SPRINT-1 do validador adversarial)
- `src/routes/aik/aik-layout.tsx` — criar — stub mínimo
  (`<div data-testid="aik-layout"><Outlet/></div>`), reescrito pelo
  SPRINT-07
- `src/routes/aik/aik-systems-board.tsx` — criar — stub mínimo
  (`<div data-testid="aik-systems-board"/>`), reescrito pelo SPRINT-08
- `src/routes/aik/aik-phases-board.tsx` — criar — stub mínimo
  (`<div data-testid="aik-phases-board"/>`), reescrito pelo SPRINT-09
- `src/routes/aik/aik-tasks-board.tsx` — criar — stub mínimo
  (`<div data-testid="aik-tasks-board"/>`), reescrito pelo SPRINT-10
- `src/routes/host-gate.test.tsx` — criar

**Nota sobre por que os 4 stubs nascem aqui**: se `aik-routes.tsx`
importasse componentes que só passam a existir nos sprints da onda 4,
qualquer um dos 4 sprints paralelos daquela onda precisaria voltar e editar
`aik-routes.tsx` pra religar sua rota — exatamente a colisão de arquivo
entre sprints da mesma onda que o validador adversarial apontou como
BLOQUEANTE (F-SPRINT-1). Criando aqui um stub trivial em cada caminho
final, `aik-routes.tsx` importa o caminho definitivo desde o início e nunca
mais é tocado; cada sprint da onda 4 só **altera** (nunca cria) o arquivo
que já é seu, sem tocar em nenhum arquivo de outro sprint.

## Passos de implementação
1. Mover o conteúdo de `src/routes.ts:8-49` para `agent-canvas-app.tsx`,
   convertendo o `RouteConfig` num componente que monta essas rotas via
   `<Routes>` (mesmo padrão a validar no passo 2, aplicado aqui ao lado que
   já existe e cujo comportamento é conhecido — serve de controle).
2. Implementar `AikRoutes` com 3 rotas placeholder e `host-gate.tsx`
   decidindo entre os dois por `AIK_HOSTNAMES.includes(window.location
   .hostname)` (SPEC §2.1).
3. **Spike manual obrigatório antes de fechar o sprint**: rodar `npm run
   dev`, acessar via `/etc/hosts` local apontando um hostname de teste para
   `127.0.0.1`, confirmar que `useParams()` resolve `:systemId` dentro do
   `<Routes>` aninhado e que `useNavigate()` não interfere no histórico do
   `AgentCanvasApp` quando o hostname padrão é usado. Registrar o resultado
   como comentário no PR.
4. **Se o spike falhar**: aplicar o fallback documentado em SPEC §2.1 —
   registrar as rotas do AIK como entradas normais de `src/routes.ts` (mesma
   árvore file routes) sob um path reservado (`/__aik/*`), com
   `host-gate.tsx` redirecionando `/` para lá quando o hostname bate. Neste
   caso, `aik-routes.tsx` deixa de existir e as 3 rotas entram direto em
   `routes.ts`/`agent-canvas-app.tsx` — ajustar os arquivos previstos deste
   sprint de acordo antes de integrar.

## Testes obrigatórios
- `host-gate.test.tsx`: hostname AIK monta `AikRoutes` (placeholder
  visível); hostname padrão monta `AgentCanvasApp` (rota existente
  renderiza) — mock de `window.location.hostname` via `vi.stubGlobal`.
- Regressão: alguma rota já existente do Agent Canvas (ex. `/board`)
  continua renderizando via `AgentCanvasApp` sem mudança de comportamento.

## Critérios de aceitação
- [ ] CA-01 (metade "roteamento"): hostname decide corretamente qual app
      monta
- [ ] Risco de SPEC §2.1 resolvido: spike documentado, com decisão
      registrada (padrão original ou fallback `/__aik/*`)

## Comandos de verificação
```bash
npm run typecheck
npm run lint
npx vitest run src/routes/host-gate.test.tsx
```

# SPRINT-05 — Componentes de apresentação puros

## Objetivo
Construir breadcrumb e timeline como componentes sem estado próprio,
reutilizáveis pelas telas das ondas 3 e 4.

## Depende de
SPRINT-01 (tipos `AikTimelineEntry`)

## Onda
2

## Arquivos previstos
- `src/components/features/aik/aik-breadcrumb.tsx` — criar — props
  `{ systemId?: string; phaseId?: string }` (SPEC §2.6)
- `src/components/features/aik/aik-timeline.tsx` — criar — props
  `{ entries: AikTimelineEntry[] }`, somente leitura (SPEC §2.6)
- `src/components/features/aik/aik-breadcrumb.test.tsx` — criar
- `src/components/features/aik/aik-timeline.test.tsx` — criar

## Passos de implementação
1. `AikBreadcrumb`: renderiza `sistema › fase › tarefa` com cada segmento
   clicável (link para a rota correspondente), omitindo segmentos ausentes.
   Usa `I18nKey`/`react-i18next` para os textos fixos (RNF-10).
2. `AikTimeline`: lista `entries` em ordem cronológica, um item por
   `kind` (`comment`, `status_change`, `run_started`, `run_stopped`,
   `review_feedback`), com rótulo traduzido por tipo.
3. Sem `dangerouslySetInnerHTML` em nenhum campo de texto (RNF-05/CA-36).

## Testes obrigatórios
- `AikBreadcrumb`: 1, 2 e 3 segmentos; cada link aponta pra rota certa.
- `AikTimeline`: ordena por `at`; renderiza cada `kind` com rótulo distinto;
  texto com HTML embutido é exibido literal, não executado (CA-36).

## Critérios de aceitação
- [ ] CA-19 (renderização, a gravação de entradas é do SPRINT-06)
- [ ] CA-36 (para os campos que passam por estes componentes)
- [ ] CA-40 (strings traduzíveis)

## Comandos de verificação
```bash
npm run typecheck
npx vitest run src/components/features/aik/aik-breadcrumb.test.tsx src/components/features/aik/aik-timeline.test.tsx
```

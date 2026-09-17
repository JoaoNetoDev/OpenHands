# SPRINT-11 — Publicação e verificação end-to-end

## Objetivo
Colocar `aik.zadotec.com.br` no ar apontando pro mesmo processo, sem
regressão em `openhands.zadotec.com.br`, e provar com testes reais (não só
unidade) os critérios que só fazem sentido contra o sistema publicado.

## Depende de
SPRINT-07, SPRINT-08, SPRINT-09, SPRINT-10 (todas as telas do AIK
completas)

## Onda
5

## Arquivos previstos
- `/etc/apache2/sites-available/aik.zadotec.com.br.conf` — criar (infra,
  fora do repo) — vhost espelhado, TECH §2.1, SEM reescrita de path,
  incluindo `/sockets` e `/vault`
- `/etc/apache2/sites-available/aik.zadotec.com.br-le-ssl.conf` — criar
  (infra, fora do repo) — mesmo vhost sob TLS (certbot)
- `tests/e2e/aik/aik-deep-link.spec.ts` — criar — Playwright, usa
  `playwright.config.ts` existente
- `tests/e2e/aik/aik-performance.spec.ts` — criar
- `tests/e2e/aik/aik-golden-path.spec.ts` — criar

## Passos de implementação
1. Criar e habilitar o vhost (`a2ensite`), emitir certificado
   (`certbot --apache -d aik.zadotec.com.br`), confirmar
   `getent hosts aik.zadotec.com.br` já resolve (confirmado no
   reconhecimento do PRD) e `systemctl reload apache2`.
2. `aik-deep-link.spec.ts`: acessar
   `https://aik.zadotec.com.br/<systemId>/fases/<phaseId>` **direto**, sem
   navegação client-side prévia — a única forma de provar que o
   roteamento por hostname (SPRINT-02) funciona ponta a ponta, incluindo o
   caso em que o spike daquele sprint tomou o caminho de fallback
   (`/__aik/*`).
3. `aik-performance.spec.ts`: popular 200 tarefas via chamada direta ao
   `aik-board-store` (não via 200 cliques de UI), medir first paint e
   latência de drag com Playwright Tracing contra o build de produção
   (`npm run build:app` + `npm run start`).
4. `aik-golden-path.spec.ts`: roteiro completo — criar sistema → criar
   fase → criar tarefa → Executar → (mock de agente concluindo e movendo
   pra `in_review`) → Aprovar — medindo cliques até Executar (M1 do PRD).
5. Verificação manual, registrada no PR: acessar
   `openhands.zadotec.com.br` depois do deploy e confirmar nenhuma
   regressão (CA-01, segunda metade — não automatizável neste sprint sem
   suite E2E do Agent Canvas atual, fora de escopo tocar).

## Testes obrigatórios
- Os 3 specs Playwright listados acima.
- `npm run lint` e `npm run test` completos, comparados contra `git stash`
  da base pré-AIK (RNF-11/CA-41).

## Critérios de aceitação
- [ ] CA-01 (completo), CA-02, CA-28, CA-31, CA-32, CA-35 (verificação E2E
      de ponta a ponta, complementando o teste unitário do SPRINT-03),
      CA-41, M1/M2/M3 do PRD

## Comandos de verificação
```bash
npm run build:app
npm run start &
npx playwright test tests/e2e/aik/ --config=playwright.config.ts
npm run lint
npm run test
```

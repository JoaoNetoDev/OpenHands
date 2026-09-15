# SPRINT-04 — Verificação de integração real: rollback automático e reversão explícita

## Objetivo
Provar, contra um host real, que o caminho de falha (health check falha → rollback automático) e o `--rollback` explícito funcionam de ponta a ponta — o critério de aceite mais crítico da feature.

## Depende de
SPRINT-03

## Onda
4

## Arquivos previstos
- Nenhum arquivo de código novo — sprint de verificação/execução real contra infraestrutura, não cabe em worktree isolado (precisa de acesso SSH real aos hosts). Gera um arquivo de evidência: `docs/features/deploy-agent-server-remotos/verificacao-integracao.md`, com a saída real capturada de cada comando — criar esse arquivo faz parte desta sprint.

## Passos de implementação
1. Escolher UM host de teste (recomendado: `lebi`, por não ser o mais crítico dos três operacionalmente — decisão a confirmar com o usuário antes de rodar).
2. Rodar `--check` nesse host, registrar o estado atual (fonte, `active`).
3. Rodar `--set-ref` apontando deliberadamente para uma fonte **sintética e estável** que falha a resolver `--with` por construção — **não usar** o branch real `fix/load-public-skills-acp-context` (achado do validador das sprints: esse branch é um fix legítimo de outro componente; se um dia ganhar `pyproject.toml` ou for removido, o teste passa a não reproduzir falha nenhuma, virando um falso positivo silencioso de segurança). Usar em vez disso uma referência garantidamente inválida e sob controle do próprio teste, ex.:
   `git+https://github.com/JoaoNetoDev/OpenHands@main#subdirectory=tools/this-path-does-not-exist-agent-server-test`
   (um `subdirectory` inexistente falha a resolução do `uv` da mesma forma que o incidente real — "não é um projeto Python" —, sem depender do ciclo de vida de nenhum branch de feature de terceiros).
4. Confirmar que o health check falha e que o rollback automático dispara sozinho, sem intervenção manual.
5. Confirmar via `--check` que o host voltou exatamente à fonte de antes do passo 3, e que o serviço está `active`.
6. Rodar `--rollback` explícito no mesmo host (mesmo sem um `--set-*` na mesma execução — deve reencontrar o backup do passo 3 e restaurar de novo, sem erro).
7. Repetir o passo 2-5 com uma versão PyPI real e válida (ex. a versão atual +0, depois uma diferente se houver uma nova release disponível) para cobrir CA-03 (caminho de sucesso, não só o de falha).
8. Registrar toda a saída capturada no arquivo de evidência.

## Testes obrigatórios
- Passo 4 deve terminar em `FALHOU (revertido)` no host de teste, nunca em sucesso nem em host travado fora do ar.
- Passo 5 confirma saúde e fonte corretas pós-rollback automático.
- Passo 6 (`--rollback` explícito) termina em sucesso mesmo sendo uma invocação separada da que gerou o backup.
- Passo 7 confirma o caminho de sucesso (troca real e válida, health check passa).

## Critérios de aceitação
- [ ] CA-03: troca de versão válida, health check confirma, reportado corretamente.
- [ ] CA-04: rollback automático confirmado no host de teste com a fonte sintética inválida.
- [ ] CA-07: `--rollback` explícito confirmado.
- [ ] CA-09: rodar a mesma operação contra os 3 hosts com um deles deliberadamente inacessível (ex. usar um alias SSH errado de propósito só nesse teste) e confirmar que os outros 2 ainda são processados com sucesso.
- [ ] CA-12: confirmar que `--set-version`/`--rollback` (não só `--check`, já validado nas sprints anteriores) rodam sem erro a partir do Git Bash Windows.

## Comandos de verificação
```bash
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/agent-server-remotes.sh --check lebi"
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/agent-server-remotes.sh --set-ref 'git+https://github.com/JoaoNetoDev/OpenHands@main#subdirectory=tools/this-path-does-not-exist-agent-server-test' lebi"
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/agent-server-remotes.sh --check lebi"
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/agent-server-remotes.sh --rollback lebi"
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/agent-server-remotes.sh --set-version openhands-agent-server==1.47.0 aqdata lebi f5"
```

**Aviso**: esta sprint executa contra hosts de produção reais (não há staging). O passo 3 é desenhado para falhar de propósito — é exatamente isso que está sendo testado — mas exige que o operador acompanhe a execução e não a rode desacompanhada.

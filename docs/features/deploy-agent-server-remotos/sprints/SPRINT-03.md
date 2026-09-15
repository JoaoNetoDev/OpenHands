# SPRINT-03 — Caminho de escrita: backup, update, health check, rollback

## Objetivo
Completar o script principal com as ações que alteram estado real — troca de `--from`, backup, restart, health check, rollback automático e explícito — sobre a base de leitura já validada na SPRINT-02.

## Depende de
SPRINT-02 (reutiliza `exec_on`, `get_execstart_line`, `extract_from_value`, `build_new_execstart_line`, `process_check`, `main` já existentes — esta sprint estende o mesmo arquivo, não recria)

## Onda
3

## Arquivos previstos
- `tools/agent-server-remotes.sh` — alterar (completar) — adiciona `backup_unit`, `write_execstart` (script Python remoto via heredoc+base64, SPEC §2.4), `reload_and_restart`, `health_check`, `latest_backup`, `rollback_host`, `process_update`, `process_rollback`; estende `parse_args`/`main` para aceitar `--set-version`, `--set-ref`, `--rollback`
- `tools/agent-server-remotes.test.sh` — alterar (se necessário) — cobrir qualquer nova função pura introduzida nesta sprint que não dependa de SSH real

## Passos de implementação
1. Implementar `backup_unit` e `write_execstart` (o valor de `--from` nunca passa por `argv` em nenhuma camada — só stdin/heredoc em base64, SPEC §2.4).
2. Implementar `reload_and_restart` e `health_check` (poll em `/health`, timeout configurável).
3. Implementar `latest_backup` e `rollback_host`.
4. Implementar `process_update` (com o caminho de idempotência: comparar fonte atual vs. alvo antes de agir — RNF-04) e `process_rollback`.
5. Estender `main`/`parse_args` para as novas flags.
6. Testar `--set-version` com a MESMA versão já ativa num host de teste (idempotência, sem restart) antes de qualquer teste que efetivamente reinicie o serviço.

## Testes obrigatórios
- `tools/agent-server-remotes.sh --set-version openhands-agent-server==1.47.0 aqdata` (mesma versão já ativa) não reinicia nada — cobre CA-02.
- `tools/agent-server-remotes.sh --dry-run --set-version openhands-agent-server==1.47.1 aqdata` não altera o `ExecStart` real — cobre CA-06.
- `shellcheck tools/agent-server-remotes.sh` sem erros novos.
- Testes que efetivamente escrevem/reiniciam um host (CA-03, CA-04, CA-07, CA-09) ficam para SPRINT-04 — esta sprint só precisa provar que o caminho de idempotência e o `--dry-run` funcionam sem efeito colateral, para poder aprovar a sprint sem já ter testado o caminho de risco.

## Critérios de aceitação
- [ ] CA-02, CA-06, CA-11 (completo, incluindo a linha de resumo de update) passam.
- [ ] CA-03, CA-04, CA-07, CA-09, CA-12 (completo) ficam para SPRINT-04 (exigem mudança real de versão/ref contra host de teste e cenário de falha deliberada).

## Comandos de verificação
```bash
ssh zadotec-lura-prod "cd /opt/openhands && shellcheck tools/agent-server-remotes.sh"
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/agent-server-remotes.sh --set-version openhands-agent-server==1.47.0 aqdata"
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/agent-server-remotes.sh --dry-run --set-version openhands-agent-server==1.47.1 aqdata"
```

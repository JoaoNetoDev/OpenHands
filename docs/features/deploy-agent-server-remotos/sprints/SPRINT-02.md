# SPRINT-02 — Caminho de leitura: parsing, hosts, inspeção do `ExecStart`

## Objetivo
Implementar tudo que é somente-leitura no script principal — parsing de flags, carregamento de hosts, transporte, extração/reconstrução de string — e provar que `--check` funciona contra os 3 hosts reais sem nenhum risco de escrita.

## Depende de
SPRINT-01 (precisa de `tools/lib/remote-exec-https.sh` para `--channel https` e de `tools/agent-hosts.tsv` como lista de hosts)

## Onda
2

## Arquivos previstos
- `tools/agent-server-remotes.sh` — criar (parcial: só o caminho de leitura) — `parse_args`, `load_ssh_hosts`, `load_https_hosts`, `ssh_exec`, `exec_on`, `get_execstart_line`, `extract_from_value`, `build_new_execstart_line`, `process_check`, um `main` mínimo que só suporta `--check`/`--dry-run` nesta sprint (SPRINT-03 completa `main` com as ações de escrita)
- `tools/agent-server-remotes.test.sh` — criar — teste unitário de `extract_from_value` e `build_new_execstart_line`, sem SSH, cobrindo CA-10 e a limitação de espaçamento (SPEC §2.3)

## Passos de implementação
1. Implementar `extract_from_value` e `build_new_execstart_line` primeiro; escrever `agent-server-remotes.test.sh` contra elas usando as 3 linhas `ExecStart=` reais (capturadas via SSH nos 3 hosts) como fixtures, mais o caso sintético `git+https://github.com/org/repo@ref#subdirectory=agent-server` (CA-10).
2. Implementar `load_ssh_hosts`/`load_https_hosts`/`ssh_exec`/`exec_on`.
3. Implementar `get_execstart_line`.
4. Implementar `process_check` e um `main` que só aceita `--check [host...]` e `--dry-run` nesta sprint — qualquer outra flag (`--set-version`, `--set-ref`, `--rollback`) deve sair com erro claro "não implementado nesta sprint", para não dar a falsa impressão de que o script já cobre escrita.
5. Testar `--check` contra os 3 hosts reais.

## Testes obrigatórios
- `tools/agent-server-remotes.test.sh` passa localmente (sem rede) — cobre CA-10.
- `tools/agent-server-remotes.sh --check aqdata lebi f5` roda contra os 3 hosts reais e reporta a fonte/estado atual corretamente (comparar manualmente com `systemctl cat` em cada host) — cobre CA-01, CA-05, CA-11 (parcial, só leitura).
- `tools/agent-server-remotes.sh --check aqdata` (`--dry-run` combinado, se aplicável) não altera nada nos hosts.
- `shellcheck tools/agent-server-remotes.sh tools/agent-server-remotes.test.sh` (instalar `shellcheck` no host antes, se ainda não estiver — pendência do TECH §8.1, mesma instalação já feita ou a fazer na SPRINT-01).

## Critérios de aceitação
- [ ] CA-01, CA-05, CA-08, CA-10 (SPEC §7) passam.
- [ ] CA-02, CA-03, CA-04, CA-06, CA-07, CA-09, CA-11 (completo), CA-12 (completo) ficam para SPRINT-03/SPRINT-04.

## Comandos de verificação
```bash
bash tools/agent-server-remotes.test.sh
ssh zadotec-lura-prod "cd /opt/openhands && shellcheck tools/agent-server-remotes.sh tools/agent-server-remotes.test.sh"
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/agent-server-remotes.sh --check aqdata lebi f5"
```

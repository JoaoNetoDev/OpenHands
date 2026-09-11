# Verificação de integração real — SPRINT-04

Executado a partir da máquina de trabalho local (Git Bash/Windows), via SSH
direto aos 3 hosts (`sistema.aqdata.com.br:22022`, `lebi`, `f5-dev`) —
canal SSH primário, exatamente como o RF-06 prevê. O canal SSH não é
alcançável a partir do host central `zadotec-lura-prod` (confirmado nas
SPRINT-02/03), então esta verificação não podia ser feita de lá.

Achado adicional durante esta sprint: a flag `--hosts-file`, prevista no
contrato da SPEC §4, não tinha sido implementada em nenhuma sprint
anterior. Corrigida diretamente aqui (adição de 1 linha em `parse_args`),
verificada com `shellcheck` e o teste unitário (sem regressão), e usada
para o teste de CA-09 abaixo.

## CA-01 / estado inicial
```
$ ./tools/agent-server-remotes.sh --check lebi
[lebi] from=openhands-agent-server==1.47.0 estado=active
```

## CA-04 — rollback automático em falha de health check
```
$ ./tools/agent-server-remotes.sh --set-ref 'git+https://github.com/JoaoNetoDev/OpenHands@main#subdirectory=tools/this-path-does-not-exist-agent-server-test' lebi
[lebi] backup criado: /etc/systemd/system/openhands-agent-server.service.bak.1789154092
[lebi] health check falhou, revertendo
[lebi] revertendo para backup: /etc/systemd/system/openhands-agent-server.service.bak.1789154092
[lebi] rollback concluído, serviço saudável (backup: ...bak.1789154092)
[lebi] openhands-agent-server==1.47.0 -> git+.../this-path-does-not-exist-agent-server-test, FALHOU (revertido)
EXIT_CODE=1
```
Confirmado pós-rollback: `--check lebi` → `from=openhands-agent-server==1.47.0 estado=active`;
`systemctl cat` real bate com o ExecStart original.

## CA-07 — `--rollback` explícito
```
$ ./tools/agent-server-remotes.sh --rollback lebi
[lebi] revertendo para backup: /etc/systemd/system/openhands-agent-server.service.bak.1789154092
[lebi] rollback concluído, serviço saudável (backup: ...bak.1789154092)
EXIT=0
```

## CA-09 — host inacessível não impede os demais
```
$ ./tools/agent-server-remotes.sh --hosts-file agent-hosts-broken.tsv --check aqdata lebi f5
[aqdata] ssh: Could not resolve hostname host-que-nao-existe.invalid
[aqdata] não foi possível ler o unit openhands-agent-server.service
[lebi] from=openhands-agent-server==1.47.0 estado=active
[f5]   from=openhands-agent-server==1.47.0 estado=active
EXIT=1
```
`aqdata` (alvo SSH deliberadamente quebrado) falhou; `lebi` e `f5` foram
processados e reportados com sucesso na mesma execução.

## CA-03 — troca real bem-sucedida (versão válida diferente)
Não havia versão mais nova que `1.47.0` disponível no PyPI no momento do
teste (confirmado via API do PyPI) — usada a versão anterior (`1.46.0`)
como "versão válida diferente", depois revertida para `1.47.0`:
```
$ ./tools/agent-server-remotes.sh --set-version openhands-agent-server==1.46.0 lebi
[lebi] backup criado: .../bak.1789154367
[lebi] openhands-agent-server==1.47.0 -> openhands-agent-server==1.46.0, saudável
EXIT=0

$ ./tools/agent-server-remotes.sh --set-version openhands-agent-server==1.47.0 lebi
[lebi] backup criado: .../bak.1789154393
[lebi] openhands-agent-server==1.46.0 -> openhands-agent-server==1.47.0, saudável
EXIT=0
```

## CA-12 — Git Bash / Windows
Toda esta verificação (incluindo `--set-version`/`--rollback`, não só
`--check`) rodou a partir do ambiente de trabalho real (Git Bash/Windows)
usado nesta sessão, sem nenhum erro relacionado ao ambiente.

## Estado final confirmado dos 3 hosts
```
$ ./tools/agent-server-remotes.sh --check aqdata lebi f5
[aqdata] from=openhands-agent-server==1.47.0 estado=active
[lebi]   from=openhands-agent-server==1.47.0 estado=active
[f5]     from=openhands-agent-server==1.47.0 estado=active
```
Todos os 3 hosts terminaram exatamente no estado em que começaram.

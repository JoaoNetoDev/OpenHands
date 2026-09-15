# SPRINT-01 — Extrair transporte HTTPS + lista canônica de hosts

## Objetivo
Extrair `remote_exec()` de `deploy-remotes.sh` para uma lib compartilhada e criar a lista canônica de hosts, sem alterar nenhum comportamento externo hoje observável.

## Depende de
nenhuma

## Onda
1

## Arquivos previstos
- `tools/lib/remote-exec-https.sh` — criar — função `remote_exec_https()`, corpo idêntico ao `remote_exec()` atual (SPEC §2.2)
- `tools/deploy-remotes.sh` — alterar — remove as linhas 97-131 (função `remote_exec()` inline; a linha 133, cabeçalho `# --- scripts remotos`, fica intacta), adiciona `source "$(dirname "$0")/lib/remote-exec-https.sh"` logo após o bloco de comentários iniciais, troca as chamadas internas de `remote_exec` por `remote_exec_https`
- `tools/agent-hosts.tsv` — criar — conteúdo exato (SPEC §2.1): `aqdata|sistema.aqdata.com.br`, `lebi|lebi`, `f5|f5-dev`, com comentário de formato no topo

## Passos de implementação
1. Ler `tools/deploy-remotes.sh` linhas 90-133 no host `zadotec-lura-prod` para confirmar o texto exato antes de extrair (a numeração pode ter mudado desde a validação da SPEC — reconferir com `nl -ba` antes de editar).
2. Criar `tools/lib/remote-exec-https.sh` com a função extraída, mesma assinatura `remote_exec_https <name> <url> <key> <script> [timeout]`.
3. Editar `tools/deploy-remotes.sh`: remover o bloco original, adicionar o `source`, renomear as chamadas.
4. Criar `tools/agent-hosts.tsv`.

## Testes obrigatórios
- `tools/deploy-remotes.sh --check` continua funcionando exatamente como antes da mudança (mesma saída, mesmo canal HTTPS) — rodar contra pelo menos um host real (`aqdata`) e comparar com o comportamento pré-mudança.
- `tools/deploy-remotes.sh --dry-run` continua funcionando (garante que o `source` não quebrou o parsing de flags).
- `shellcheck tools/deploy-remotes.sh tools/lib/remote-exec-https.sh` sem erros novos em relação ao estado anterior do arquivo (instalar `shellcheck` no host antes, se ainda não estiver — pendência já sinalizada no TECH §8.1).

## Critérios de aceitação
- [ ] `tools/lib/remote-exec-https.sh` existe e exporta `remote_exec_https()` com a assinatura da SPEC §2.2.
- [ ] `tools/deploy-remotes.sh` não contém mais a função `remote_exec()` inline, mas se comporta identicamente (CA implícito de não-regressão — sem CA numerado na SPEC porque este arquivo não é o alvo funcional do PRD, é infraestrutura de suporte).
- [ ] `tools/agent-hosts.tsv` existe com as 3 linhas exatas da SPEC §2.1.

## Comandos de verificação
```bash
ssh zadotec-lura-prod "cd /opt/openhands && shellcheck tools/deploy-remotes.sh tools/lib/remote-exec-https.sh"
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/deploy-remotes.sh --check aqdata"
ssh zadotec-lura-prod "cd /opt/openhands && ./tools/deploy-remotes.sh --dry-run aqdata"
ssh zadotec-lura-prod "cat /opt/openhands/tools/agent-hosts.tsv"
```

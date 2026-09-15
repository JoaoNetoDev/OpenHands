# PLANO — Swap atômico do diretório de assets no pós-build

SPEC de origem: [../SPEC.md](../SPEC.md)

## Ondas × Sprints

| Onda | Sprint     | Título                                                        | Depende de |
|------|------------|----------------------------------------------------------------|------------|
| 1    | SPRINT-01  | Swap atômico do diretório de assets no pós-build               | nenhuma    |

Escopo pequeno o suficiente (um arquivo alterado + um arquivo de teste novo) para caber em uma
única sprint, sem necessidade de particionamento adicional.

## Tabela de cobertura

| Item da SPEC                                                                 | Sprint     |
|-------------------------------------------------------------------------------|------------|
| Reescrever `moveBuildEntry` com swap atômico (rename-backup → rename → rm)     | SPRINT-01  |
| Fallback `EPERM`/`EXDEV` via temporário irmão + rename final                   | SPRINT-01  |
| Exportar `moveBuildEntry` como named export                                    | SPRINT-01  |
| `react-router.config.test.ts` — caso 1 (destino inexistente)                   | SPRINT-01  |
| `react-router.config.test.ts` — caso 2 (destino existente, caminho feliz)      | SPRINT-01  |
| `react-router.config.test.ts` — caso 3 (fallback EXDEV)                        | SPRINT-01  |
| `react-router.config.test.ts` — caso 4 (limpeza do backup / propagação de erro)| SPRINT-01  |
| Critérios de aceitação CA-01 a CA-04                                           | SPRINT-01  |

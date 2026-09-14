# PRD — kanban-card-contexto-arquivos

## 1. Problema e evidência

O board do sub-projeto `kanban-3-niveis` (`KanbanTask` em `src/types/kanban.ts`) só guarda título/descrição — não há onde registrar contexto (instruções do usuário, notas do agente) nem anexar arquivos a uma tarefa, e nada gera um artefato persistente fora do `localStorage` do navegador. Isso limita o board a um quadro de notas efêmero: se o usuário limpar o `localStorage` ou trocar de navegador, todo o raciocínio por trás de cada tarefa se perde, e nada do que foi decidido num card é visível fora do Canvas (ex.: por um agente rodando via terminal, ou por outra pessoa lendo o repositório).

Investigação de como o app hoje escreve no workspace (`src/api/runtime-service/agent-server-runtime-service.ts:24-66`, `src/hooks/query/use-workspace-files.ts:57,60`) confirma: a única forma de tocar o sistema de arquivos de um workspace a partir do frontend é via `/api/bash/execute_bash_command` contra o agent-server **local** — não há endpoint de "escrever arquivo" dedicado, e esse caminho é **local only**: no backend Cloud, o runtime só é alcançável dentro de uma conversa já provisionada (`src/api/conversation-file-upload.api.ts:20-24,68-70`), não a partir de um "workspace" solto.

## 2. Usuários e cenários de uso

- Usuário abre um card do board e escreve um "contexto do usuário": instruções livres sobre o que aquele card precisa (ex.: "seguir o padrão X, evitar Y").
- Usuário (ou, futuramente, um agente — sub-projeto 4) escreve um "contexto do agente" no mesmo card: notas de execução, decisões tomadas.
- Usuário anexa um arquivo local ao card (ex.: um print de erro, um trecho de log).
- Usuário aciona "Sinterizar" no card: o Canvas grava um arquivo `.md` no workspace resumindo título, descrição, os dois contextos e a lista de anexos — arquivo que passa a existir no repositório, versionável pelo Git do próprio usuário.

## 3. Objetivos e não-objetivos

**Objetivos**
- Cada card (qualquer um dos 3 níveis do sub-projeto `kanban-3-niveis`) ganha dois campos de contexto (usuário, agente) e uma lista de anexos.
- Ação "Sinterizar" grava um `.md` determinístico por card dentro do workspace ativo.
- Funciona só quando o Canvas está rodando contra o **backend local** (ver Riscos) — é a única forma verificada de escrever no workspace sem uma conversa já em andamento.

**Não-objetivos**
- Não funciona no backend Cloud nesta versão — sem uma conversa provisionada não há runtime alcançável para escrever o arquivo; a ação "Sinterizar" fica desabilitada com uma explicação quando o backend ativo é Cloud.
- Não implementa nenhuma interação de agente autônomo com os cards (isso é o sub-projeto `kanban-pipeline-featdevelop`) — "contexto do agente" aqui é só mais um campo de texto editável por um humano nesta fase, preparando o terreno para o próximo sub-projeto escrever nele automaticamente.
- Não sincroniza anexos como parte do Git (o usuário decide se commita o `.md` gerado e os anexos copiados — a feature só escreve os arquivos, não roda `git add`/`git commit`).
- Não oferece preview/edição do `.md` gerado dentro do Canvas — a fonte de verdade dos campos continua sendo o card (`localStorage`, sub-projeto 2); o `.md` é uma saída, não um documento editável de volta.
- Não faz upload/streaming de arquivos grandes — anexos são limitados por um teto de tamanho (definido na fase TECH) apropriado para texto/prints, não para binários grandes.

## 4. Requisitos funcionais

- **RF-01**: Um card (qualquer nível) tem dois campos de texto rico adicionais: "Contexto do usuário" e "Contexto do agente", editáveis independentemente, reaproveitando o mesmo componente de rich-text do sub-projeto `sistema-settings-menu`.
- **RF-02**: Um card permite anexar um ou mais arquivos locais (seletor de arquivo do navegador); cada anexo guarda nome, tamanho e conteúdo (texto ou binário) até ser sinterizado.
- **RF-03**: Um card oferece a ação "Sinterizar", habilitada só quando o backend ativo é local **e** há um workspace resolvido para o card.
- **RF-04**: Sinterizar grava um arquivo Markdown em `<workspace>/.openhands/kanban/<taskId>.md` contendo: título, nível, coluna atual, descrição, contexto do usuário, contexto do agente, e uma lista dos anexos (nome + caminho onde cada um foi copiado).
- **RF-05**: Sinterizar copia cada anexo para `<workspace>/.openhands/kanban/<taskId>/attachments/<nome-seguro>` antes de referenciá-lo no `.md`.
- **RF-06**: Sinterizar é idempotente — repetir a ação sobrescreve o `.md` e os anexos anteriores do mesmo card, não acumula lixo.
- **RF-07**: Falha ao sinterizar (comando de escrita retorna código de saída ≠ 0) mostra erro específico ao usuário e não marca o card como sinterizado.
- **RF-08**: Card sinterizado com sucesso mostra um indicador visual (ex.: ícone + timestamp da última sinterização).

## 5. Requisitos não-funcionais

- **RNF-01 (segurança)**: nenhum campo de texto do usuário (título, descrição, contexto) é interpolado diretamente numa string de shell — todo conteúdo escrito no workspace passa por um mecanismo que não permite injeção de comando via aspas/backticks/`$()`.
- **RNF-02 (limite de tamanho)**: anexos individuais até um teto definido na fase TECH (proteção contra travar o `execute_bash_command`, que tem timeout); acima do teto, o anexo é recusado com mensagem clara antes de tentar enviar.
- **RNF-03 (i18n)**: chaves novas seguem a convenção do projeto.
- **RNF-04 (clareza de escopo)**: a UI deixa explícito, antes de tentar sinterizar em backend Cloud, por que a ação está desabilitada (não é um botão cinza sem explicação).

## 6. Métricas de sucesso

- Sinterizar um card com contexto e 2 anexos produz um `.md` e 2 arquivos de anexo no workspace, verificável por teste de integração contra um agent-server local mockado.
- Reexecutar a sinterização do mesmo card não duplica arquivos (RF-06) — teste dedicado.
- Zero caso de injeção de comando bem-sucedida contra um payload adversarial de teste (aspas, backticks, `$(...)`, `;`).

## 7. Escopo de release e faseamento

Release único. Depende de `kanban-3-niveis` (estende `KanbanTask`) e de `sistema-settings-menu` (reaproveita `RichTextInput`).

## 8. Riscos de produto e questões em aberto

- **Risco confirmado por leitura de código**: a escrita no workspace só é viável hoje contra o agent-server **local** (`agent-server-runtime-service.ts:24-66` aceita `conversationUrl`/`sessionApiKey` nulos e cai no caminho `RemoteWorkspace` local; o caminho Cloud em `callCloudProxy` exige uma `conversationUrl` de uma conversa já provisionada, que um card do board não tem). Sinterizar em Cloud fica fora de escopo até existir uma forma de resolver runtime sem conversa lá.
- **Risco de segurança**: qualquer escrita de conteúdo arbitrário via `execute_bash_command` (uma string de shell) é uma superfície de injeção de comando se o conteúdo do usuário for interpolado sem cuidado — tratado como requisito de primeira classe (RNF-01), não como detalhe de implementação, e a técnica exata (base64) é especificada na fase TECH exatamente por isso.
- **Questão em aberto (assumida)**: o caminho fixo `.openhands/kanban/<taskId>.md` foi escolhido para não colidir com arquivos do usuário e para ficar visualmente agrupado; revisável se o sub-projeto 4 precisar de uma convenção de nome diferente (ex.: por fase do pipeline).

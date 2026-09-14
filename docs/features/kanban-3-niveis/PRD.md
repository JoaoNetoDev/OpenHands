# PRD — kanban-3-niveis

## 1. Problema e evidência

O Agent Canvas não tem hoje nenhuma superfície de planejamento visual de tarefas: `grep` por "kanban"/"board"/"dnd"/"drag" em `src/` não retorna nenhuma implementação real (o único hit é o ícone decorativo `SquareKanban` em `src/components/features/conversation-panel/conversation-card/conversation-tag-icons.ts:24,94,133`, usado como tag de conversa "linear"/"projeto", sem relação com um board). Sem um board, o sub-projeto `sistema-settings-menu` (workspace/perfil/contexto padrão) não tem consumidor, e os sub-projetos seguintes desta decomposição (contexto por card com arquivos, integração com o pipeline `featdevelop`) não têm onde existir.

## 2. Usuários e cenários de uso

- Usuário abre o board (novo menu/rota) dentro de um workspace, cria uma tarefa de alto nível ("Nível 1"), divide-a em subtarefas ("Nível 2"), e uma das subtarefas em sub-subtarefas ("Nível 3").
- Usuário arrasta um card entre colunas de status (ex.: "A Fazer" → "Em Andamento" → "Concluído") em qualquer nível da hierarquia.
- Usuário abre um card de Nível 1 e vê, dentro dele, a lista de seus subcards de Nível 2 com progresso agregado (quantos concluídos).
- Usuário exclui uma tarefa de Nível 1 e confirma explicitamente que isso também remove suas subtarefas e sub-subtarefas.

## 3. Objetivos e não-objetivos

**Objetivos**
- CRUD completo de tarefas em até 3 níveis de profundidade (tarefa → subtarefa → sub-subtarefa).
- Drag-and-drop de cards entre colunas de status, em qualquer nível.
- Persistência local por workspace, sobrevivendo a reload.
- Board acessível a partir de uma nova entrada de navegação (fora do menu de settings — é uma área de trabalho, não uma configuração).

**Não-objetivos**
- Não implementa contexto de usuário/agente por card, anexos de arquivo, nem sinterização em `.md` (sub-projeto `kanban-card-contexto-arquivos`).
- Não mapeia colunas às fases do pipeline `featdevelop` nem permite interação de agente com cards (sub-projeto `kanban-pipeline-featdevelop`) — as colunas desta fase são um conjunto fixo e genérico ("A Fazer", "Em Andamento", "Concluído"), não específico de nenhum pipeline.
- Não sincroniza o board entre máquinas/dispositivos (mesma decisão de escopo do sub-projeto 1 — persistência local ao navegador).
- Não permite mover uma tarefa de um nível para outro (ex.: promover uma subtarefa a tarefa de nível 1) — reestruturação de hierarquia fica fora de escopo; a única forma de "mudar de nível" é apagar e recriar.
- Não implementa busca, filtro ou ordenação além da ordem manual dentro de cada coluna.

## 4. Requisitos funcionais

- **RF-01**: Uma nova entrada de navegação (fora de settings) abre o board do workspace ativo.
- **RF-02**: O board tem colunas de status fixas: "A Fazer", "Em Andamento", "Concluído".
- **RF-03**: Usuário cria uma tarefa de Nível 1 informando título (obrigatório) e descrição (opcional); ela nasce na coluna "A Fazer".
- **RF-04**: Dentro de uma tarefa de Nível 1, usuário cria subtarefas de Nível 2 (mesmos campos); dentro de uma subtarefa de Nível 2, cria sub-subtarefas de Nível 3. Uma tarefa de Nível 3 não pode ter filhos.
- **RF-05**: Usuário edita título/descrição de qualquer card em qualquer nível.
- **RF-06**: Usuário exclui um card; se ele tiver filhos, a exclusão pede confirmação explícita informando quantos descendentes serão removidos junto.
- **RF-07**: Usuário arrasta um card entre as 3 colunas de status; a nova coluna persiste.
- **RF-08**: Um card de Nível 1 ou 2 exibe uma contagem "X de Y subtarefas concluídas" quando tem filhos.
- **RF-09**: O estado do board persiste por workspace (dois workspaces diferentes têm boards independentes) e sobrevive a reload da aplicação.
- **RF-10**: Board vazio (nenhuma tarefa de Nível 1 ainda) mostra um estado vazio com call-to-action para criar a primeira tarefa.

## 5. Requisitos não-funcionais

- **RNF-01 (performance)**: drag-and-drop deve responder sem lag perceptível até pelo menos 200 cards no total (soma dos 3 níveis) — validado por teste manual, não automatizado.
- **RNF-02 (acessibilidade)**: reordenar/mudar de coluna deve ser possível também por teclado (não só arrastar com mouse), seguindo o padrão de anúncio de `aria-live` da biblioteca de drag-and-drop escolhida.
- **RNF-03 (i18n)**: todos os textos novos seguem a convenção de chaves já usada no projeto.
- **RNF-04 (observabilidade)**: nenhuma chamada de rede nesta feature; falhas de persistência local seguem o mesmo tratamento de erro do sub-projeto 1 (toast, sem perda do estado em memória).

## 6. Métricas de sucesso

- Criar, editar, mover e excluir um card nos 3 níveis funciona sem erro em teste de integração.
- Board com 2 workspaces diferentes mantém dados independentes (teste de integração dedicado).
- Zero regressão nas telas/rotas existentes.

## 7. Escopo de release e faseamento

Release único. Depende do sub-projeto `sistema-settings-menu` apenas para saber qual é o workspace "ativo" ao abrir o board (via `useSystemSettings()`), não para nenhuma outra funcionalidade — se `defaultWorkspaceId` não estiver definido, o board usa o workspace atualmente selecionado na sessão (mecanismo já existente, fora desta feature).

## 8. Riscos de produto e questões em aberto

- **Nova dependência**: não existe biblioteca de drag-and-drop no projeto hoje (`grep` em `package.json` confirmado sem hit) — esta feature introduz uma, decisão e escolha tratadas na fase TECH.
- **Risco de escopo de hierarquia**: "3 níveis" é tratado como profundidade fixa (não configurável) nesta versão — um card de Nível 3 simplesmente não oferece a ação "adicionar subtarefa". Se o usuário precisar de mais profundidade depois, é uma revisão de escopo futura, não desta feature.
- **Questão em aberto (assumida)**: "coluna de status" (RF-02) é fixa e genérica nesta fase porque o mapeamento ao pipeline `featdevelop` (PRD → TECH → SPEC → SPRINTS) é escopo do sub-projeto 4; entregar aqui um conjunto fixo evita retrabalho de UI quando o sub-projeto 4 trocar os rótulos/semântica das colunas. Isso não significa que a coluna seja um campo de texto livre sem validação (é um union type fechado, `KanbanColumnId`, ver TECH) — significa que estender esse union para um segundo preset de colunas não exige migrar dados de cards já existentes (campo ausente/antigo continua válido), só um ajuste de tipo no sub-projeto 4.

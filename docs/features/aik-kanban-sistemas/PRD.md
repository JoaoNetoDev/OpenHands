# PRD — AIK: front de sistemas em kanban hierárquico

Slug: `aik-kanban-sistemas`
Host de destino: `aik.zadotec.com.br` (→ `193.202.85.74`, esta máquina)
Status: fase 1 de `/featdevelop` — aguardando aprovação

---

## 1. Problema e evidência

O kanban atual do Agent Canvas promete hierarquia e execução por agente, mas
entrega uma camada só, navegação por modais empilhados e um botão de executar
que quase nunca está habilitado. Quem usa não consegue fazer a coisa mais
básica que o produto sugere: olhar um sistema, ver o trabalho dele em níveis,
mandar o agente executar e conversar sobre o resultado.

Evidência no código (lida, não presumida):

| Sintoma | Evidência |
|---|---|
| A tela de quadros é uma **lista**, não um kanban — "sistema" não tem baia | `src/routes/board-list.tsx:238`–`291` renderiza `<ul>` de `<li>` |
| O quadro mostra **só o nível 1** | `src/routes/kanban-board.tsx:80`: `allTasks.filter((task) => task.parentId === null)` |
| Níveis 2 e 3 existem no dado mas só aparecem como **modal dentro de modal** | `src/types/kanban.ts:45` (`level: 1 \| 2 \| 3`) vs. `src/components/features/kanban/kanban-task-drawer.tsx:272`–`279` (drawer recursivo dentro de `ModalBackdrop`) |
| "Rodar com agente" fica desabilitado na maioria dos cards | `src/components/features/kanban/run-agent-button.tsx:43`: `!task.featureSlug \|\| !workspacePath \|\| !trueWorkspaceId` |
| Executar só existe em card de nível 1 | `src/components/features/kanban/kanban-task-drawer.tsx:184`: `{task.level === 1 && …}` |
| **Não existe conversa dentro do kanban** — só um link que joga o usuário pra fora | `run-agent-button.tsx:76`–`84` (`NavigationLink to={/conversations/…}`); nenhum componente de `src/components/features/kanban/` importa chat |
| Executar sempre significa "rodar `/featdevelop`" | `src/api/kanban-pipeline.api.ts:20`–`24`: a mensagem inicial é fixa na skill `/featdevelop` |
| A configuração do card não se explica | o campo de slug (`FeatureSlugInput`) e o link "Abrir conversa" aparecem sem rótulo de contexto — `kanban-task-drawer.tsx:186`–`192` |

Evidência do usuário, registrada no próprio quadro
(`.openhands/kanban/opt/openhands/board.json`, checklist do quadro "Revisar
Kanban"): *"Não possui árvore de kanban, apenas 1 camada"*; *"não entendo o que
é link e o que é B na configuração"*; *"A ideia era sistema -> tarefa ->
sub-tarefa, todos em baias hierárquicas de kanban. Está separado e confuso,
acho que precisa reformular por completo"*.

### Referência conceitual

O modelo alvo é o do MadBuilder (MCP `madbuilder`, tool `kanban_task`,
`https://api.madbuilder.dev/api/mcp-gateway`), consultado em 2026-09-15:

- a conversa/sessão do agente pertence ao **sistema** (projeto), não ao card;
- o roadmap é uma árvore **fase → tarefa**, onde *"Fase (card com filhas) NÃO
  executa: é container. Puxe sempre uma filha; o épico fecha sozinho quando as
  filhas fecham"*;
- colunas fixas `backlog | in_progress | in_review | done`, com `in_review`
  como gate humano;
- cada card declara `executor_type: human | agent` e um `agent_briefing`;
- ações de ciclo de vida por card: `start_agent`, `stop_agent`,
  `reopen {feedback}` (devolve de `in_review` pro agente), `comment` (timeline),
  `changes` (o que o último run mudou).

O AIK adota esse modelo e o funde com o conceito de workspace/backend do
OpenHands: **um sistema é um workspace**, local ou remoto, exatamente como o
Agent Canvas já resolve hoje (`src/api/backend-registry/types.ts:1`,
`BackendKind = "local" | "cloud"`; `src/types/workspace.ts:1`,
`LocalWorkspace`).

---

## 2. Usuários e cenários de uso

**Usuário primário — o operador-dono.** Uma pessoa só, que é dona dos sistemas,
planeja o trabalho e delega execução a agentes. Trabalha em vários sistemas ao
mesmo tempo, com ADHD: precisa de uma tela que responda "onde eu estava?" sem
navegação em profundidade.

Cenários:

1. **Retomar o dia.** Abre `aik.zadotec.com.br` e vê a baia de sistemas: cada
   sistema mostra quantas tarefas estão rodando, quantas esperam revisão e se
   o backend dele está de pé. Entra no que tem coisa esperando ele.
2. **Planejar um sistema.** Dentro do sistema, conversa com o agente no painel
   lateral ("quero autenticação por e-mail"), e o agente devolve um roadmap de
   fases e tarefas que aparecem no quadro. O humano corta, renomeia, reordena.
3. **Mandar executar.** Puxa uma tarefa, confere o briefing, clica em Executar.
   A tarefa vai pra `in_progress` com indicador de run vivo. Ele sai da tela e
   volta depois.
4. **Revisar.** A tarefa chegou em `in_review`. Ele lê o que o run mudou,
   aprova (→ `done`) ou devolve com feedback (→ volta pro agente).
5. **Conversar sobre o sistema.** Pergunta ao agente do sistema, no painel de
   conversa, o estado geral — sem precisar abrir card nenhum.

**Usuário secundário — o agente.** Consome e edita o mesmo quadro por arquivo
(o contrato `board.json` que já existe hoje em
`src/api/kanban-board-file.api.ts:106`), para que um run possa criar tarefas,
mover colunas e pedir revisão sem passar pela UI.

---

## 3. Objetivos e não-objetivos

### Objetivos

- **O1.** Uma superfície nova, independente do front atual, onde o sistema é a
  unidade de primeira classe e tudo é kanban — inclusive a lista de sistemas.
- **O2.** Hierarquia navegável sem modal empilhado: sistema → fase → tarefa,
  com breadcrumb e URL própria por nível.
- **O3.** Executar e conversar disponíveis sem pré-condição *escondida*:
  qualquer tarefa é executável assim que tiver briefing e um backend de pé —
  ressalvado o limite explícito de N1 (um run de agente por vez por sistema),
  que é visível na UI como card desabilitado com motivo, não como ausência
  silenciosa do botão.
- **O4.** Ciclo de revisão humana explícito: `in_review` é parada obrigatória,
  com aprovar e devolver-com-feedback.
- **O5.** Aproveitar o runtime de conversa existente do Agent Canvas em vez de
  reescrevê-lo.

### Não-objetivos (v1)

- **N1.** Fila de runs com posição e custo por tarefa (o `active` do
  MadBuilder). V1 roda um agente por vez por sistema, sem fila.
- **N2.** Quarto nível de baia (sub-sub-tarefa). O detalhe fino fica em
  checklist dentro do card — estrutura que já existe
  (`src/types/kanban.ts:22`, `KanbanChecklistItem`).
- **N3.** Substituir ou remover o front atual em `openhands.zadotec.com.br`.
  Os dois convivem; o AIK é outro host.
- **N4.** Multiusuário, papéis e permissões.
- **N5.** Migração automática dos quadros v2 existentes para o modelo AIK.
- **N6.** App desktop/Electron do AIK.

---

## 4. Requisitos funcionais

### Sistemas (nível 0)

- **RF-01.** A tela raiz do AIK é um kanban de **sistemas**, com cards de
  sistema distribuídos em colunas de estado do próprio sistema.
- **RF-02.** Um sistema referencia um workspace: um backend
  (`Backend.id`, local ou remoto) mais um workspace daquele backend
  (`LocalWorkspace.id` + `path`). Criar um sistema é escolher esse par.
- **RF-03.** O card de sistema mostra, sem precisar abrir: nome, quantas
  tarefas estão em `in_progress`, quantas em `in_review`, e se o backend
  respondeu ao último health check.
- **RF-04.** Abrir um sistema navega para uma URL própria e mostra o quadro de
  fases daquele sistema.

### Hierarquia (fases e tarefas)

- **RF-05.** Dentro de um sistema, o quadro exibe **fases** como cards, nas
  colunas `backlog | in_progress | in_review | done`.
- **RF-06.** Abrir uma fase navega para uma URL própria e mostra o quadro de
  **tarefas** daquela fase — em tela, não em modal sobre modal.
- **RF-07.** Toda tela de nível exibe breadcrumb `sistema › fase › tarefa` com
  cada segmento clicável.
- **RF-08.** Uma fase é container: não tem botão de executar e não aceita
  briefing de agente. Seu progresso é derivado das tarefas filhas.
- **RF-09.** O estado da fase é derivado das filhas, nunca arrastado
  manualmente (RF-11 aplica-se apenas ao nível de tarefa dentro da fase, não
  ao card da fase em si). Regra de agregação, por prioridade decrescente:
  (a) todas as filhas em `done` → fase em `done`; (b) nenhuma filha existe
  ainda → fase em `backlog`; (c) qualquer filha em `in_review` → fase em
  `in_review`; (d) qualquer filha em `in_progress` → fase em `in_progress`;
  (e) caso contrário (mistura de `backlog`/`done` sem `in_progress` nem
  `in_review`) → fase em `backlog`.
- **RF-10.** Tarefa é a unidade executável. Campos: título, descrição,
  `executor_type` (`human | agent`), briefing do agente, prioridade
  (`p0`–`p3`), checklist e dependência (`bloqueada por` outra tarefa da mesma
  fase).
- **RF-11.** Arrastar um card entre colunas altera seu estado e persiste.
  Arrastar dentro da coluna altera a ordem.
- **RF-12.** Criar, renomear e excluir sistema, fase e tarefa. Excluir um
  container pede confirmação exibindo quantos filhos serão removidos junto.

### Execução

- **RF-13.** Toda tarefa com `executor_type = agent`, briefing preenchido e
  backend acessível oferece **Executar**, sem exigir nenhum campo de slug de
  feature. Se o sistema já tem um run de agente vivo em outra tarefa (limite de
  N1), o botão aparece desabilitado com o motivo visível ("já há uma execução
  em andamento neste sistema"), nunca simplesmente ausente.
- **RF-14.** Executar inicia uma conversa no backend do sistema, vincula o id
  dessa conversa à tarefa e move a tarefa para `in_progress`.
- **RF-15.** Uma tarefa com run vivo oferece **Parar**, que aborta o run e
  devolve a tarefa para o topo de `backlog`.
- **RF-16.** Uma tarefa com run vivo exibe indicador de atividade e o último
  evento recebido, sem o usuário precisar sair da tela.
- **RF-17.** O card mostra o que o último run alterou, na forma de lista de
  arquivos tocados na conversa vinculada.
- **RF-18.** O briefing enviado ao agente é montado a partir do card:
  título, descrição, checklist e contexto herdado da fase e do sistema.
  Nenhuma skill fica fixa no código — a skill a invocar é um campo do card,
  com padrão vazio (execução livre).

### Revisão

- **RF-19.** Quando o agente conclui, a tarefa vai para `in_review` — nunca
  direto para `done`.
- **RF-20.** Em `in_review`, o humano tem **Aprovar** (→ `done`) e
  **Devolver** com texto de feedback (→ volta para `in_progress` e o feedback
  é entregue ao agente na mesma conversa vinculada).
- **RF-21.** Toda transição de estado, comentário, execução e feedback fica
  registrado numa timeline por card, em ordem cronológica.

### Conversa

- **RF-22.** Cada sistema tem **uma conversa principal**, acessível de qualquer
  nível dentro daquele sistema por um painel lateral que não faz o usuário
  perder o quadro de vista.
- **RF-23.** A conversa principal do sistema roda no backend e workspace do
  sistema.
- **RF-24.** A partir da conversa, o agente pode criar fases e tarefas no
  quadro daquele sistema, e a UI reflete a mudança sem recarregar a página.
- **RF-25.** A conversa de uma tarefa em execução é acessível a partir do card,
  no mesmo painel, alternando o alvo entre "conversa do sistema" e "run desta
  tarefa".

### Persistência e contrato com o agente

- **RF-26.** O quadro de um sistema é persistido num arquivo dentro do próprio
  workspace, de modo que o agente possa lê-lo e alterá-lo por ferramenta de
  arquivo — mesmo princípio do `board.json` atual
  (`src/api/kanban-board-file.api.ts:106`).
- **RF-27.** Alterações feitas no arquivo pelo agente aparecem na UI enquanto o
  usuário tem o quadro aberto, sem recarregar a página.
- **RF-28.** Edição concorrente (UI e agente no mesmo arquivo) é resolvida por
  merge por card, não por sobrescrita do arquivo inteiro.

### Entrega

- **RF-29.** O AIK é buildado e servido de forma independente do front atual, em
  `aik.zadotec.com.br`, sem alterar o comportamento de
  `openhands.zadotec.com.br`.

---

## 5. Requisitos não funcionais

- **RNF-01 (performance).** Um quadro com 200 cards no nível visível (inclui
  cards fora da viewport, sem paginação) renderiza a primeira pintura em até
  1 s, medida com Chrome DevTools Performance em modo `production build`
  (`npm run build:app` + `npm run start`), nesta mesma máquina de
  desenvolvimento (specs em `docs/features/aik-kanban-sistemas/TECH.md`,
  a registrar na fase TECH). Arrastar um card responde em até 100 ms entre o
  `pointerup` e o repaint da nova posição, medido pelo mesmo método.
- **RNF-02 (performance).** Trocar de nível (sistema → fase → tarefa) não
  refaz requisição de rede para dados já carregados do mesmo sistema.
- **RNF-03 (tamanho de prompt).** O briefing enviado ao agente é montado só a
  partir do card e de seus ancestrais diretos; seu tamanho não cresce com o
  número de tarefas do quadro.
- **RNF-04 (segurança).** Nenhuma chave de API de backend aparece na URL, em
  log de console ou no arquivo de quadro persistido no workspace.
- **RNF-05 (segurança).** Conteúdo vindo do arquivo de quadro — que o agente
  escreve — é tratado como não confiável ao ser renderizado: nada de HTML
  executável a partir dele.
- **RNF-06 (acessibilidade).** Todo movimento de card possível por arraste é
  possível por teclado, e todo controle interativo tem rótulo acessível.
- **RNF-07 (acessibilidade).** Contraste mínimo AA em tema claro e escuro.
- **RNF-08 (observabilidade).** Falha ao iniciar run, ao parar run, ao ler e ao
  gravar o arquivo de quadro produz mensagem de erro visível ao usuário,
  distinguindo "backend fora do ar" de "workspace inacessível".
- **RNF-09 (resiliência).** Arquivo de quadro corrompido ou com hierarquia
  inválida não derruba a tela: o sistema afetado aparece em estado de erro
  isolado e os demais continuam utilizáveis.
- **RNF-10 (i18n).** Toda string visível é traduzível pelo mesmo mecanismo do
  repositório; o idioma padrão é português do Brasil.
- **RNF-11 (qualidade).** `npm run lint` e `npm run test` passam sem introduzir
  falha nova em relação à base.

---

## 6. Métricas de sucesso

| # | Métrica | Alvo v1 | Como medir |
|---|---|---|---|
| M1 | Cliques da raiz até executar uma tarefa | ≤ 4 | roteiro manual cronometrado |
| M2 | Tarefas com Executar habilitado | 100% das que têm briefing + backend de pé | inspeção do quadro de teste |
| M3 | Modais empilhados na navegação da hierarquia | 0 | revisão de código: nenhum modal aninhado em modal |
| M4 | Itens da checklist de reclamação do usuário resolvidos | 3 de 3 | revisão do `board.json` de origem com o usuário |
| M5 | Tarefas que chegam em `done` sem passar por `in_review` | 0 | teste automatizado da máquina de estados |
| M6 | Tempo entre o agente gravar o arquivo e a UI refletir | ≤ 5 s | teste manual com quadro aberto |
| M7 | Telas do AIK que não são um quadro kanban (incl. lista de sistemas) | 0 | revisão de código: toda rota principal renderiza colunas/cards |
| M8 | Conversar com o agente do sistema disponível a partir de qualquer nível de navegação | 100% das rotas do sistema (sistema, fase, tarefa) | roteiro manual: abrir o painel de conversa em cada nível |

---

## 7. Escopo de release e faseamento

**Release 1 — esqueleto navegável.** Kanban de sistemas, kanban de fases,
kanban de tarefas, breadcrumb, CRUD dos três níveis, arraste, persistência em
arquivo no workspace. Sem agente. *Entregável verificável: um humano planeja um
sistema inteiro à mão.*

**Release 2 — execução.** Executar, parar, indicador de run vivo, vínculo
tarefa↔conversa, `in_review` obrigatório, aprovar e devolver com feedback,
timeline. *Entregável: uma tarefa vai de `backlog` a `done` com agente.*

**Release 3 — conversa.** Painel lateral com a conversa do sistema, alternância
entre conversa do sistema e run da tarefa, o agente criando fases e tarefas a
partir da conversa, atualização ao vivo do quadro. *Entregável: o roadmap
nasce da conversa.*

**Release 4 — publicação.** Build e serviço independentes, vhost
`aik.zadotec.com.br` com TLS, sem regressão em `openhands.zadotec.com.br`.

Fora deste faseamento, para depois: fila de runs com custo (N1), quarto nível
(N2), migração dos quadros v2 (N5).

---

## 8. Riscos de produto e questões em aberto

### Riscos

- **R1 — reconstruir o chat sai caro.** O runtime de conversa do Agent Canvas
  (websocket, stream de eventos, ferramentas) é o ativo mais maduro do repo.
  Mitigação: O5 é requisito, não preferência — o AIK embute o runtime
  existente. Se na fase TECH ficar provado que ele não se desacopla do shell
  atual, o Release 3 é o que atrasa, não o 1 e o 2.
- **R2 — o arquivo de quadro como banco.** Sem servidor, concorrência entre UI
  e agente é resolvida por merge de arquivo (RF-28). É frágil sob muitos runs
  simultâneos. Mitigação: N1 limita v1 a um run por vez por sistema.
- **R3 — deriva de conceito.** O modelo do MadBuilder tem fila, custo e papéis
  que aqui não existem. Risco de o usuário esperar paridade. Mitigação: N1 e
  N4 explícitos, e o vocabulário da UI segue o do MadBuilder só onde o
  comportamento também segue.
- **R4 — dois fronts para manter.** Enquanto os dois existirem, correção de bug
  pode precisar ser feita duas vezes. Mitigação: o AIK reutiliza componentes e
  serviços do repo em vez de copiá-los; só o shell e as telas são novos.
- **R5 — sistema aponta para workspace que sumiu.** Backend fora do ar ou
  diretório removido deixa o sistema órfão. Mitigação: RNF-09 e RF-03 tornam o
  estado visível em vez de quebrar a tela.

### Questões em aberto

- **Q1.** As colunas do kanban de sistemas (RF-01) são quais? Proposta a
  validar na SPEC: `ativo | pausado | arquivado`, definidas pelo humano — não
  derivadas das tarefas.
- **Q2.** "Backend remoto" no AIK inclui o OpenHands Cloud (`BackendKind`
  `"cloud"`) ou só agent-servers próprios? A resposta muda o que RF-02 precisa
  pedir ao usuário no cadastro de sistema.
- **Q3.** O arquivo de quadro do AIK reaproveita o `board.json` existente
  (migrando o esquema) ou nasce em arquivo próprio ao lado dele? N5 diz que não
  há migração automática, o que empurra para arquivo próprio — a confirmar na
  fase TECH.
- **Q4.** RF-09 (fase fecha sozinha) vale também no sentido inverso para a
  coluna do sistema? Ou seja, o card de sistema reflete estado das fases?
  Proposta: não — Q1 mantém a coluna do sistema sob controle humano.

# PRD — kanban-pipeline-featdevelop

## 1. Problema e evidência

O board do sub-projeto `kanban-3-niveis` usa colunas genéricas fixas (`"todo" | "in_progress" | "done"`, `src/types/kanban.ts`), e o sub-projeto `kanban-card-contexto-arquivos` deixou o campo `agentContextHtml` como "só mais um campo de texto editável por humano, preparando terreno" (PRD daquele sub-projeto, seção 3). Nenhum dos dois liga o board ao pipeline real de planejamento de feature que a skill `featdevelop` já executa (`/root/.claude/skills/featdevelop/SKILL.md`: PRD → TECH → SPEC → SPRINTS, saída em `docs/features/<slug>/`) nem oferece uma forma de a pessoa usuária acionar um agente a partir de um card.

Investigação de código confirma o que já existe para apoiar essa ponte: `ConversationService.createConversation({ initialUserMsg, workingDirOverride, ... })` (`src/api/conversation-service/agent-server-conversation-service.api.ts:425-...`) já cria uma conversa nova apontando para um diretório de trabalho específico com uma mensagem inicial — é o mecanismo existente para "acionar um agente" a partir de qualquer lugar do app, sem inventar um novo transporte.

## 2. Usuários e cenários de uso

- Usuário cria um card de Nível 1 ("grande tarefa") e ativa o modo "Pipeline featdevelop" para aquele card, informando o slug da feature (mesma convenção da skill: kebab-case).
- Usuário clica "Rodar com agente": o Canvas abre uma nova conversa no workspace do card, com uma mensagem inicial pedindo para a skill `featdevelop` planejar a feature descrita no título/descrição/contexto do usuário do card.
- Conforme o agente avança pelas fases (PRD aprovado, depois TECH, depois SPEC, depois SPRINTS — cada uma com gate humano dentro da própria skill), o usuário arrasta o card manualmente pelas colunas do board, que agora refletem essas fases.
- Usuário abre o card e vê, em painel de somente-leitura, o conteúdo atual de `PRD.md`/`TECH.md`/`SPEC.md`/`sprints/*.md` do slug vinculado (se já existirem no workspace), sem sair do board.

## 3. Objetivos e não-objetivos

**Objetivos**
- Um card de Nível 1 pode ser vinculado a um slug de feature (`docs/features/<slug>/`).
- Ação "Rodar com agente" abre uma conversa nova no workspace do card com uma mensagem inicial adequada para a skill `featdevelop`.
- Card vinculado a um slug ganha um conjunto de colunas específico ("A Fazer", "PRD", "TECH", "SPEC", "SPRINTS", "Concluído") em vez do genérico de 3 colunas.
- Card mostra links de somente-leitura para os documentos já existentes daquele slug.

**Não-objetivos**
- Não detecta automaticamente em qual fase o agente está, nem move o card sozinho entre colunas — cada gate humano de `featdevelop` já é responsabilidade da própria skill/conversa; o board só reflete visualmente o que o usuário arrasta manualmente.
- Não importa automaticamente a saída da conversa para `agentContextHtml` — permanece um campo editável manualmente (decisão já tomada no sub-projeto anterior); ler o conteúdo dos documentos do slug (último objetivo) cobre a necessidade de visibilidade sem exigir sincronização em tempo real com a conversa.
- Não permite que o agente, de dentro da conversa, chame de volta uma API para mover cards ou editar o board — nenhuma superfície nova de escrita a partir da conversa é exposta nesta versão; a interação "agente → board" é unidirecional (o board só lê arquivos que o agente já escreveu no workspace).
- Não oferece nenhum outro pipeline além de `featdevelop` (ex.: não modela `featbuild`/`featsprints` como presets de coluna separados) — fica para uma iteração futura se o padrão se confirmar útil.

## 4. Requisitos funcionais

- **RF-01**: Um card de Nível 1 tem um campo opcional "Slug da feature" (texto, validado como kebab-case).
- **RF-02**: Com slug definido, o card usa o conjunto de colunas "A Fazer → PRD → TECH → SPEC → SPRINTS → Concluído" em vez do conjunto genérico de 3 colunas; sem slug, comportamento inalterado do sub-projeto `kanban-3-niveis`.
- **RF-03**: Botão "Rodar com agente" no card (visível só com slug definido e workspace resolvido) cria uma conversa nova via `createConversation`, com `workingDirOverride` = workspace do card e `initialUserMsg` construída a partir de título + descrição + `userContextHtml` do card, pedindo explicitamente para usar a skill `/featdevelop` com aquele slug.
- **RF-04**: Após criar a conversa, o card guarda o id retornado e mostra um link "Abrir conversa" que navega para a rota de conversa existente do app.
- **RF-05**: Card com slug definido mostra, em painel de somente-leitura, o conteúdo de `docs/features/<slug>/{PRD,TECH,SPEC}.md` e a lista de `docs/features/<slug>/sprints/*.md`, quando esses arquivos existem no workspace (lendo via o mecanismo de leitura de arquivo já usado pelo app) — ausência de arquivo é um estado normal ("ainda não gerado"), não um erro.
- **RF-06**: Rodar o agente novamente (segunda vez) no mesmo card cria uma **nova** conversa (não reaproveita a anterior) e atualiza o link — histórico de conversas anteriores não é mantido pelo card (o histórico geral de conversas do app já existe fora desta feature).

## 5. Requisitos não-funcionais

- **RNF-01 (clareza de estado)**: enquanto os documentos do slug ainda não existem, a UI mostra isso como "ainda não gerado", nunca como erro de carregamento.
- **RNF-02 (i18n)**: chaves novas seguem a convenção do projeto.
- **RNF-03 (não regressão)**: cards sem slug continuam funcionando exatamente como no sub-projeto `kanban-3-niveis` (RF-02 é aditivo, não substitui o comportamento existente).

## 6. Métricas de sucesso

- Criar um card com slug, rodar o agente, e ver o link de conversa funcionando fim a fim (teste de integração com `createConversation` mockado).
- Card sem slug não muda de comportamento (teste de regressão contra os testes já existentes do sub-projeto `kanban-3-niveis`).
- Painel de documentos reflete corretamente presença/ausência de cada arquivo do slug.

## 7. Escopo de release e faseamento

Release único. Depende de `kanban-3-niveis` (colunas, cards) e `kanban-card-contexto-arquivos` (contexto do usuário usado na mensagem inicial da conversa).

## 8. Riscos de produto e questões em aberto

- **Risco de escopo aceito conscientemente**: sem detecção automática de fase, o board pode ficar "desatualizado" em relação à conversa real se o usuário esquecer de arrastar o card — aceito porque implementar detecção automática exigiria parsear o estado da conversa/skill, fora do orçamento desta decomposição.
- **Questão em aberto (assumida)**: o slug não é validado contra a existência real da pasta `docs/features/<slug>/` no momento em que é digitado (RF-01) — só no momento de exibir os documentos (RF-05) a ausência é tratada como estado normal. Evita uma dependência de leitura de disco só para validar o campo de texto.

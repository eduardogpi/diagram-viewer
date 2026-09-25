# Checkpoints do projeto — Workbench Web

Registro cronológico do que foi implementado, na ordem em que evoluiu. Serve como histórico de decisões e ponto de retomada — não é um roadmap de próximos passos (isso continua em `IMPLEMENTATION_ROADMAP.md` / `MIGRATIONS_ROADMAP.md`).

---

## 1. Timeline de migrations

- Componente `MigrationTimeline.tsx`: linha do tempo horizontal com scroll, trilha de progresso (percorrido vs. restante), navegação por clique/teclado (setas, Home/End), auto-scroll até o item selecionado, agrupamento visual por módulo/pasta quando as migrations vêm de projetos com múltiplos diretórios.
- Painel "O que mudou nesta migration" em `MigrationsWorkbench.tsx`: mostra tabelas adicionadas/alteradas/removidas entre a migration atual e a anterior.
- Endpoint e serviço `appendMigrationsToPackage` (`migrations.ts` + rota `POST /api/migrations/[connectionId]/[packageId]/append`): permite anexar novas migrations a um package já existente, continuando a timeline em vez de sempre recomeçar do zero. Reprocessa o schema inteiro (arquivos antigos + novos) porque a ordenação Flyway é por versão/módulo, não por ordem de upload.

## 2. Padronização de design (tema claro/escuro)

- Descoberta: o projeto tem duas convenções coexistindo — componentes novos usam tokens `var(--color-*)` diretamente; componentes mais antigos (`MigrationDiagram`, partes do `MigrationsWorkbench`) usam classes Tailwind `slate-*`/`cyan-*` fixas, traduzidas em tema claro por um "shim" CSS em `globals.css` (`.theme-light .bg-slate-950 { ... }` etc.) que só cobre uma lista específica de classes/opacidades.
- Migração de `MigrationsWorkbench.tsx` (upload, lista de packages, painéis) para tokens explícitos, alinhando com o padrão mais novo usado em `MigrationImportForm`, `ConnectionForm` etc.

## 3. React Flow — melhorias visuais no `MigrationDiagram`

- **Separação de handles múltiplos**: quando uma tabela tem mais de uma relação (FK) de entrada ou saída, os pontos de conexão são distribuídos ao longo da borda do nó (em vez de todos saírem/entrarem do mesmo ponto central), ordenados pela posição do nó do outro lado pra minimizar cruzamento de linhas.
- **Destaque de relação selecionada**: clicar numa linha ou no botão "mostrar todas as relações" de uma tabela esmaece o resto do diagrama e destaca só o caminho relevante (linha mais grossa, animada, com seta maior; tabelas envolvidas com anel de destaque).
- **Painéis de detalhe** (`NodePanel`/`EdgePanel`): clicar numa tabela mostra colunas/contagem de relações + botão "Centralizar"; clicar numa linha mostra constraint, cardinalidade, `ON DELETE`/`ON UPDATE` e mapeamento de colunas da FK.
- **Fullscreen** nativo (Fullscreen API) com botão próprio, prop `showFullscreenButton` pra permitir que um componente pai (ex: `AiModelingWorkbench`) desative o botão interno e controle seu próprio fullscreen.
- **Tabelas arrastáveis**: `onNodeDragStop` grava a posição manual de cada tabela num mapa local, que tem prioridade sobre o layout automático (dagre) — sem isso, qualquer re-render (clique, seleção) fazia a tabela voltar pro lugar.
- Correções de bugs introduzidos no caminho:
  - `height="100%"` (usado no fullscreen do chat de IA) não propagava corretamente por uma div intermediária sem altura definida — corrigido trocando pra flexbox (`flex-1`) nesse caso específico.
  - Cores fixas (`ring-offset-slate-950`, `bg-slate-950/95`, `border-slate-800 bg-slate-900`) que não estavam cobertas pelo shim de tema claro, fazendo o anel de seleção e os painéis de detalhe ficarem escuros mesmo em tema claro — corrigido usando tokens/opacidades já traduzidas.

## 4. Nivelamento do `DiagramScopeView` (conexões reais)

Levadas as mesmas três melhorias do `MigrationDiagram` pro diagrama de conexões reais (MySQL introspectado), sem quebrar os recursos que só existem lá (criar FK manual, arrastar com posição salva em layout nomeado, painéis de filtro por escopo):
- Separação de handles múltiplos (adaptado pra layout vertical *e* horizontal).
- Destaque com esmaecimento ao selecionar linha/nó.
- Botão "mostrar todas as relações" no cabeçalho de cada tabela.

## 5. Modelagem de banco assistida por LLM

Feature nova: uma aba "Modelagem IA" no workspace onde o usuário conversa em linguagem natural para desenhar/alterar um schema, com revisão visual via diff antes de qualquer coisa "acontecer de fato".

### Arquitetura
- **Operações estruturadas, não SQL solto**: a LLM devolve uma lista de operações tipadas e validadas por zod (`createTable`, `addColumn`, `dropColumn`, `renameColumn`, `addForeignKey`, `dropForeignKey`, `dropTable`, `renameTable`) — provider-agnóstico, revisável, e parsing **tolerante por operação** (uma operação malformada é descartada com aviso, sem derrubar a resposta inteira).
- **Modelo de dados**: `AiModelingSession` (nome, provider, model, estado atual do diagrama) + `AiModelingTurn` (histórico de mensagens, operações propostas, snapshot do diagrama após cada turno).
- **Reaproveitamento**: o diagrama e o destaque de diff (verde/âmbar/rosa) são o mesmo `MigrationDiagram` já existente.

### Múltiplos provedores de LLM
- **Gemini**: `@google/generative-ai`, com `responseSchema` nativo (JSON estruturado garantido pelo provider).
- **OpenRouter** e **NVIDIA NIM**: ambos expõem API compatível com OpenAI (chat completions) — implementados via um módulo genérico único (`openai-compatible.ts`), com adaptadores finos por provedor. Suportam modelos gratuitos (marcados 🆓 na lista), com timeout generoso (120s) e extração tolerante de JSON (alguns modelos ignoram a instrução de formato e embrulham a resposta em markdown).
- Listagem de modelos em tempo real via API de cada provedor (não é lista fixa no código); modelos agrupados por provedor no seletor (`<optgroup>`).
- Cada sessão grava o par provider+model escolhido e usa exatamente esse par em toda mensagem futura — não existe mais um provider global fixo.

### Continuidade e contexto
- Nova sessão de IA numa conexão que já tem conteúdo (package de Migrations importado, ou conexão MySQL real) **começa com o schema existente já carregado** (via `getFinalDiagram` do último package, ou introspecção ao vivo do banco) — a LLM já sabe das tabelas que existem antes da primeira mensagem, em vez de sempre partir do zero.
- Dentro da mesma sessão, o modelo completo atual é enviado em toda mensagem (não só o histórico de texto), então a conversa acumula estado corretamente.

### Modo "só discutir"
- Checkbox no chat: quando ligado, a LLM é instruída a não propor operações — e, **independente do que a LLM devolver**, o backend descarta qualquer operação recebida nesse modo (garantia real, não depende do modelo obedecer o prompt). Nota automática é anexada à resposta confirmando que nada foi aplicado, porque modelos mais fracos às vezes "alucinam" dizendo que fizeram uma mudança mesmo sem ter devolvido nenhuma operação.

### UI
- Botão "Nova modelagem com IA" na home (cria uma conexão "virtual" dedicada, sem precisar de banco real, e já redireciona pra sessão criada).
- Fullscreen do diagrama com o chat flutuando como painel fixo do lado direito (sobreposto, não redimensiona o canvas).

## 6. Append de migrations sem duplicar (reenvio do pacote inteiro)

- `appendMigrationsToPackage` deduplica por **nome canônico** (`modulo/V1__init.sql`) + checksum de conteúdo, em vez de concatenar cegamente antigos + novos. Dá pra jogar o zip completo do projeto de novo: o que já existe e está igual é ignorado, o que é novo entra, o que mudou é sobrescrito e reportado.
- A lógica vive em `mergeMigrationFiles` (`migration-parser.ts`), pura e testada — o nome canônico é estável no roundtrip banco → input → banco, que é o que faz o reenvio funcionar.
- Divergência de checksum **não bloqueia** (um Flyway barraria): aqui é visualizador, então sobrescreve e avisa. Efeito colateral a lembrar: reconstruir a timeline muda também os snapshots anteriores àquele ponto.
- Quando nada é novo, o append retorna sem tocar no banco — evita apagar/recriar todos os snapshots à toa.
- Upload, append e import passaram a usar um leitor único (`readMigrationFilesFromFormData`) que aceita `.sql` e `.zip` (500 arquivos / 50MB), eliminando o bloco inline de ~80 linhas que existia só no `import/route.ts`.

## 7. Memória do projeto no chat de IA (MCP CodeGraph)

- O chat busca memórias antes de chamar a LLM e grava a decisão depois — **sem loop agêntico**. Cabe em uma única chamada, então funciona também com os modelos gratuitos que não fazem tool calling.
- O que é gravado sai das operações **já aplicadas** (`summarizeOperations`), não de uma segunda chamada de LLM: determinístico, sem custo e sem alucinação. Operações rejeitadas por `applySchemaOps` não viram memória, e turnos sem operação (perguntas, modo "só discutir") também não.
- Namespace resolvido por chamada: `project_id` = `workbench:<connectionId>` (ou `memoryProjectId`, pra apontar pro projeto de código no CodeGraph) e `user_id` = dono da sessão. **Nunca** `set_active_project` — é estado global do processo do MCP e quebraria o isolamento entre usuários.
- Cliente MCP em `src/lib/services/memory/codegraph.ts` (SDK oficial, transporte HTTP streamable), com conexão em cache no escopo do módulo e reset em erro. Tudo best-effort: memória fora do ar degrada a resposta, nunca derruba o turno.
- Toggle por sessão (`memoryEnabled`) no chat; o checkbox só aparece se o servidor tiver `CODEGRAPH_MCP_URL`.
- **Threshold importa**: o corte inicial de 0.45 silenciou a memória — perguntas genéricas ("o que já decidimos aqui?") pontuam ~0.32 contra memórias específicas. Ficou no default 0.3, ajustável por `CODEGRAPH_MEMORY_THRESHOLD`; quem contém ruído é o `limit`.

## 8. Exportação da modelagem IA para SQL real

Fecha o ciclo do produto: até aqui tudo ia de SQL/banco → diagrama (parser e introspecção). Faltava a volta.

- `ddl-generator.ts`: `DiagramResponse` → DDL, com dialetos **MySQL** e **PostgreSQL**. O modelo já é dialeto-agnóstico (o prompt da IA proíbe sintaxe específica), então só resta traduzir os tipos divergentes (`JSONB`↔`JSON`, `BLOB`↔`BYTEA`, `DATETIME`→`TIMESTAMP`, `TINYINT(1)`→`BOOLEAN`), aplicar quoting (crase vs. aspas duplas) e ordenar as tabelas.
- **Ordenação topológica** por FK, para nenhuma referência apontar para tabela inexistente. Ciclos (A→B→A) não têm ordem válida: as FKs que os fecham saem como `ALTER TABLE ... ADD CONSTRAINT` no fim. Auto-referência não bloqueia nada.
- **Nome do banco**: MySQL usa `CREATE DATABASE ... ; USE ...`; Postgres usa `CREATE SCHEMA ... ; SET search_path`, com comentário avisando que `CREATE DATABASE` precisa rodar fora do script (não roda em transação nem existe `USE`).
- Tabelas homônimas de escopos diferentes (modelo multi-sistema) são desqualificadas (`projeto-a.users` → `projeto_a_users`) para não colidirem no mesmo banco.
- Dois destinos, na rota `/api/ai-modeling/[connectionId]/[sessionId]/export`: `GET` baixa o `.sql`; `POST` grava como **package de migrations** (`V1__<nome>.sql`) na própria conexão — a modelagem entra na timeline e passa a aceitar append, sem tela nova.
- Verificado ponta a ponta com a IA real: o SQL gerado, relido pelo parser, reproduz exatamente as mesmas tabelas e FKs (inclusive `ON DELETE CASCADE`). Há um teste de roundtrip gerador→parser fixando isso.
- Detalhe conhecido: ao salvar como package com nome de banco em Postgres, o parser emite 1 warning em `CREATE SCHEMA` (statement que ele não interpreta). Inofensivo — o diagrama sai correto.
- **Fora de escopo por decisão**: executar o DDL em banco real. Os drivers seguem read-only.

## 9. Correções de bugs de infraestrutura encontrados no caminho

- **Cascade de delete ausente**: `DELETE /api/connections/[connectionId]` e `deleteMigrationPackage` não apagavam registros filhos (`MigrationFile`/`MigrationSnapshotRow`, `AiModelingSession`/`AiModelingTurn`, `WorkspacePreference`, `LayoutSnapshot`) antes de apagar o pai, causando erro de foreign key. Os botões de remover na UI **engoliam esse erro silenciosamente** ("clico e não acontece nada") — corrigido nos dois pontos (limpeza em transação) e os botões agora mostram alerta quando a remoção falha.

## 10. MCP HTTP + integridade da modelagem IA

- Transporte **Streamable HTTP** (`npm run mcp:http`) com Bearer (`MCP_HTTP_TOKEN`), sessões MCP isoladas e estado sticky por `mcp-session-id` — dois agentes remotos não compartilham mais a conexão/sessão ativa.
- Filtro de ambiente via tags (`dev`/`homolog`/`prod`…) com `MCP_ALLOWED_ENVIRONMENTS` e `MCP_REQUIRE_ENV_TAG`.
- Tools novas/estendidas: `modeling_export_sql` agora também salva package de migrations; `modeling_set_memory` liga memória e aponta o `project_id` do CodeGraph.
- Motor de operações: resolução de tabela por rótulo único, recusa de nome ambíguo, FKs acompanham rename/drop da tabela/coluna alvo, coluna referenciada inexistente é rejeitada, FK cruzada de escopo vira nota (não rejeição).
- **Edição humana** na aba Modelagem IA: inspector cria/renomeia/remove tabelas, edita colunas (`alterColumn`), liga/desliga FK. Toda ação vira turno no mesmo histórico (desfazer pelo chat). API `POST /api/ai-modeling/.../ops`.

## Estado atual (para retomar)

- Servidor de dev: `npm run dev` em `workbench-web/`, porta pode variar (3000 se 3005 estiver livre).
- Variáveis de ambiente relevantes em `.env`: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `LLM_PROVIDER` (fallback quando a sessão não tem provider salvo), `CODEGRAPH_MCP_URL` + `CODEGRAPH_MCP_TOKEN` (memória do projeto; sem elas o recurso some da UI) e `CODEGRAPH_MEMORY_THRESHOLD` (opcional).
- Testado de ponta a ponta: Gemini (com limitação de quota gratuita observada), OpenRouter (modelo gratuito `openai/gpt-oss-20b:free` funcionou bem), NVIDIA (listagem confirmada, chat não testado com chave real).
- Pendências conhecidas, não corrigidas por não terem sido pedidas: estados `hover:` em vários componentes escuros não são traduzidos pelo shim de tema claro (só os estados normais são); `ring-offset`/opacidades não documentadas no shim podem reaparecer em componentes futuros que copiarem o padrão antigo sem usar tokens diretos.

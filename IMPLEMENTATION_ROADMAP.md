# Diagram Viewer - Roadmap de Implementacao

## Objetivo

Este documento organiza a evolucao do produto em fases praticas, com checklist de implementacao e observacoes sobre o estado atual do projeto.

Hoje o sistema ja possui:

- identificacao/autenticacao por sessao (cookie/header) com isolamento por usuario
- cadastro de conexoes com teste real de conexao (MySQL e PostgreSQL)
- persistencia com Prisma/SQLite e segredos cifrados (AES-256-GCM)
- geracao de diagrama a partir do catalogo do banco (introspeccao ao vivo)
- visualizacao do diagrama com React Flow (filtros, layout, snapshots, export JSON)
- execucao SQL read-only no workspace com historico por conexao
- explorer de schema com colunas/indices, preview de dados e export de documentacao
- importador de migrations (Flyway/SQL puro) com timeline de snapshots
- modelagem de schema assistida por LLM (Gemini/OpenRouter/NVIDIA) com memoria de projeto
- servidor MCP (stdio + HTTP) expondo a modelagem IA para agentes externos
- persistencia de preferencias por usuario (aba favorita, minimapa, profundidade, filtros)
- testes unitarios com vitest

Hoje o sistema ainda tem partes que sao apenas menu, texto estatico ou placeholders:

- `Admin` (aba parcial: mostra resumo real da conexao e eventos de auditoria, mas sem usuarios/roles/jobs/locks/backup)
- botao/fluxo de `Atualizar schema` acionavel pela UI
- exportacao PNG/SVG e layout "force" no diagrama
- comparacao entre ambientes e diff entre snapshots

---

## Diagnostico Atual

### Funcionalidades reais

- [x] Criar conexao via formulario
- [x] Validar payload com Zod
- [x] Testar conexao antes de salvar (MySQL e PostgreSQL)
- [x] Persistir conexao e segredo no banco (cifrado)
- [x] Listar conexoes na home com busca/filtros/status real
- [x] Abrir workspace por conexao
- [x] Gerar diagrama real do schema do banco
- [x] Renderizar diagrama com React Flow
- [x] Filtrar diagrama por escopo e tabelas
- [x] Executar consultas SQL read-only com resultado tabular
- [x] Importar migrations e gerar diagramas por snapshot
- [x] Modelagem de schema assistida por LLM
- [x] Servidor MCP para agentes externos dirigirem sessoes de modelagem

### Funcionalidades com UX parcial ou tecnica incompleta

- [x] Controle de acesso por usuario (sessao/cookie; provider de login completo ainda pode evoluir)
- [x] Seguranca forte para segredos (AES-256-GCM + falha explicita sem chave)
- [x] Suporte real a multiplos provedores (MySQL e PostgreSQL; MIGRATIONS sem banco)
- [x] Dados reais no header/layout do workspace
- [x] Indicadores reais de ultimo acesso/status/checksum
- [x] Persistencia de preferencias do usuario
- [x] Persistencia de filtros/layout do diagrama
- [x] Testes automatizados (vitest)
- [ ] Tratamento de encoding quebrado em textos PT-BR

### Funcionalidades que hoje sao so menu/placeholder

- [x] Editor SQL funcional
- [x] Explorer de schema/tabelas/dados
- [ ] Modulo administrativo (apenas resumo + auditoria; sem usuarios/roles/jobs)
- [x] Historico/auditoria visivel na interface (painel de eventos no Admin)
- [ ] Atualizacao de schema acionavel pela UI

---

## Fase 1 - Fundacao e Seguranca

Objetivo: garantir que a base do sistema seja confiavel antes de expandir o produto.

Status desta base: implementada

Observacao: nesta iteracao, a autenticacao foi resolvida com identificacao por sessao/cookie HTTP-only para garantir isolamento por usuario dentro da aplicacao atual. Isso cobre o controle de acesso da base, embora uma integracao completa com provider de login ainda possa evoluir no futuro.

### Checklist

- [x] Falhar explicitamente quando `SECRET_ENCRYPTION_KEY` nao estiver definida
- [x] Remover fallback inseguro para chave zerada
- [x] Adicionar identificacao/autenticacao base por sessao
- [x] Filtrar conexoes por usuario dono
- [x] Proteger rota de diagrama por permissao de acesso
- [x] Remover `ownerId: "demo-user"` hardcoded
- [x] Revisar serializacao e armazenamento de segredos
- [x] Corrigir encoding nos arquivos alterados desta fase
- [x] Adicionar tratamento de erro padronizado nas rotas principais
- [x] Remover dependencia de dados demo no acesso ao workspace

### Entregaveis

- API com isolamento por usuario
- workspace vinculado ao dono da conexao
- segredos bloqueados sem chave de criptografia valida
- base pronta para crescimento sem exposicao cruzada entre usuarios

---

## Fase 2 - Conexoes e Catalogo

Objetivo: transformar a home em um catalogo real de conexoes, e nao apenas uma lista simples.

Status desta base: implementada

Observacao: nesta iteracao, a Fase 2 foi entregue com catalogo interativo, busca, filtros, reteste, edicao basica e remocao. Itens de escala, como paginacao e virtualizacao, continuam como melhorias futuras.

### Checklist

- [x] Trocar `fetch` HTTP da propria home por acesso direto a service/repository
- [x] Exibir status real da conexao
- [x] Exibir data real de criacao/ultimo uso
- [x] Adicionar edicao de conexao
- [x] Adicionar exclusao/arquivamento de conexao
- [x] Adicionar busca por nome/host/tag
- [x] Adicionar filtros por provider/tag/status
- [ ] Adicionar paginacao ou virtualizacao para listas maiores
- [x] Adicionar indicador de erro de credencial/segredo invalido
- [x] Ocultar providers nao suportados na UI ate implementacao real

### Funcionalidades desejaveis

- [ ] duplicar conexao
- [x] testar conexao novamente
- [ ] marcar favoritas
- [ ] organizacao por ambientes: dev, homolog, prod

---

## Fase 3 - Workspace Base Real

Objetivo: fazer o workspace deixar de ser decorativo e virar a shell principal do produto.

Status desta base: implementada

Observacao: nesta iteracao, a shell do workspace passou a usar dados reais da conexao, eventos recentes, aba favorita por usuario e estados visuais consistentes entre as abas. Os modulos internos continuam placeholders funcionais ate as fases especificas.

### Checklist

- [x] Substituir `demoConnections` por dados reais da conexao
- [x] Mostrar metadados reais no cabecalho
- [x] Mostrar tags reais no layout
- [x] Mostrar status real de disponibilidade
- [x] Mostrar host/database/provider reais
- [x] Implementar breadcrumbs consistentes
- [x] Implementar loading state por aba
- [x] Implementar empty states e estados de erro por modulo
- [x] Persistir aba favorita por usuario
- [x] Exibir ultimos eventos dessa conexao no painel lateral

### Funcionalidades desejaveis

- [ ] painel de atividade recente
- [ ] atalhos rapidos por workspace
- [ ] ultimas consultas/ultimos diagramas

---

## Fase 4 - Diagramas

Objetivo: elevar o modulo que hoje esta mais maduro para nivel de produto.

Status desta base: implementada

Observacao: nesta iteracao, a Fase 4 passou a persistir preferencias por usuario, restaurar viewport e filtros, salvar snapshots nomeados, permitir fullscreen, foco em tabela, selecao de vizinhos, profundidade de relacoes, agrupamento alternativo e exportacao JSON. Itens como exportacao PNG/SVG e layouts alternativos alem de dagre continuam como proximas evolucoes.

### Checklist

- [x] Persistir filtros de escopo/tabela por usuario
- [x] Persistir viewport/zoom por conexao
- [x] Salvar snapshots de layout em `LayoutSnapshot`
- [x] Permitir nomear e restaurar layouts salvos
- [x] Adicionar fullscreen
- [x] Adicionar foco em tabela selecionada
- [x] Adicionar "selecionar vizinhos"
- [x] Adicionar profundidade de relacoes: 1 nivel, 2 niveis, n niveis
- [x] Adicionar agrupamento alternativo por schema, prefixo e dominio
- [x] Adicionar busca com destaque no canvas
- [x] Melhorar painel de detalhes de relacao
- [ ] Adicionar exportacao PNG/SVG
- [x] Adicionar exportacao JSON
- [x] Adicionar esconder/mostrar tabelas sem perder o filtro salvo
- [x] Adicionar minimapa e controles configuraveis por usuario
- [ ] Permitir reorder/logica de layout: force
- [x] Permitir reorder/logica de layout: dagre, LR, TB
- [x] Criar FK manual por dois cliques no canvas (edge tracejada ambar, removivel)
- [x] Reorganizar toolbar com agrupamento visual e separadores
- [x] Padronizar idioma da UI para PT-BR
- [x] Handles dos nos ajustaveis conforme direcao do layout (TB/LR)
- [x] Extrair NodePanel e EdgePanel como sub-componentes
- [x] Estado vazio do canvas com botao de limpar filtros
- [x] Posicionamento dinamico dos panels via ResizeObserver na toolbar
- [x] Toggle de vizinhos com reversao no NodePanel
- [x] Botao de fechar no NodePanel

### Funcionalidades avancadas

- [ ] inferencia visual de tabelas centrais
- [ ] heatmap de tabelas mais relacionadas
- [ ] diff entre dois snapshots de schema
- [ ] comparacao entre ambientes

---

## Fase 5 - Editor SQL

Objetivo: implementar de verdade a aba que hoje e apenas descricao e query fixa.

Status desta base: implementada (falta apenas separar consultas mutáveis, que continuam bloqueadas).

Observacao: a Fase 5 ganhou executor read-only (MySQL e PostgreSQL) com timeout e limite de linhas, Monaco Editor com autocomplete por schema, multiplas abas, favoritos, formatacao, EXPLAIN, cancelamento, resultado paginado, export CSV/JSON, historico por conexao e integracao com o Explorer.

### Checklist

- [x] Integrar Monaco Editor
- [x] Criar executor de query no backend
- [x] Implementar leitura segura com limites e timeout
- [ ] Separar consultas read-only e operacoes mutaveis
- [x] Adicionar autocomplete baseado no schema carregado
- [x] Adicionar syntax highlight por provider (Monaco, linguagem SQL)
- [x] Adicionar historico de queries por conexao/usuario
- [x] Adicionar multiplas abas
- [x] Adicionar salvar consultas favoritas
- [x] Adicionar parametros/snippets reutilizaveis
- [x] Adicionar formatacao SQL
- [x] Adicionar cancelamento de query longa
- [x] Adicionar resultado tabular paginado
- [x] Adicionar download CSV/JSON
- [x] Adicionar explain plan

### Criticos antes de liberar

- [x] guardrails para query destrutiva
- [ ] confirmacao para `UPDATE`, `DELETE`, `DROP`, `ALTER`
- [x] trilha de auditoria
- [ ] rate limit e timeout (timeout existe; rate limit nao)

---

## Fase 6 - Explorer

Objetivo: transformar a aba Explorer em uma ferramenta de navegacao e inspecao real.

Status desta base: implementada.

### Checklist

- [x] Listar schemas/tabelas reais da conexao
- [x] Adicionar busca incremental
- [x] Exibir colunas, tipos, PKs, FKs e indices
- [x] Adicionar painel de preview de dados
- [x] Adicionar pagina de detalhes da tabela
- [x] Adicionar navegacao para tabelas relacionadas
- [x] Adicionar filtros por schema
- [x] Adicionar contagem de linhas estimada
- [x] Adicionar estatisticas basicas da tabela
- [x] Adicionar copiar nome da tabela/coluna
- [x] Adicionar abrir tabela no editor SQL
- [x] Adicionar abrir tabela no diagrama

### Funcionalidades avancadas

- [ ] comparacao entre tabelas
- [ ] inspecao de indices redundantes
- [ ] painel de colunas nao utilizadas

---

## Fase 7 - Admin

Objetivo: substituir a aba administrativa estaticamente descrita por operacoes reais.

Status desta base: parcial. A aba Admin ja mostra dados reais da conexao (host/porta/database/usuario/status) e um painel de eventos recentes de auditoria (`listRecentConnectionEvents`), mas nenhum item abaixo esta implementado.

### Checklist

- [ ] Painel de usuarios/permissoes
- [ ] Roles por workspace/conexao
- [ ] Auditoria de acoes
- [ ] Jobs de manutencao
- [ ] Monitor de sessoes ativas
- [ ] Monitor de locks
- [ ] Historico de erros operacionais
- [ ] Backup logico sob demanda
- [ ] Agendamento de tarefas de manutencao
- [ ] Painel de saude da conexao

### Dependencias

- [ ] autenticacao/autorizacao pronta
- [ ] infraestrutura de jobs
- [ ] trilha de auditoria consolidada

---

## Fase 8 - Persistencia de Preferencias

Objetivo: usar as tabelas do Prisma que ja existem mas ainda nao aparecem no produto.

Observacao: parte desta fase ja foi antecipada nas Fases 3 e 4, com persistencia de aba favorita, minimapa, profundidade de relacoes, filtros recentes do diagrama e restauracao de layouts nomeados. O restante segue como consolidacao de preferencias em outras areas do produto.

### Checklist

- [x] Salvar `WorkspacePreference`
- [x] Salvar tema/preferencias de minimapa
- [x] Salvar abas favoritas
- [x] Salvar profundidade de relacoes
- [x] Salvar filtros recentes do diagrama
- [x] Salvar layouts/snapshots nomeados
- [x] Criar UI para restaurar preferencia e layout

### Ganho esperado

- continuidade entre sessoes
- experiencia mais "produto" e menos "demo"

---

## Fase 9 - Observabilidade e Qualidade

Objetivo: reduzir risco de regressao e melhorar operacao.

Status desta base: implementada (falta apenas E2E).

Observacao: logging estruturado com pino, metricas/tracing basicos (duracao por operacao), CI (lint/typecheck/test), testes de integracao das rotas de API, fixture de schema e smoke test do diagrama.

### Checklist

- [x] Configurar testes unitarios (vitest)
- [x] Configurar testes de integracao para API
- [ ] Configurar testes E2E para fluxos principais
- [x] Configurar lint e typecheck no CI (`.github/workflows/ci.yml`)
- [x] Adicionar logging estruturado (pino)
- [x] Adicionar metricas de uso e erros (`recordMetric`)
- [x] Adicionar tracing basico nas rotas criticas (`withTracing`)
- [x] Criar fixture local para schema de teste
- [x] Criar smoke test para montar diagrama

---

## Fase 10 - Melhorias de Produto

Objetivo: evoluir de ferramenta tecnica para produto mais completo.

Status desta base: parcial.

### Checklist

- [x] onboarding para primeira conexao
- [x] templates de conexao
- [x] pagina de ajuda/atalhos (`/help`)
- [ ] favoritos/recentes de conexoes
- [ ] compartilhamento de layouts
- [x] exportacao de documentacao de schema (Markdown via Explorer)
- [ ] comparacao entre ambientes
- [ ] IA para explicar schema e sugerir joins
- [ ] geracao de documentacao automatica por dominio (hoje agrupa por schema)

---

## Fase 11 - Integração MCP (AI Modeling)

Objetivo: expor o modulo de Modelagem IA como servidor MCP, permitindo que agentes externos (Claude Code, Codex, Devin) dirijam sessoes de modelagem compartilhadas com a UI.

Status desta base: implementada

### Checklist

- [x] Servidor MCP stdio (`src/mcp/server.ts`, script `npm run mcp`)
- [x] Tools de conexao: `list_connections`, `use_connection` (sticky)
- [x] Tools de sessao: `modeling_list_sessions`, `modeling_create_session`, `use_session`, `modeling_get_session`, `modeling_get_diagram`, `modeling_delete_session`
- [x] Tool de turno: `modeling_send_message` (LLM da sessao) com diff de tabelas na resposta
- [x] Tool de operacoes diretas: `modeling_apply_ops` — o agente analisa e a sessao so persiste, sem chamar a LLM
- [x] Tools auxiliares: `modeling_revert`, `modeling_export_sql`, `modeling_status`
- [x] Selecao de conexao: explicita, sticky, `MCP_CONNECTION_ID` e allowlist `MCP_ALLOWED_CONNECTIONS`
- [x] Resolucao de usuario via `MCP_USER_ID` (fallback: dono da conexao mais recente)
- [x] Sincronizacao em tempo real da UI (polling de sessao aberta e lista de sessoes)
- [x] Documentacao de configuracao no README

### Proximas evolucoes

- [x] Transporte HTTP (Streamable HTTP) para agentes remotos como Devin, com autenticacao por token
- [x] Tags de ambiente (dev/homolog/prod) com restricoes por ambiente
- [x] Estado sticky isolado por sessao MCP (stdio vs cada cliente HTTP)
- [x] `modeling_export_sql` com opcao de salvar como package de migrations
- [x] `modeling_set_memory` para ligar/desligar memoria e apontar o projeto do CodeGraph
- [x] Edicao humana no canvas (inspector + POST /ops), mesmo historico da conversa
- [x] Operacao `alterColumn` (tipo / nullability / PK) no motor, na LLM e no MCP
- [ ] Substituir polling por SSE/WebSocket

---

## Fase 12 - Importador de Migrations

Objetivo: receber uma pasta de migrations (foco Flyway/SQL puro), reconstruir o schema aplicando-as em ordem e gerar diagramas ER por snapshot. Detalhes em `MIGRATIONS_ROADMAP.md`.

Status desta base: implementada.

### Checklist

- [x] Upload de arquivos de migrations via UI (`/api/migrations/import`, `/api/migrations/[connectionId]/upload`)
- [x] Parser de SQL puro (CREATE/ALTER/DROP TABLE, FKs) reutilizando o DTO `DiagramResponse`
- [x] Aplicar migrations em ordem e gerar snapshot por migration (`MigrationSnapshotRow`)
- [x] Timeline navegavel entre snapshots
- [x] Estado final do schema como diagrama
- [x] Aba `Migrations` no workspace e provider `MIGRATIONS` (sem banco real)
- [x] Adicionar migration a um package existente (`/append`)
- [x] Salvar modelagem IA como package de migrations
- [ ] Diff entre dois snapshots de schema
- [ ] Parser de migrations Laravel/Rails/Django
- [ ] Liquibase XML/YAML

---

## Fase 13 - Modelagem IA (Workbench)

Objetivo: desenhar e alterar o schema conversando com uma LLM, sem depender de banco ativo, com edicao humana no mesmo historico.

Status desta base: implementada.

### Checklist

- [x] Sessoes de modelagem por conexao (criar/listar/remover)
- [x] Chat com streaming de resposta e aplicacao de operacoes de schema
- [x] Multiplo provedor LLM por sessao (Gemini/OpenRouter/NVIDIA) com troca de modelo
- [x] Botao de atualizar lista de modelos das APIs disponiveis (forca refresh do cache)
- [x] Editor manual de schema (inspector) entrando no mesmo historico da conversa
- [x] Checkpoints e revert para um turno anterior
- [x] Exportar SQL (MySQL/PostgreSQL) e salvar como package de migrations
- [x] Memoria de projeto (CodeGraph) por sessao
- [x] Sincronizacao em tempo real entre UI e agentes MCP (polling)
- [ ] Substituir polling por SSE/WebSocket

---

## Prioridade Recomendada

### Concluidas

Fases 1, 2, 3, 4, 5, 6, 8, 9, 11, 12 e 13 entregues. Fase 10 parcialmente.

### Ordem sugerida para o que falta

1. Fase 7 - Admin
2. Fase 10 - restante (favoritos/recentes, compartilhamento de layouts, comparacao entre ambientes, IA de explicacao)
3. Extras das Fases 4 e 12 (export PNG/SVG, layout "force", diff entre snapshots)

---

## Resumo do Que Hoje e So Menu

### Editor SQL

- status atual: funcional (somente leitura) com Monaco, abas, favoritos, EXPLAIN e export
- implementacao real: completa (operacoes mutaveis continuam bloqueadas por design)

### Explorer

- status atual: funcional (schemas, tabelas, colunas, indices, preview, docs)
- implementacao real: completa

### Admin

- status atual: parcial (resumo real da conexao + eventos de auditoria)
- implementacao real: usuarios/roles/jobs/locks/backup ainda nao existem

### Detalhes do workspace

- status atual: real
- implementacao real: consome dados reais da conexao (metadados, tags, status, eventos)

### Auditoria, schema update e historico

- auditoria/historico: eventos recentes ja aparecem na aba Admin
- schema update acionavel pela UI: ainda nao existe

---

## Observacao Final

O projeto ja tem um nucleo promissor no modulo de diagrama e uma modelagem Prisma que antecipa evolucoes importantes. O maior ganho agora nao e adicionar mais abas visuais, e sim transformar cada menu em modulo funcional real, com seguranca, persistencia e operacao confiavel.

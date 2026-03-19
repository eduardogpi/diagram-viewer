# Diagram Viewer - Roadmap de Implementacao

## Objetivo

Este documento organiza a evolucao do produto em fases praticas, com checklist de implementacao e observacoes sobre o estado atual do projeto.

Hoje o sistema ja possui:

- cadastro de conexoes
- persistencia basica com Prisma/SQLite
- teste de conexao MySQL no cadastro
- geracao de diagrama a partir de `INFORMATION_SCHEMA`
- visualizacao do diagrama com React Flow
- filtros visuais de escopo/tabela no diagrama
- execucao SQL read-only no workspace com historico basico

Hoje o sistema ainda tem partes que sao apenas menu, texto estatico ou placeholders:

- `Explorer`
- `Admin`
- painel lateral de detalhes do workspace
- botoes como `Atualizar schema` e `Ver historico de auditoria`

---

## Diagnostico Atual

### Funcionalidades reais

- [x] Criar conexao via formulario
- [x] Validar payload com Zod
- [x] Testar conexao MySQL antes de salvar
- [x] Persistir conexao e segredo no banco
- [x] Listar conexoes na home
- [x] Abrir workspace por conexao
- [x] Gerar diagrama real do schema MySQL
- [x] Renderizar diagrama com React Flow
- [x] Filtrar diagrama por escopo e tabelas
- [x] Executar consultas SQL read-only com resultado tabular

### Funcionalidades com UX parcial ou tecnica incompleta

- [ ] Controle de acesso por usuario
- [ ] Seguranca forte para segredos
- [ ] Suporte real a multiplos provedores
- [ ] Dados reais no header/layout do workspace
- [ ] Indicadores reais de ultimo acesso/status/checksum
- [ ] Persistencia de preferencias do usuario
- [ ] Persistencia de filtros/layout do diagrama
- [ ] Testes automatizados
- [ ] Tratamento de encoding quebrado em textos PT-BR

### Funcionalidades que hoje sao so menu/placeholder

- [x] Editor SQL funcional
- [ ] Explorer de schema/tabelas/dados
- [ ] Modulo administrativo
- [ ] Historico/auditoria visivel na interface
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

### Funcionalidades avancadas

- [ ] inferencia visual de tabelas centrais
- [ ] heatmap de tabelas mais relacionadas
- [ ] diff entre dois snapshots de schema
- [ ] comparacao entre ambientes

---

## Fase 5 - Editor SQL

Objetivo: implementar de verdade a aba que hoje e apenas descricao e query fixa.

Status desta base: implementada parcialmente

Observacao: nesta iteracao, a Fase 5 ganhou executor MySQL read-only com timeout e limite de linhas, UI operacional no workspace, snippets iniciais, historico por conexao e resultado tabular real. Monaco, autocomplete, multiplas abas, favoritos e exportacoes seguem como proximos incrementos.

### Checklist

- [ ] Integrar Monaco Editor
- [x] Criar executor de query no backend
- [x] Implementar leitura segura com limites e timeout
- [ ] Separar consultas read-only e operacoes mutaveis
- [ ] Adicionar autocomplete baseado no schema carregado
- [ ] Adicionar syntax highlight por provider
- [x] Adicionar historico de queries por conexao/usuario
- [ ] Adicionar multiplas abas
- [ ] Adicionar salvar consultas favoritas
- [x] Adicionar parametros/snippets reutilizaveis
- [ ] Adicionar formatacao SQL
- [ ] Adicionar cancelamento de query longa
- [ ] Adicionar resultado tabular paginado
- [ ] Adicionar download CSV/JSON
- [ ] Adicionar explain plan

### Criticos antes de liberar

- [x] guardrails para query destrutiva
- [ ] confirmacao para `UPDATE`, `DELETE`, `DROP`, `ALTER`
- [x] trilha de auditoria
- [ ] rate limit e timeout

---

## Fase 6 - Explorer

Objetivo: transformar a aba Explorer em uma ferramenta de navegacao e inspecao real.

### Checklist

- [ ] Listar schemas/tabelas reais da conexao
- [ ] Adicionar busca incremental
- [ ] Exibir colunas, tipos, PKs, FKs e indices
- [ ] Adicionar painel de preview de dados
- [ ] Adicionar pagina de detalhes da tabela
- [ ] Adicionar navegacao para tabelas relacionadas
- [ ] Adicionar filtros por schema
- [ ] Adicionar contagem de linhas estimada
- [ ] Adicionar estatisticas basicas da tabela
- [ ] Adicionar copiar nome da tabela/coluna
- [ ] Adicionar abrir tabela no editor SQL
- [ ] Adicionar abrir tabela no diagrama

### Funcionalidades avancadas

- [ ] comparacao entre tabelas
- [ ] inspecao de indices redundantes
- [ ] painel de colunas nao utilizadas

---

## Fase 7 - Admin

Objetivo: substituir a aba administrativa estaticamente descrita por operacoes reais.

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

### Checklist

- [ ] Configurar testes unitarios
- [ ] Configurar testes de integracao para API
- [ ] Configurar testes E2E para fluxos principais
- [ ] Configurar lint e typecheck no CI
- [ ] Adicionar logging estruturado
- [ ] Adicionar metricas de uso e erros
- [ ] Adicionar tracing basico nas rotas criticas
- [ ] Criar fixture local para schema MySQL de teste
- [ ] Criar smoke test para montar diagrama

---

## Fase 10 - Melhorias de Produto

Objetivo: evoluir de ferramenta tecnica para produto mais completo.

### Checklist

- [ ] onboarding para primeira conexao
- [ ] templates de conexao
- [ ] pagina de ajuda/atalhos
- [ ] favoritos/recentes
- [ ] compartilhamento de layouts
- [ ] exportacao de documentacao de schema
- [ ] comparacao entre ambientes
- [ ] IA para explicar schema e sugerir joins
- [ ] geracao de documentacao automatica por dominio

---

## Prioridade Recomendada

### Ordem sugerida

1. Fase 1 - Fundacao e Seguranca
2. Fase 2 - Conexoes e Catalogo
3. Fase 3 - Workspace Base Real
4. Fase 4 - Diagramas
5. Fase 5 - Editor SQL
6. Fase 6 - Explorer
7. Fase 8 - Persistencia de Preferencias
8. Fase 7 - Admin
9. Fase 9 - Observabilidade e Qualidade
10. Fase 10 - Melhorias de Produto

---

## Resumo do Que Hoje e So Menu

### Editor SQL

- status atual: funcional em modo read-only
- implementacao real: parcial

### Explorer

- status atual: placeholder
- implementacao real: nao existe

### Admin

- status atual: placeholder
- implementacao real: nao existe

### Detalhes do workspace

- status atual: parcialmente fake/demo
- implementacao real: nao consome dados reais da conexao

### Auditoria, schema update e historico

- status atual: botoes sem fluxo funcional
- implementacao real: nao existe

---

## Observacao Final

O projeto ja tem um nucleo promissor no modulo de diagrama e uma modelagem Prisma que antecipa evolucoes importantes. O maior ganho agora nao e adicionar mais abas visuais, e sim transformar cada menu em modulo funcional real, com seguranca, persistencia e operacao confiavel.

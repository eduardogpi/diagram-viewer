# Roadmap - Importador de Migrations e Diagramas por Snapshot

## Objetivo

Permitir que o workbench receba uma pasta de migrations de outro projeto (foco: **Flyway / SQL puro de projetos Java**), aplique as migrations em ordem para reconstruir o schema, e gere diagramas ER reutilizanto a infraestrutura existente de `DiagramScopeView`.

A saida deve oferecer tanto o **estado final do schema** quanto uma **timeline navegavel** entre snapshots de cada migration.

## Decisoes fechadas com o usuario

| Decisao | Valor |
|---|---|
| Origem das migrations | Upload de arquivos via UI |
| Formatos suportados | SQL puro arbitrario + Flyway (Java) |
| Saida do diagrama | Estado final + timeline navegavel entre snapshots |
| Integracao no produto | Nova aba no workspace, chamada `Migrations` |

## Por que e viavel hoje

- O diagrama atual ja parte de um DTO estavel: `DiagramResponse { nodes, edges, scopes }` em <ref_file file="/home/eduardo/projetos/meu-diagram-viewer/workbench-web/src/lib/types/diagram.ts" />. Basta construir um parser que produza o mesmo DTO a partir de SQL.
- O componente <ref_file file="/home/eduardo/projetos/meu-diagram-viewer/workbench-web/src/components/diagrams/DiagramScopeView.tsx" /> ja renderiza nodes/edges/scopes com React Flow, filtros, minimapa, fullscreen, etc. Reaproveitavel sem mudancas se o parser entregar o DTO certo.
- O workspace ja suporta multiplas abas via <ref_file file="/home/eduardo/projetos/meu-diagram-viewer/workbench-web/src/app/workspace/[connectionId]/page.tsx" /> — adicionar uma 5a aba `migrations` segue o mesmo padrao.
- Prisma + SQLite ja existem para persistir uploads e snapshots.

## Fora de escopo (inicialmente)

- Parser de migrations Laravel (PHP), Rails (Ruby) ou Django (Python). O parser de SQL puro cobre Flyway, golang-migrate, Flyway/Liquibase baseline SQL, Prisma SQL bruto.
- Liquibase XML/YAML (so SQL changelog inicialmente).
- Execucao das migrations em banco real — apenas simulacao em memoria para gerar o schema.
- Comparacao/diff entre snapshots (fica como evolucao futura, alinhado a Fase 4 avancada do IMPLEMENTATION_ROADMAP).

---

## Fase M1 - Parser de DDL SQL e DTO

Objetivo: transformar uma lista de arquivos `.sql` ordenados em um `DiagramResponse`.

### Checklist

- [ ] Definir `MigrationFile` e `MigrationSnapshot` em `src/lib/types/migrations.ts`
  - `MigrationFile { id, name, order, content, checksum }`
  - `MigrationSnapshot { migrationId, order, nodes, edges, scopes, createdAt }`
- [ ] Implementar `src/lib/services/migration-parser.ts`
  - Ordenar arquivos por nome (Flyway: `V1__desc.sql`, `V2__desc.sql`; fallback: ordem alfabetica)
  - Tokenizar DDL com `node-sql-parser` (ou `sql-parser-cst`) — avaliar licensa e tamanho
  - Suportar: `CREATE TABLE`, `ALTER TABLE` (add/drop/modify column, add/drop constraint, rename), `DROP TABLE`, `RENAME TABLE`, `CREATE INDEX`, `DROP INDEX`
  - Manter estado do schema entre migrations (acumular colunas, FKs, indices)
  - Produzir um `DiagramResponse` por migration (snapshot parcial) + um final
- [ ] Mapear tipos SQL (MySQL/Postgres/H2) para o `DiagramColumnDTO.type` generico
- [ ] Extrair FKs com `references`, `onDelete`, `onUpdate` e `constraintName`
- [ ] Derivar `scope` por prefixo de tabela (reusar `deriveScope` de `mysql-diagram.ts`)
- [ ] Calcular `checksum` por migration (sha256 do conteudo normalizado)
- [ ] Testes unitarios com fixtures de migrations Flyway reais (Java sample)

### Riscos

- DDL dialetos variam entre MySQL/Postgres/H2/Oracle. Mitigacao: parser tolerante + log de statements nao reconhecidos (NAO falhar o snapshot inteiro).
- `node-sql-parser` pode nao cobrir todos os dialetos. Mitigacao: comecar com MySQL + H2 (Flyway Java tipico), expandir depois.

### Entregaveis

- `migration-parser.ts` que recebe `MigrationFile[]` e devolve `MigrationSnapshot[]` + `DiagramResponse` final.

---

## Fase M2 - Upload e Persistencia

Objetivo: receber arquivos via UI e persistir para reuso entre sessoes.

### Checklist

- [ ] Novo model Prisma `MigrationPackage`
  - `id, connectionId, ownerId, name, sourceProvider (flyway|sql), fileCount, checksum, createdAt`
- [ ] Novo model Prisma `MigrationFile`
  - `id, packageId, order, name, content, checksum, createdAt`
  - relation `MigrationPackage 1—N MigrationFile`
- [ ] Novo model Prisma `MigrationSnapshot`
  - `id, packageId, migrationOrder, diagramJson, checksum, createdAt`
  - relation `MigrationPackage 1—N MigrationSnapshot`
- [ ] Prisma migration `YYYYMMDDHHMMSS_add_migration_packages`
- [ ] Rota `POST /api/migrations/[connectionId]/upload` (multipart, max ~10MB, validar zip/tar)
- [ ] Rota `GET /api/migrations/[connectionId]` → lista packages do usuario
- [ ] Rota `GET /api/migrations/[connectionId]/[packageId]` → packages + snapshots
- [ ] Rota `DELETE /api/migrations/[connectionId]/[packageId]`
- [ ] Validacao com Zod do payload e isolamento por `ownerId` (igual ao restante do sistema)
- [ ] Limite de tamanho e rejeicao de extensoes nao permitidas
- [ ] Auditoria em `AuditLog` (action `migrations.upload`, `migrations.delete`)

### Entregaveis

- API REST para upload/listagem/leitura/remocao de packages de migrations por conexao.

---

## Fase M3 - Aba Migrations no Workspace

Objetivo: expor a feature na UI como 5a aba do workspace.

### Checklist

- [ ] Adicionar `{ id: "migrations", label: "Migrations", description: "Importar migrations e gerar diagramas do schema." }` em `tabs` do `page.tsx`
- [ ] Criar `src/components/migrations/MigrationsWorkbench.tsx`
  - Estado vazio com dropzone para upload (zip ou multiplos .sql)
  - Lista de packages importados (nome, qtd arquivos, data, checksum)
  - Acao de remover e reprocessar
- [ ] Ao selecionar um package, chamar `GET /api/migrations/.../[packageId]` e montar timeline
- [ ] Integrar `react-dropzone` (nova dependencia) para o upload
- [ ] Reusar `WorkspaceTabs` e o padrao visual das outras abas
- [ ] Loading state e empty state consistentes com Fase 3 do IMPLEMENTATION_ROADMAP

### Entregaveis

- Aba `Migrations` funcional com upload e listagem de packages.

---

## Fase M4 - Diagrama do Estado Final

Objetivo: renderizar o schema final do package importado reaproveitando `DiagramScopeView`.

### Checklist

- [ ] Rota `GET /api/migrations/[connectionId]/[packageId]/diagram` → retorna `DiagramResponse` do snapshot final
- [ ] Componente `MigrationDiagramView` wrapper que chama a rota e repassa para `DiagramScopeView`
- [ ] Filtros por escopo/tabela funcionam igual ao diagrama MySQL (ja vem do DTO)
- [ ] Exportacao JSON (ja existe em DiagramScopeView)
- [ ] Indicador visual de origem: "Diagrama gerado de migrations (Flyway)" vs "Diagrama ao vivo (MySQL)"
- [ ] Tratar packages sem FKs explicitas (diagrama so com tabelas)

### Entregaveis

- Diagrama ER do schema final renderizado a partir das migrations.

---

## Fase M5 - Timeline Navegavel entre Snapshots

Objetivo: permitir navegar migration por migration e ver o schema evoluir.

### Checklist

- [ ] Barra horizontal de timeline com um marcador por migration (ordem + nome curto)
- [ ] Ao clicar em um marcador, carregar o snapshot correspondente e re-renderizar o canvas
- [ ] Modo "diff" opcional: destacar tabelas/colunas adicionadas/alteradas/removidas desde o snapshot anterior
  - Reusar logica de `deriveScope` e comparar `nodes`/`edges` por id
  - Cor: verde = adicionado, ambar = alterado, vermelho = removido
- [ ] Controles: play/pause para avancar automaticamente entre snapshots
- [ ] Persistir ultimo snapshot visualizado em `WorkspacePreference` (novo campo `lastMigrationSnapshotId`)
- [ ] Prisma migration para adicionar campo em `WorkspacePreference`
- [ ] Indicador de migration com parse warning (statements nao reconhecidos)

### Entregaveis

- Timeline navegavel + modo diff visual entre snapshots consecutivos.

---

## Fase M6 - Robustez e Qualidade

Objetivo: tornar o parser confiavel para projetos Java reais.

### Checklist

- [ ] Fixture com migrations Flyway de projeto Java open-source conhecido (ex: Spring Petclinic)
- [ ] Testes unitarios do parser cobrindo: CREATE, ALTER add/drop/modify, RENAME, DROP, FKs, indices, tipos variados
- [ ] Testes de integracao da rota de upload com zip real
- [ ] Relatorio de statements nao suportados por migration (visivel na UI)
- [ ] Suporte a `CREATE TABLE ... LIKE`, `CREATE TABLE ... AS SELECT` (baseline)
- [ ] Suporte a Flyway callbacks/Java migrations (marcar como "nao parseavel, pulado")
- [ ] Limite de memoria para packages muito grandes (>200 arquivos)
- [ ] Cache do snapshot final em disco para evitar reparse

### Entregaveis

- Parser testado e tolerante a dialetos variados de projetos Java/Flyway.

---

## Prioridade Recomendada

1. **M1** — Parser (coracao da feature, sem UI)
2. **M2** — Upload + persistencia
3. **M3** — Aba no workspace
4. **M4** — Diagrama final (primeiro valor visivel)
5. **M5** — Timeline (diferencial do produto)
6. **M6** — Robustez

M1 + M4 ja entregam valor minimo viavel (upload + diagrama final). M5 e o que diferencia do diagrama atual via INFORMATION_SCHEMA.

---

## Dependencias novas sugeridas

| Pacote | Uso | Licenca |
|---|---|---|
| `node-sql-parser` | Parse de DDL SQL multi-dialeto | Apache-2.0 |
| `react-dropzone` | Upload via drag-and-drop | MIT |
| `adm-zip` ou `unzipper` | Descompactar uploads zip | MIT |

Validar versoes publicadas ha >7 dias antes de adicionar ao `package.json`.

---

## Notas de Integracao com o IMPLEMENTATION_ROADMAP

- Esta feature nao conflita com as Fases 6-10 do roadmap principal.
- Reaproveita `DiagramScopeView`, `WorkspaceTabs`, `AuditLog`, `WorkspacePreference` e o padrao de isolamento por `ownerId`.
- Pode ser tratada como uma Fase paralela (ex: "Fase 4b") ou como parte da Fase 4 (Diagramas) do roadmap principal.
- O parser de DDL e reutilizavel futuramente para diff entre ambientes (Fase 4 avancada) e comparacao de schemas.

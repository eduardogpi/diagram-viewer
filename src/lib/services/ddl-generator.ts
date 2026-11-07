import { applySchemaOps, type SchemaOp } from "@/lib/services/schema-ops";
import type { DiagramEdgeDTO, DiagramNodeDTO, DiagramResponse } from "@/lib/types/diagram";

/**
 * Gera DDL a partir do modelo canônico (`DiagramResponse`) — o caminho inverso do
 * `migration-parser`, que lê SQL e produz o diagrama.
 *
 * O modelo já é dialeto-agnóstico por construção (o prompt da IA proíbe sintaxe específica de
 * um banco), então aqui só resta traduzir os tipos que divergem, aplicar o quoting certo e
 * ordenar as tabelas para que nenhuma FK aponte para algo que ainda não existe.
 */

export const ddlDialects = ["mysql", "postgres"] as const;
export type DdlDialect = (typeof ddlDialects)[number];

export function isDdlDialect(value: string): value is DdlDialect {
  return (ddlDialects as readonly string[]).includes(value);
}

export type GenerateDdlOptions = {
  dialect: DdlDialect;
  /** Nome do banco/schema a criar antes das tabelas. Omitido = só as tabelas. */
  databaseName?: string;
  /** Cabeçalho de comentário (ex: nome da modelagem de origem). */
  title?: string;
};

export type GenerateDeltaDdlOptions = GenerateDdlOptions & {
  /** Diagrama base antes das operações (default: modelo vazio). */
  baseDiagram?: DiagramResponse;
};

/** Tipos que mudam de nome entre os bancos. O que não estiver aqui passa direto. */
const TYPE_MAP: Record<DdlDialect, Record<string, string>> = {
  mysql: {
    BYTEA: "BLOB",
    JSONB: "JSON",
    "DOUBLE PRECISION": "DOUBLE",
    TIMESTAMPTZ: "TIMESTAMP",
    SERIAL: "BIGINT",
    BIGSERIAL: "BIGINT",
    UUID: "CHAR(36)",
  },
  postgres: {
    DATETIME: "TIMESTAMP",
    BLOB: "BYTEA",
    JSON: "JSONB",
    DOUBLE: "DOUBLE PRECISION",
    "TINYINT(1)": "BOOLEAN",
    TINYINT: "SMALLINT",
    MEDIUMINT: "INTEGER",
    "MEDIUMTEXT": "TEXT",
    "LONGTEXT": "TEXT",
    DATETIME2: "TIMESTAMP",
  },
};

function quote(identifier: string, dialect: DdlDialect): string {
  return dialect === "mysql" ? `\`${identifier}\`` : `"${identifier}"`;
}

/** Literal de string SQL com escape do dialeto (MySQL também interpreta barra invertida). */
function sqlString(value: string, dialect: DdlDialect): string {
  const escaped = dialect === "mysql" ? value.replace(/\\/g, "\\\\").replace(/'/g, "''") : value.replace(/'/g, "''");
  return `'${escaped}'`;
}

/** Sufixo inline `COMMENT '...'` de coluna — só existe no MySQL; no Postgres vira COMMENT ON. */
function mysqlColumnComment(comment: string | undefined, dialect: DdlDialect): string {
  return dialect === "mysql" && comment ? `COMMENT ${sqlString(comment, dialect)}` : "";
}

/** `COMMENT ON TABLE/COLUMN` do Postgres. `comment` vazio/undefined remove (IS NULL). */
function postgresComment(target: string, comment: string | undefined): string {
  return `COMMENT ON ${target} IS ${comment ? sqlString(comment, "postgres") : "NULL"};`;
}

/** Statements de comentário de uma tabela recém-criada (Postgres; no MySQL vão inline). */
function postgresTableComments(node: DiagramNodeDTO, tableName: string): string[] {
  const out: string[] = [];
  if (node.comment) out.push(postgresComment(`TABLE ${quote(tableName, "postgres")}`, node.comment));
  for (const column of node.columns) {
    if (column.comment) {
      out.push(
        postgresComment(`COLUMN ${quote(tableName, "postgres")}.${quote(column.name, "postgres")}`, column.comment)
      );
    }
  }
  return out;
}

/** Normaliza o tipo declarado no modelo para o dialeto alvo, preservando precisão (ex: VARCHAR(30)). */
export function mapType(rawType: string, dialect: DdlDialect): string {
  const type = rawType.trim();
  const upper = type.toUpperCase();
  const map = TYPE_MAP[dialect];

  if (map[upper]) return map[upper];

  // Tipos com precisão: mapeia só a base e devolve os parênteses originais.
  const match = /^([A-Z_ ]+?)\s*(\([^)]*\))$/.exec(upper);
  if (match) {
    const base = match[1].trim();
    if (map[base]) {
      // Bases que viram tipo sem precisão (TEXT, BOOLEAN) descartam os parênteses.
      const mapped = map[base];
      return /TEXT|BOOLEAN|BYTEA|JSONB?/.test(mapped) ? mapped : `${mapped}${match[2]}`;
    }
    return `${base}${match[2]}`;
  }

  return upper;
}

/**
 * Nome de tabela a usar no DDL. Normalmente é o `label` (nome real). Quando o modelo reúne
 * sistemas diferentes e dois escopos têm tabelas homônimas, cai para o id qualificado
 * ("projeto-a.users" -> "projeto_a_users") para não colidir no mesmo banco.
 */
function tableNames(nodes: DiagramNodeDTO[]): Map<string, string> {
  const labelCount = new Map<string, number>();
  for (const node of nodes) {
    labelCount.set(node.label, (labelCount.get(node.label) ?? 0) + 1);
  }

  return new Map(
    nodes.map((node) => [
      node.id,
      (labelCount.get(node.label) ?? 0) > 1 ? node.id.replace(/[.\s]+/g, "_") : node.label,
    ])
  );
}

/**
 * Ordena as tabelas para que cada FK aponte para uma tabela já criada. Ciclos (A -> B -> A) não
 * têm ordem válida: as tabelas envolvidas saem na ordem original e as FKs que fecham o ciclo
 * são devolvidas em `deferred`, para virarem ALTER TABLE no fim do script.
 */
export function sortTablesByDependency(
  nodes: DiagramNodeDTO[],
  edges: DiagramEdgeDTO[]
): { ordered: DiagramNodeDTO[]; deferred: DiagramEdgeDTO[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dependencies = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));

  for (const edge of edges) {
    // Auto-referência não impede a criação da tabela.
    if (edge.source === edge.target) continue;
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    dependencies.get(edge.source)?.add(edge.target);
  }

  const ordered: DiagramNodeDTO[] = [];
  const placed = new Set<string>();

  // Kahn simplificado: a cada passada emite quem já tem todas as dependências resolvidas.
  let progress = true;
  while (progress && placed.size < nodes.length) {
    progress = false;
    for (const node of nodes) {
      if (placed.has(node.id)) continue;
      const deps = dependencies.get(node.id) ?? new Set();
      if (Array.from(deps).every((dep) => placed.has(dep))) {
        ordered.push(node);
        placed.add(node.id);
        progress = true;
      }
    }
  }

  // Sobrou algo = ciclo. Emite na ordem original e adia as FKs que apontam para o restante.
  const deferred: DiagramEdgeDTO[] = [];
  if (placed.size < nodes.length) {
    for (const node of nodes) {
      if (placed.has(node.id)) continue;
      ordered.push(node);
      placed.add(node.id);
    }
    for (const edge of edges) {
      if (edge.source === edge.target) continue;
      if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
      const sourceIndex = ordered.findIndex((n) => n.id === edge.source);
      const targetIndex = ordered.findIndex((n) => n.id === edge.target);
      if (targetIndex > sourceIndex) deferred.push(edge);
    }
  }

  return { ordered, deferred };
}

function referentialAction(action: string | undefined): string {
  if (!action) return "";
  const normalized = action.trim().toUpperCase();
  return ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION"].includes(normalized)
    ? normalized
    : "";
}

function foreignKeyClause(
  edge: DiagramEdgeDTO,
  names: Map<string, string>,
  dialect: DdlDialect
): string {
  const sourceColumns = edge.columns.map((c) => quote(c.source, dialect)).join(", ");
  const targetColumns = edge.columns.map((c) => quote(c.target, dialect)).join(", ");
  const onDelete = referentialAction(edge.onDelete);
  const onUpdate = referentialAction(edge.onUpdate);

  return [
    `CONSTRAINT ${quote(edge.constraint, dialect)} FOREIGN KEY (${sourceColumns})`,
    `REFERENCES ${quote(names.get(edge.target) ?? edge.target, dialect)} (${targetColumns})`,
    onDelete ? `ON DELETE ${onDelete}` : "",
    onUpdate ? `ON UPDATE ${onUpdate}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function generateDdl(diagram: DiagramResponse, options: GenerateDdlOptions): string {
  const { dialect, databaseName, title } = options;
  const nodes = diagram.nodes;

  if (nodes.length === 0) {
    return "-- Modelo vazio: nada para exportar.\n";
  }

  const names = tableNames(nodes);
  const { ordered, deferred } = sortTablesByDependency(nodes, diagram.edges);
  const deferredIds = new Set(deferred.map((e) => e.id));

  const lines: string[] = [];
  lines.push(`-- ${title ? `${title} — ` : ""}gerado pelo workbench (${dialect})`);
  lines.push(`-- ${ordered.length} tabela(s), ${diagram.edges.length} foreign key(s)`);
  lines.push("");

  if (databaseName) {
    if (dialect === "mysql") {
      lines.push(`CREATE DATABASE IF NOT EXISTS ${quote(databaseName, dialect)};`);
      lines.push(`USE ${quote(databaseName, dialect)};`);
    } else {
      // CREATE DATABASE no Postgres não roda dentro de transação nem aceita "USE": o
      // equivalente prático dentro de uma conexão é um schema com search_path.
      lines.push(`-- No Postgres, "CREATE DATABASE ${databaseName}" precisa rodar fora deste script.`);
      lines.push(`CREATE SCHEMA IF NOT EXISTS ${quote(databaseName, dialect)};`);
      lines.push(`SET search_path TO ${quote(databaseName, dialect)};`);
    }
    lines.push("");
  }

  for (const node of ordered) {
    const tableName = names.get(node.id) ?? node.label;
    const body: string[] = [];

    for (const column of node.columns) {
      const parts = [
        `  ${quote(column.name, dialect)} ${mapType(column.type, dialect)}`,
        column.isNullable ? "" : "NOT NULL",
        column.isUnique && !column.isPrimary ? "UNIQUE" : "",
        mysqlColumnComment(column.comment, dialect),
      ].filter(Boolean);
      body.push(parts.join(" "));
    }

    const primaryKeys = node.columns.filter((c) => c.isPrimary);
    if (primaryKeys.length > 0) {
      body.push(`  PRIMARY KEY (${primaryKeys.map((c) => quote(c.name, dialect)).join(", ")})`);
    }

    for (const edge of diagram.edges) {
      if (edge.source !== node.id || deferredIds.has(edge.id)) continue;
      body.push(`  ${foreignKeyClause(edge, names, dialect)}`);
    }

    lines.push(`CREATE TABLE ${quote(tableName, dialect)} (`);
    lines.push(body.join(",\n"));
    lines.push(dialect === "mysql" && node.comment ? `) COMMENT=${sqlString(node.comment, dialect)};` : ");");
    if (dialect === "postgres") lines.push(...postgresTableComments(node, tableName));
    if (node.indexes && node.indexes.length > 0) {
      for (const idx of node.indexes) {
        const colsList = idx.columns.map((c) => quote(c, dialect)).join(", ");
        lines.push(
          `CREATE ${idx.isUnique ? "UNIQUE " : ""}INDEX ${quote(idx.name, dialect)} ON ${quote(tableName, dialect)} (${colsList});`
        );
      }
    }
    lines.push("");
  }

  if (deferred.length > 0) {
    lines.push("-- Foreign keys que fecham ciclos entre tabelas, adicionadas depois da criação.");
    for (const edge of deferred) {
      const tableName = names.get(edge.source) ?? edge.source;
      lines.push(`ALTER TABLE ${quote(tableName, dialect)} ADD ${foreignKeyClause(edge, names, dialect)};`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function findNodeForDdl(nodes: DiagramNodeDTO[], tableRef: string): DiagramNodeDTO | undefined {
  const lower = tableRef.toLowerCase();
  const exact = nodes.find((n) => n.id === tableRef) ?? nodes.find((n) => n.id.toLowerCase() === lower);
  if (exact) return exact;
  const suffix = (id: string) => {
    const dot = id.lastIndexOf(".");
    return dot > 0 ? id.slice(dot + 1) : id;
  };
  const matches = nodes.filter(
    (n) => n.label.toLowerCase() === lower || suffix(n.id).toLowerCase() === lower
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function dropFkStatement(tableName: string, constraintName: string, dialect: DdlDialect): string {
  const clause = dialect === "mysql" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT";
  return `ALTER TABLE ${quote(tableName, dialect)} ${clause} ${quote(constraintName, dialect)};`;
}

/**
 * Gera um slug curto descritivo a partir de uma lista de operações de schema,
 * ideal para nomear arquivos de migration Flyway (`V2__add_cpf_to_clientes.sql`).
 */
export function inferMigrationSlug(operations: SchemaOp[], fallback = "migration"): string {
  const clean = (val: string) =>
    val
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();

  if (operations.length === 0) return clean(fallback) || "migration";

  if (operations.length === 1) {
    const op = operations[0];
    switch (op.op) {
      case "createTable":
        return clean(`create_${op.table}`);
      case "addColumn":
        return clean(`add_${op.newColumn.name}_to_${op.table}`);
      case "alterColumn":
        return clean(`alter_${op.column}_on_${op.table}`);
      case "dropColumn":
        return clean(`drop_${op.column}_from_${op.table}`);
      case "renameColumn":
        return clean(`rename_${op.column}_to_${op.newName}_on_${op.table}`);
      case "addForeignKey":
        return clean(`add_fk_${op.table}_${op.column}`);
      case "dropForeignKey":
        return clean(`drop_fk_${op.table}_${op.column}`);
      case "dropTable":
        return clean(`drop_${op.table}`);
      case "renameTable":
        return clean(`rename_${op.table}_to_${op.newName}`);
      case "createIndex":
        return clean(`create_idx_${op.table}_${op.columns.join("_")}`);
      case "dropIndex":
        return clean(`drop_idx_${op.name}_on_${op.table}`);
      case "setComment":
        return clean(`comment_${op.column ? `${op.column}_on_` : ""}${op.table}`);
    }
  }

  const created = operations.filter((op): op is Extract<SchemaOp, { op: "createTable" }> => op.op === "createTable");
  if (created.length === operations.length && created.length <= 3) {
    return clean(`create_${created.map((c) => c.table).join("_")}`);
  }

  const touchedTables = Array.from(new Set(operations.map((op) => op.table)));
  if (touchedTables.length === 1) {
    return clean(`alter_${touchedTables[0]}`);
  }
  if (touchedTables.length <= 3) {
    return clean(`update_${touchedTables.join("_")}`);
  }

  return clean(fallback) || "migration";
}

/**
 * Gera DDL incremental (migration `ALTER TABLE` / `CREATE TABLE` / `DROP`) reproduzindo passo a
 * passo as operações estruturadas sobre `baseDiagram`. Operações rejeitadas por `applySchemaOps`
 * (ex: coluna inexistente) são ignoradas para que o script emitido seja sempre consistente.
 */
export function generateDeltaDdl(operations: SchemaOp[], options: GenerateDeltaDdlOptions): string {
  const { dialect, databaseName, title, baseDiagram } = options;
  let running: DiagramResponse = baseDiagram ?? { nodes: [], edges: [], scopes: [] };

  const statements: string[] = [];
  let appliedCount = 0;

  for (const op of operations) {
    const beforeNodes = running.nodes;
    const beforeEdges = running.edges;
    const beforeNames = tableNames(beforeNodes);

    const step = applySchemaOps(running, [op]);
    if (step.warnings.length > 0) {
      continue;
    }

    const afterNodes = step.next.nodes;
    const afterEdges = step.next.edges;
    const afterNames = tableNames(afterNodes);

    switch (op.op) {
      case "createTable": {
        const created = findNodeForDdl(afterNodes, op.table);
        if (!created) break;
        const tableName = afterNames.get(created.id) ?? created.label;
        const body: string[] = [];
        for (const column of created.columns) {
          const parts = [
            `  ${quote(column.name, dialect)} ${mapType(column.type, dialect)}`,
            column.isNullable ? "" : "NOT NULL",
            column.isUnique && !column.isPrimary ? "UNIQUE" : "",
            mysqlColumnComment(column.comment, dialect),
          ].filter(Boolean);
          body.push(parts.join(" "));
        }
        const primaryKeys = created.columns.filter((c) => c.isPrimary);
        if (primaryKeys.length > 0) {
          body.push(`  PRIMARY KEY (${primaryKeys.map((c) => quote(c.name, dialect)).join(", ")})`);
        }
        const tableSuffix = dialect === "mysql" && created.comment ? ` COMMENT=${sqlString(created.comment, dialect)}` : "";
        statements.push(`CREATE TABLE ${quote(tableName, dialect)} (\n${body.join(",\n")}\n)${tableSuffix};`);
        if (dialect === "postgres") statements.push(...postgresTableComments(created, tableName));
        appliedCount += 1;
        break;
      }

      case "addColumn": {
        const target = findNodeForDdl(afterNodes, op.table);
        const col = target?.columns.find((c) => c.name.toLowerCase() === op.newColumn.name.toLowerCase());
        if (!target || !col) break;
        const tableName = afterNames.get(target.id) ?? target.label;
        const parts = [
          `ALTER TABLE ${quote(tableName, dialect)} ADD COLUMN ${quote(col.name, dialect)} ${mapType(col.type, dialect)}`,
          col.isNullable ? "" : "NOT NULL",
          col.isPrimary ? "PRIMARY KEY" : col.isUnique ? "UNIQUE" : "",
          mysqlColumnComment(col.comment, dialect),
        ].filter(Boolean);
        statements.push(`${parts.join(" ")};`);
        if (dialect === "postgres" && col.comment) {
          statements.push(
            postgresComment(`COLUMN ${quote(tableName, dialect)}.${quote(col.name, dialect)}`, col.comment)
          );
        }
        appliedCount += 1;
        break;
      }

      case "alterColumn": {
        const beforeNode = findNodeForDdl(beforeNodes, op.table);
        const beforeCol = beforeNode?.columns.find((c) => c.name.toLowerCase() === op.column.toLowerCase());
        const afterNode = findNodeForDdl(afterNodes, op.table);
        const lookupName = op.newName ?? op.column;
        const afterCol = afterNode?.columns.find((c) => c.name.toLowerCase() === lookupName.toLowerCase());
        if (!afterNode || !afterCol) break;
        const tableName = afterNames.get(afterNode.id) ?? afterNode.label;

        if (beforeCol && op.newName && beforeCol.name !== afterCol.name) {
          statements.push(
            `ALTER TABLE ${quote(tableName, dialect)} RENAME COLUMN ${quote(beforeCol.name, dialect)} TO ${quote(afterCol.name, dialect)};`
          );
        }

        const hasAttrChange =
          op.type !== undefined || op.isNullable !== undefined || op.isPrimary !== undefined || op.isUnique !== undefined;
        const commentChanged = op.comment !== undefined && (beforeCol?.comment ?? "") !== (afterCol.comment ?? "");

        if (hasAttrChange || (commentChanged && dialect === "mysql")) {
          if (dialect === "mysql") {
            // MODIFY COLUMN redefine a coluna inteira: sem repetir o COMMENT, o MySQL o apagaria.
            const parts = [
              `ALTER TABLE ${quote(tableName, dialect)} MODIFY COLUMN ${quote(afterCol.name, dialect)} ${mapType(afterCol.type, dialect)}`,
              afterCol.isNullable ? "NULL" : "NOT NULL",
              op.isPrimary === true && !beforeCol?.isPrimary ? "PRIMARY KEY" : "",
              op.isUnique === true && !beforeCol?.isUnique ? "UNIQUE" : "",
              mysqlColumnComment(afterCol.comment, dialect),
            ].filter(Boolean);
            statements.push(`${parts.join(" ")};`);
          } else {
            if (op.type !== undefined) {
              statements.push(
                `ALTER TABLE ${quote(tableName, dialect)} ALTER COLUMN ${quote(afterCol.name, dialect)} TYPE ${mapType(afterCol.type, dialect)};`
              );
            }
            if (op.isNullable !== undefined) {
              statements.push(
                `ALTER TABLE ${quote(tableName, dialect)} ALTER COLUMN ${quote(afterCol.name, dialect)} ${afterCol.isNullable ? "DROP NOT NULL" : "SET NOT NULL"};`
              );
            }
            if (op.isPrimary === true && !beforeCol?.isPrimary) {
              statements.push(
                `ALTER TABLE ${quote(tableName, dialect)} ADD PRIMARY KEY (${quote(afterCol.name, dialect)});`
              );
            }
            if (op.isUnique === true && !beforeCol?.isUnique) {
              statements.push(
                `ALTER TABLE ${quote(tableName, dialect)} ADD UNIQUE (${quote(afterCol.name, dialect)});`
              );
            }
          }
        }
        if (commentChanged && dialect === "postgres") {
          statements.push(
            postgresComment(`COLUMN ${quote(tableName, dialect)}.${quote(afterCol.name, dialect)}`, afterCol.comment)
          );
        }
        appliedCount += 1;
        break;
      }

      case "dropColumn": {
        const beforeNode = findNodeForDdl(beforeNodes, op.table);
        if (!beforeNode) break;
        const tableName = beforeNames.get(beforeNode.id) ?? beforeNode.label;
        for (const edge of beforeEdges) {
          if (edge.source === beforeNode.id && edge.columns.some((c) => c.source === op.column)) {
            statements.push(dropFkStatement(tableName, edge.constraint, dialect));
          } else if (edge.target === beforeNode.id && edge.columns.some((c) => c.target === op.column)) {
            const sourceName = beforeNames.get(edge.source) ?? edge.source;
            statements.push(dropFkStatement(sourceName, edge.constraint, dialect));
          }
        }
        statements.push(`ALTER TABLE ${quote(tableName, dialect)} DROP COLUMN ${quote(op.column, dialect)};`);
        appliedCount += 1;
        break;
      }

      case "renameColumn": {
        const afterNode = findNodeForDdl(afterNodes, op.table);
        if (!afterNode) break;
        const tableName = afterNames.get(afterNode.id) ?? afterNode.label;
        statements.push(
          `ALTER TABLE ${quote(tableName, dialect)} RENAME COLUMN ${quote(op.column, dialect)} TO ${quote(op.newName, dialect)};`
        );
        appliedCount += 1;
        break;
      }

      case "addForeignKey": {
        const sourceNode = findNodeForDdl(afterNodes, op.table);
        if (!sourceNode) break;
        const addedEdge = afterEdges.find(
          (e) => e.source === sourceNode.id && e.columns.some((c) => c.source === op.column)
        );
        if (!addedEdge) break;
        const tableName = afterNames.get(sourceNode.id) ?? sourceNode.label;
        statements.push(
          `ALTER TABLE ${quote(tableName, dialect)} ADD ${foreignKeyClause(addedEdge, afterNames, dialect)};`
        );
        appliedCount += 1;
        break;
      }

      case "dropForeignKey": {
        const beforeNode = findNodeForDdl(beforeNodes, op.table);
        if (!beforeNode) break;
        const tableName = beforeNames.get(beforeNode.id) ?? beforeNode.label;
        const removedEdges = beforeEdges.filter(
          (e) => e.source === beforeNode.id && e.columns.some((c) => c.source === op.column)
        );
        for (const edge of removedEdges) {
          statements.push(dropFkStatement(tableName, edge.constraint, dialect));
        }
        if (removedEdges.length > 0) appliedCount += 1;
        break;
      }

      case "dropTable": {
        const beforeNode = findNodeForDdl(beforeNodes, op.table);
        if (!beforeNode) break;
        const tableName = beforeNames.get(beforeNode.id) ?? beforeNode.label;
        for (const edge of beforeEdges) {
          if (edge.target === beforeNode.id && edge.source !== beforeNode.id) {
            const sourceName = beforeNames.get(edge.source) ?? edge.source;
            statements.push(dropFkStatement(sourceName, edge.constraint, dialect));
          }
        }
        statements.push(`DROP TABLE ${quote(tableName, dialect)};`);
        appliedCount += 1;
        break;
      }

      case "renameTable": {
        const beforeNode = findNodeForDdl(beforeNodes, op.table);
        const afterNode = findNodeForDdl(afterNodes, op.newName);
        if (!beforeNode || !afterNode) break;
        const oldTableName = beforeNames.get(beforeNode.id) ?? beforeNode.label;
        const newTableName = afterNames.get(afterNode.id) ?? afterNode.label;
        if (dialect === "mysql") {
          statements.push(`RENAME TABLE ${quote(oldTableName, dialect)} TO ${quote(newTableName, dialect)};`);
        } else {
          statements.push(`ALTER TABLE ${quote(oldTableName, dialect)} RENAME TO ${quote(newTableName, dialect)};`);
        }
        appliedCount += 1;
        break;
      }

      case "createIndex": {
        const afterNode = findNodeForDdl(afterNodes, op.table);
        if (!afterNode) break;
        const tableName = afterNames.get(afterNode.id) ?? afterNode.label;
        const idxName =
          op.name?.trim() ||
          `${op.isUnique ? "uq" : "idx"}_${afterNode.label}_${op.columns.join("_")}`.replace(/[^A-Za-z0-9_]+/g, "_");
        const colsList = op.columns.map((c) => quote(c, dialect)).join(", ");
        statements.push(
          `CREATE ${op.isUnique ? "UNIQUE " : ""}INDEX ${quote(idxName, dialect)} ON ${quote(tableName, dialect)} (${colsList});`
        );
        appliedCount += 1;
        break;
      }

      case "setComment": {
        const afterNode = findNodeForDdl(afterNodes, op.table);
        if (!afterNode) break;
        const tableName = afterNames.get(afterNode.id) ?? afterNode.label;
        if (op.column) {
          const col = afterNode.columns.find((c) => c.name.toLowerCase() === op.column!.toLowerCase());
          if (!col) break;
          if (dialect === "mysql") {
            statements.push(
              [
                `ALTER TABLE ${quote(tableName, dialect)} MODIFY COLUMN ${quote(col.name, dialect)} ${mapType(col.type, dialect)}`,
                col.isNullable ? "NULL" : "NOT NULL",
                // Sem comentário, `COMMENT ''` deixa explícita a remoção.
                col.comment ? mysqlColumnComment(col.comment, dialect) : "COMMENT ''",
              ].join(" ") + ";"
            );
          } else {
            statements.push(
              postgresComment(`COLUMN ${quote(tableName, dialect)}.${quote(col.name, dialect)}`, col.comment)
            );
          }
        } else if (dialect === "mysql") {
          statements.push(`ALTER TABLE ${quote(tableName, dialect)} COMMENT = ${sqlString(afterNode.comment ?? "", dialect)};`);
        } else {
          statements.push(postgresComment(`TABLE ${quote(tableName, dialect)}`, afterNode.comment));
        }
        appliedCount += 1;
        break;
      }

      case "dropIndex": {
        const beforeNode = findNodeForDdl(beforeNodes, op.table);
        if (!beforeNode) break;
        const tableName = beforeNames.get(beforeNode.id) ?? beforeNode.label;
        if (dialect === "mysql") {
          statements.push(`DROP INDEX ${quote(op.name, dialect)} ON ${quote(tableName, dialect)};`);
        } else {
          statements.push(`DROP INDEX IF EXISTS ${quote(op.name, dialect)};`);
        }
        appliedCount += 1;
        break;
      }
    }

    running = step.next;
  }

  if (statements.length === 0) {
    return "-- Nenhuma alteração incremental para exportar.\n";
  }

  const lines: string[] = [];
  lines.push(`-- ${title ? `${title} — ` : ""}migration incremental gerada pelo workbench (${dialect})`);
  lines.push(`-- ${appliedCount} operação(ões) aplicada(s)`);
  lines.push("");

  if (databaseName) {
    if (dialect === "mysql") {
      lines.push(`USE ${quote(databaseName, dialect)};`);
    } else {
      lines.push(`SET search_path TO ${quote(databaseName, dialect)};`);
    }
    lines.push("");
  }

  lines.push(...statements);
  lines.push("");
  return lines.join("\n");
}

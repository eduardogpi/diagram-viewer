import type { ColumnChangeDetail, DiffableColumn, DiffableDiagram, DiffableNode } from "@/lib/diagram-diff";

export type TableDriftItem = {
  tableId: string;
  expectedTableId: string;
  actualTableId: string;
  columns: ColumnChangeDetail[];
};

export type SchemaDriftReport = {
  inSync: boolean;
  /** Tabelas que existem no modelo/migrations esperado, mas NÃO existem no banco/alvo comparado. */
  missingInActual: string[];
  /** Tabelas que existem no banco/alvo comparado, mas NÃO constam nas migrations/modelo esperado. */
  extraInActual: string[];
  /** Tabelas presentes em ambos, porém com divergência em colunas, tipos, nullability, PK ou FK. */
  driftedTables: TableDriftItem[];
  /** Script SQL sugerido para reconciliar o banco alvo (`actual`) com o schema esperado (`expected`). */
  reconcileSql?: string;
};

/**
 * Normaliza tipos equivalentes entre dialetos SQL e introspecção de catálogo
 * (ex: `INT(11)` / `INTEGER` → `INT`, `CHARACTER VARYING(100)` → `VARCHAR(100)`, `BIGINT(20)` → `BIGINT`).
 */
export function normalizeSqlTypeForDrift(rawType: string): string {
  const upper = rawType
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\bUNSIGNED\b/g, "")
    .trim();

  if (/^CHARACTER VARYING\s*\(/.test(upper)) {
    return upper.replace(/^CHARACTER VARYING\s*/, "VARCHAR");
  }
  if (upper === "CHARACTER VARYING") return "VARCHAR";

  if (/^CHARACTER\s*\(/.test(upper)) {
    return upper.replace(/^CHARACTER\s*/, "CHAR");
  }
  if (upper === "CHARACTER") return "CHAR";

  if (/^(INT|INTEGER|INT4)\s*(\(\d+\))?$/.test(upper) || upper === "SERIAL") {
    return "INT";
  }
  if (/^(BIGINT|INT8)\s*(\(\d+\))?$/.test(upper) || upper === "BIGSERIAL") {
    return "BIGINT";
  }
  if (/^(SMALLINT|INT2)\s*(\(\d+\))?$/.test(upper) || upper === "SMALLSERIAL") {
    return "SMALLINT";
  }
  if (/^(TINYINT\(1\)|BOOL|BOOLEAN)$/.test(upper)) {
    return "BOOLEAN";
  }
  if (/^NUMERIC\s*\(/.test(upper)) {
    return upper.replace(/^NUMERIC\s*/, "DECIMAL");
  }
  if (upper === "NUMERIC") return "DECIMAL";
  if (/^TIMESTAMP WITHOUT TIME ZONE/.test(upper)) {
    return "TIMESTAMP";
  }
  if (/^TIMESTAMP WITH TIME ZONE/.test(upper)) {
    return "TIMESTAMPTZ";
  }

  return upper;
}

function bareTableName(idOrLabel: string): string {
  const idx = idOrLabel.lastIndexOf(".");
  return (idx >= 0 ? idOrLabel.slice(idx + 1) : idOrLabel).toLowerCase();
}

function compareDriftColumns(expectedNode: DiffableNode, actualNode: DiffableNode): ColumnChangeDetail[] {
  const expectedByLower = new Map<string, DiffableColumn>();
  for (const col of expectedNode.columns) {
    expectedByLower.set(col.name.toLowerCase(), col);
  }

  const actualByLower = new Map<string, DiffableColumn>();
  for (const col of actualNode.columns) {
    actualByLower.set(col.name.toLowerCase(), col);
  }

  const details: ColumnChangeDetail[] = [];

  // Colunas presentes no esperado (migrations/modelo)
  for (const expCol of expectedNode.columns) {
    const actCol = actualByLower.get(expCol.name.toLowerCase());
    if (!actCol) {
      details.push({
        name: expCol.name,
        status: "removed",
        changes: [`ausente no banco (esperado: ${expCol.type})`],
        previousType: expCol.type,
      });
      continue;
    }

    const changes: string[] = [];
    if (normalizeSqlTypeForDrift(expCol.type) !== normalizeSqlTypeForDrift(actCol.type)) {
      changes.push(`tipo: esperado ${expCol.type}, banco tem ${actCol.type}`);
    }
    const expNotNull = expCol.isNullable === false;
    const actNotNull = actCol.isNullable === false;
    if (expNotNull !== actNotNull) {
      changes.push(
        `nullability: esperado ${expNotNull ? "NOT NULL" : "NULL"}, banco tem ${actNotNull ? "NOT NULL" : "NULL"}`
      );
    }
    if (expCol.isPrimary !== actCol.isPrimary) {
      changes.push(expCol.isPrimary ? "PK ausente no banco" : "PK extra no banco");
    }

    const expRef = expCol.references ? `${bareTableName(expCol.references.table)}.${expCol.references.column.toLowerCase()}` : "";
    const actRef = actCol.references ? `${bareTableName(actCol.references.table)}.${actCol.references.column.toLowerCase()}` : "";
    if (expRef !== actRef) {
      if (expRef && !actRef) {
        changes.push(`FK ausente no banco (esperado → ${expCol.references!.table}.${expCol.references!.column})`);
      } else if (!expRef && actRef) {
        changes.push(`FK extra no banco (→ ${actCol.references!.table}.${actCol.references!.column})`);
      } else {
        changes.push(
          `FK divergente: esperado → ${expCol.references!.table}.${expCol.references!.column}, banco → ${actCol.references!.table}.${actCol.references!.column}`
        );
      }
    }

    if (changes.length > 0) {
      details.push({
        name: expCol.name,
        status: "altered",
        changes,
        previousType: expCol.type,
        currentType: actCol.type,
      });
    }
  }

  // Colunas extras que existem no banco real mas não nas migrations/modelo esperado
  for (const actCol of actualNode.columns) {
    if (!expectedByLower.has(actCol.name.toLowerCase())) {
      details.push({
        name: actCol.name,
        status: "added",
        changes: [`coluna extra no banco (${actCol.type}) fora das migrations`],
        currentType: actCol.type,
      });
    }
  }

  return details;
}

function quoteId(name: string, dialect: "mysql" | "postgres"): string {
  return dialect === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

/**
 * Gera um script SQL de reconciliação para alinhar o banco real (`actual`) ao schema esperado (`expected`).
 * Ações destrutivas (`DROP TABLE` / `DROP COLUMN` de itens extras no banco) vêm comentadas por segurança.
 */
export function generateReconcileDdl(
  expected: DiffableDiagram,
  actual: DiffableDiagram,
  dialect: "mysql" | "postgres" = "postgres"
): string {
  const actualById = new Map<string, DiffableNode>();
  const actualByBare = new Map<string, DiffableNode[]>();

  for (const node of actual.nodes) {
    actualById.set(node.id.toLowerCase(), node);
    const bare = bareTableName(node.label || node.id);
    const list = actualByBare.get(bare) ?? [];
    list.push(node);
    actualByBare.set(bare, list);
  }

  const matchedActualIds = new Set<string>();
  const statements: string[] = [];

  for (const expNode of expected.nodes) {
    let actNode = actualById.get(expNode.id.toLowerCase());
    if (!actNode) {
      const bare = bareTableName(expNode.label || expNode.id);
      const candidates = actualByBare.get(bare) ?? [];
      if (candidates.length === 1 && !matchedActualIds.has(candidates[0].id)) {
        actNode = candidates[0];
      }
    }

    const tableName = expNode.label || expNode.id;

    if (!actNode) {
      const colsSql: string[] = [];
      for (const col of expNode.columns) {
        const parts = [
          `  ${quoteId(col.name, dialect)} ${col.type}`,
          col.isNullable === false ? "NOT NULL" : "",
          col.isUnique && !col.isPrimary ? "UNIQUE" : "",
        ].filter(Boolean);
        colsSql.push(parts.join(" "));
      }
      const pks = expNode.columns.filter((c) => c.isPrimary);
      if (pks.length > 0) {
        colsSql.push(`  PRIMARY KEY (${pks.map((c) => quoteId(c.name, dialect)).join(", ")})`);
      }
      statements.push(`CREATE TABLE ${quoteId(tableName, dialect)} (\n${colsSql.join(",\n")}\n);`);
      continue;
    }

    matchedActualIds.add(actNode.id);
    const actualTableName = actNode.label || actNode.id;

    const actCols = new Map<string, DiffableColumn>();
    for (const c of actNode.columns) actCols.set(c.name.toLowerCase(), c);
    const expCols = new Map<string, DiffableColumn>();
    for (const c of expNode.columns) expCols.set(c.name.toLowerCase(), c);

    for (const expCol of expNode.columns) {
      const actCol = actCols.get(expCol.name.toLowerCase());
      if (!actCol) {
        const parts = [
          `ALTER TABLE ${quoteId(actualTableName, dialect)} ADD COLUMN ${quoteId(expCol.name, dialect)} ${expCol.type}`,
          expCol.isNullable === false ? "NOT NULL" : "",
          expCol.isPrimary ? "PRIMARY KEY" : expCol.isUnique ? "UNIQUE" : "",
        ].filter(Boolean);
        statements.push(`${parts.join(" ")};`);
        continue;
      }

      const typeChanged = normalizeSqlTypeForDrift(expCol.type) !== normalizeSqlTypeForDrift(actCol.type);
      const nullChanged = (expCol.isNullable === false) !== (actCol.isNullable === false);

      if (typeChanged || nullChanged) {
        if (dialect === "mysql") {
          statements.push(
            `ALTER TABLE ${quoteId(actualTableName, dialect)} MODIFY COLUMN ${quoteId(expCol.name, dialect)} ${expCol.type} ${expCol.isNullable === false ? "NOT NULL" : "NULL"};`
          );
        } else {
          if (typeChanged) {
            statements.push(
              `ALTER TABLE ${quoteId(actualTableName, dialect)} ALTER COLUMN ${quoteId(expCol.name, dialect)} TYPE ${expCol.type};`
            );
          }
          if (nullChanged) {
            statements.push(
              `ALTER TABLE ${quoteId(actualTableName, dialect)} ALTER COLUMN ${quoteId(expCol.name, dialect)} ${expCol.isNullable === false ? "SET NOT NULL" : "DROP NOT NULL"};`
            );
          }
        }
      }
    }

    for (const actCol of actNode.columns) {
      if (!expCols.has(actCol.name.toLowerCase())) {
        statements.push(
          `-- [Manual/Destrutivo] Coluna extra no banco: ALTER TABLE ${quoteId(actualTableName, dialect)} DROP COLUMN ${quoteId(actCol.name, dialect)};`
        );
      }
    }
  }

  for (const actNode of actual.nodes) {
    if (!matchedActualIds.has(actNode.id)) {
      const actualTableName = actNode.label || actNode.id;
      statements.push(
        `-- [Manual/Destrutivo] Tabela extra no banco: DROP TABLE ${quoteId(actualTableName, dialect)};`
      );
    }
  }

  if (statements.length === 0) {
    return "-- Banco em sincronia: nenhuma instrução DDL necessária.";
  }

  return [
    `-- Script de reconciliação de Schema Drift (${dialect})`,
    ...statements,
  ].join("\n");
}

/**
 * Compara o schema esperado (`expected`, ex: snapshot final das migrations ou sessão de IA)
 * contra o schema real (`actual`, ex: introspecção ao vivo do banco conectado).
 */
export function computeSchemaDrift(
  expected: DiffableDiagram,
  actual: DiffableDiagram,
  dialect: "mysql" | "postgres" = "postgres"
): SchemaDriftReport {
  const actualById = new Map<string, DiffableNode>();
  const actualByBare = new Map<string, DiffableNode[]>();

  for (const node of actual.nodes) {
    actualById.set(node.id.toLowerCase(), node);
    const bare = bareTableName(node.label || node.id);
    const list = actualByBare.get(bare) ?? [];
    list.push(node);
    actualByBare.set(bare, list);
  }

  const matchedActualIds = new Set<string>();
  const missingInActual: string[] = [];
  const driftedTables: TableDriftItem[] = [];

  for (const expNode of expected.nodes) {
    let actNode = actualById.get(expNode.id.toLowerCase());
    if (!actNode) {
      const bare = bareTableName(expNode.label || expNode.id);
      const candidates = actualByBare.get(bare) ?? [];
      if (candidates.length === 1 && !matchedActualIds.has(candidates[0].id)) {
        actNode = candidates[0];
      }
    }

    if (!actNode) {
      missingInActual.push(expNode.id);
      continue;
    }

    matchedActualIds.add(actNode.id);
    const columnDiffs = compareDriftColumns(expNode, actNode);
    if (columnDiffs.length > 0) {
      driftedTables.push({
        tableId: expNode.id,
        expectedTableId: expNode.id,
        actualTableId: actNode.id,
        columns: columnDiffs,
      });
    }
  }

  const extraInActual = actual.nodes
    .filter((node) => !matchedActualIds.has(node.id))
    .map((node) => node.id)
    .sort();

  missingInActual.sort();
  driftedTables.sort((a, b) => a.tableId.localeCompare(b.tableId));

  const inSync =
    missingInActual.length === 0 &&
    extraInActual.length === 0 &&
    driftedTables.length === 0;

  return {
    inSync,
    missingInActual,
    extraInActual,
    driftedTables,
    reconcileSql: inSync ? undefined : generateReconcileDdl(expected, actual, dialect),
  };
}

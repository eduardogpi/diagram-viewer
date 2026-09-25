import type { IntrospectionResult } from "@/lib/db/drivers/types";
import { HttpError } from "@/lib/errors";
import type {
  ExplorerCatalog,
  ExplorerColumn,
  ExplorerIndex,
  ExplorerRelation,
  ExplorerTable,
} from "@/lib/types/explorer";

/** Constrói o catálogo do Explorer a partir do resultado de introspecção (função pura). */
export function buildExplorerCatalog(
  introspection: IntrospectionResult,
  meta: { provider: string; database: string }
): ExplorerCatalog {
  const columnsByTable = new Map<string, ExplorerColumn[]>();
  for (const col of introspection.columns) {
    const list = columnsByTable.get(col.tableName) ?? [];
    list.push({
      name: col.columnName,
      type: col.columnType,
      isPrimary: col.isPrimary,
      isNullable: col.isNullable,
      isForeign: false,
      references: null,
    });
    columnsByTable.set(col.tableName, list);
  }

  const outgoingByTable = new Map<string, ExplorerRelation[]>();
  const incomingByTable = new Map<string, ExplorerRelation[]>();
  for (const fk of introspection.foreignKeys) {
    const outgoing = outgoingByTable.get(fk.tableName) ?? [];
    outgoing.push({
      constraint: fk.constraintName,
      column: fk.columnName,
      referencesTable: fk.referencedTable,
      referencesColumn: fk.referencedColumn,
    });
    outgoingByTable.set(fk.tableName, outgoing);

    const incoming = incomingByTable.get(fk.referencedTable) ?? [];
    incoming.push({
      constraint: fk.constraintName,
      column: fk.referencedColumn,
      referencesTable: fk.tableName,
      referencesColumn: fk.columnName,
    });
    incomingByTable.set(fk.referencedTable, incoming);

    const targetColumn = columnsByTable.get(fk.tableName)?.find((c) => c.name === fk.columnName);
    if (targetColumn) {
      targetColumn.isForeign = true;
      targetColumn.references = { table: fk.referencedTable, column: fk.referencedColumn };
    }
  }

  const indexesByTable = new Map<string, ExplorerIndex[]>();
  for (const index of introspection.indexes ?? []) {
    const list = indexesByTable.get(index.tableName) ?? [];
    list.push({
      name: index.indexName,
      columns: index.columns,
      isUnique: index.isUnique,
      isPrimary: index.isPrimary,
    });
    indexesByTable.set(index.tableName, list);
  }

  const statsByTable = new Map<string, number | null>();
  for (const stat of introspection.stats ?? []) {
    statsByTable.set(stat.tableName, stat.estimatedRows);
  }

  const tables: ExplorerTable[] = introspection.tables.map((table) => ({
    name: table.tableName,
    schema: table.tableSchema,
    estimatedRows: statsByTable.get(table.tableName) ?? null,
    columns: columnsByTable.get(table.tableName) ?? [],
    indexes: indexesByTable.get(table.tableName) ?? [],
    foreignKeys: outgoingByTable.get(table.tableName) ?? [],
    referencedBy: incomingByTable.get(table.tableName) ?? [],
  }));

  const schemas = Array.from(new Set(tables.map((t) => t.schema))).sort((a, b) => a.localeCompare(b));

  return { provider: meta.provider, database: meta.database, schemas, tables };
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_$]+$/;

function quoteIdentifier(provider: string, identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new HttpError(400, "Identificador de tabela inválido.");
  }
  return provider === "POSTGRES" ? `"${identifier}"` : `\`${identifier}\``;
}

/** Monta um SELECT seguro (identificadores validados/quotados) para o preview de dados. */
export function buildPreviewSql(
  provider: string,
  target: { table: string; schema?: string | null },
  limit: number
): string {
  const quotedTable = quoteIdentifier(provider, target.table);
  const qualified =
    provider === "POSTGRES" && target.schema ? `${quoteIdentifier(provider, target.schema)}.${quotedTable}` : quotedTable;
  return `SELECT * FROM ${qualified} LIMIT ${limit}`;
}

import mysql, { type RowDataPacket } from "mysql2/promise";

import { decryptSecret } from "@/lib/crypto";
import type { DiagramColumnDTO, DiagramEdgeDTO, DiagramNodeDTO, DiagramResponse, DiagramScopeDTO } from "@/lib/types/diagram";

type DiagramConnectionInput = {
  host: string;
  port: number;
  username: string;
  database: string;
  cipherText: string;
};

function humanizeScope(value: string) {
  const normalized = value.replace(/_/g, " ");
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveScope(tableName: string, schema: string) {
  const [prefix] = tableName.split("_");
  if (!prefix || prefix.length < 3) {
    return schema;
  }
  return prefix;
}

export async function buildMySqlDiagram(connection: DiagramConnectionInput): Promise<DiagramResponse> {
  const password = decryptSecret(connection.cipherText);
  const mysqlConn = await mysql.createConnection({
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password,
    database: connection.database,
  });

  try {
    const [tableRows] = await mysqlConn.execute<RowDataPacket[]>(
      `SELECT t.TABLE_NAME as tableName,
              t.TABLE_SCHEMA as tableSchema
         FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = ?
          AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_NAME ASC`,
      [connection.database]
    );

    const [columnRows] = await mysqlConn.execute<RowDataPacket[]>(
      `SELECT TABLE_NAME as tableName,
              COLUMN_NAME as columnName,
              COLUMN_TYPE as columnType,
              IS_NULLABLE as isNullable,
              COLUMN_KEY as columnKey,
              ORDINAL_POSITION as ordinalPosition
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [connection.database]
    );

    const [fkRows] = await mysqlConn.execute<RowDataPacket[]>(
      `SELECT kcu.CONSTRAINT_NAME as constraintName,
              kcu.TABLE_NAME as tableName,
              kcu.COLUMN_NAME as columnName,
              kcu.REFERENCED_TABLE_NAME as referencedTable,
              kcu.REFERENCED_COLUMN_NAME as referencedColumn,
              kcu.ORDINAL_POSITION as ordinalPosition,
              rc.UPDATE_RULE as updateRule,
              rc.DELETE_RULE as deleteRule
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
            ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
           AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
           AND rc.UNIQUE_CONSTRAINT_SCHEMA = kcu.REFERENCED_TABLE_SCHEMA
        WHERE kcu.TABLE_SCHEMA = ?
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      [connection.database]
    );

    const columnsByTable = new Map<string, DiagramColumnDTO[]>();

    columnRows.forEach((row) => {
      const tableName = String(row.tableName);
      const columns = columnsByTable.get(tableName) ?? [];
      columns.push({
        name: String(row.columnName),
        type: String(row.columnType),
        isNullable: String(row.isNullable).toUpperCase() === "YES",
        isPrimary: String(row.columnKey ?? "") === "PRI",
        isForeign: false,
      });
      columnsByTable.set(tableName, columns);
    });

    const fkByConstraint = new Map<
      string,
      {
        source: string;
        target: string;
        constraint: string;
        columns: { source: string; target: string }[];
      }
    >();

    fkRows.forEach((row) => {
      const tableName = String(row.tableName);
      const columnName = String(row.columnName);
      const referencedTable = String(row.referencedTable);
      const referencedColumn = String(row.referencedColumn);
      const constraintName = String(row.constraintName);

      const tableColumns = columnsByTable.get(tableName);
      const targetColumn = tableColumns?.find((col) => col.name === columnName);
      if (targetColumn) {
        targetColumn.isForeign = true;
        targetColumn.references = { table: referencedTable, column: referencedColumn };
      }

      const existing = fkByConstraint.get(constraintName) ?? {
        source: tableName,
        target: referencedTable,
        constraint: constraintName,
        columns: [],
      };
      existing.columns.push({ source: columnName, target: referencedColumn });
      fkByConstraint.set(constraintName, existing);
    });

    const nodes: DiagramNodeDTO[] = tableRows.map((row) => {
      const tableName = String(row.tableName);
      const schema = String(row.tableSchema);
      return {
        id: tableName,
        label: tableName,
        schema,
        scope: deriveScope(tableName, schema),
        columns: columnsByTable.get(tableName) ?? [],
      };
    });

    const edges: DiagramEdgeDTO[] = Array.from(fkByConstraint.values()).map((edge) => ({
      id: `${edge.source}-${edge.target}-${edge.constraint}`,
      source: edge.source,
      target: edge.target,
      scope: deriveScope(edge.source, connection.database),
      constraint: edge.constraint,
      columns: edge.columns,
    }));

    const scopeMap = new Map<string, DiagramScopeDTO>();
    nodes.forEach((node) => {
      const existing = scopeMap.get(node.scope);
      if (existing) {
        existing.tables += 1;
        return;
      }
      scopeMap.set(node.scope, {
        id: node.scope,
        label: humanizeScope(node.scope),
        description: `Entidades relacionadas a ${humanizeScope(node.scope)}`,
        tables: 1,
      });
    });

    return {
      nodes,
      edges,
      scopes: Array.from(scopeMap.values()),
    };
  } finally {
    await mysqlConn.end().catch(() => undefined);
  }
}

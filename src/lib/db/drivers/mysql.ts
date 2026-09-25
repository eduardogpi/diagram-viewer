import mysql, { type FieldPacket, type RowDataPacket } from "mysql2/promise";

import { PROVIDER_META } from "@/lib/db/provider-meta";
import { HttpError } from "@/lib/errors";
import type { DiagramResponse } from "@/lib/types/diagram";

import {
  assertReadOnlyQuery,
  boundRowLimit,
  buildDiagramFromIntrospection,
  normalizeFieldValue,
  normalizeSql,
} from "./shared";
import type {
  DiagramCapableDriver,
  DriverConnectionConfig,
  IntrospectOptions,
  IntrospectedIndex,
  IntrospectionResult,
  QueryExecutionResult,
  ReadOnlyQueryInput,
} from "./types";

function connect(config: DriverConnectionConfig, extra?: mysql.ConnectionOptions) {
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    ...extra,
  });
}

async function testConnection(config: DriverConnectionConfig): Promise<void> {
  const connection = await connect(config, { connectTimeout: 5000 });
  try {
    await connection.query("SELECT 1");
  } finally {
    await connection.end().catch(() => undefined);
  }
}

async function introspect(config: DriverConnectionConfig, options?: IntrospectOptions): Promise<IntrospectionResult> {
  const connection = await connect(config);

  try {
    const [tableRows] = await connection.execute<RowDataPacket[]>(
      `SELECT t.TABLE_NAME as tableName,
              t.TABLE_SCHEMA as tableSchema
         FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = ?
          AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_NAME ASC`,
      [config.database]
    );

    const [columnRows] = await connection.execute<RowDataPacket[]>(
      `SELECT TABLE_NAME as tableName,
              COLUMN_NAME as columnName,
              COLUMN_TYPE as columnType,
              IS_NULLABLE as isNullable,
              COLUMN_KEY as columnKey
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [config.database]
    );

    const [fkRows] = await connection.execute<RowDataPacket[]>(
      `SELECT kcu.CONSTRAINT_NAME as constraintName,
              kcu.TABLE_NAME as tableName,
              kcu.COLUMN_NAME as columnName,
              kcu.REFERENCED_TABLE_NAME as referencedTable,
              kcu.REFERENCED_COLUMN_NAME as referencedColumn,
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
      [config.database]
    );

    const result: IntrospectionResult = {
      tables: tableRows.map((row) => ({
        tableName: String(row.tableName),
        tableSchema: String(row.tableSchema),
      })),
      columns: columnRows.map((row) => ({
        tableName: String(row.tableName),
        columnName: String(row.columnName),
        columnType: String(row.columnType),
        isNullable: String(row.isNullable).toUpperCase() === "YES",
        isPrimary: String(row.columnKey ?? "") === "PRI",
      })),
      foreignKeys: fkRows.map((row) => ({
        constraintName: String(row.constraintName),
        tableName: String(row.tableName),
        columnName: String(row.columnName),
        referencedTable: String(row.referencedTable),
        referencedColumn: String(row.referencedColumn),
        updateRule: row.updateRule ? String(row.updateRule) : null,
        deleteRule: row.deleteRule ? String(row.deleteRule) : null,
      })),
    };

    if (options?.includeIndexes) {
      const [indexRows] = await connection.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME as tableName,
                INDEX_NAME as indexName,
                NON_UNIQUE as nonUnique,
                COLUMN_NAME as columnName
           FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        [config.database]
      );

      const indexMap = new Map<string, IntrospectedIndex>();
      for (const row of indexRows) {
        const key = `${row.tableName}.${row.indexName}`;
        const entry = indexMap.get(key) ?? {
          tableName: String(row.tableName),
          indexName: String(row.indexName),
          columns: [],
          isUnique: Number(row.nonUnique) === 0,
          isPrimary: String(row.indexName) === "PRIMARY",
        };
        entry.columns.push(String(row.columnName));
        indexMap.set(key, entry);
      }
      result.indexes = Array.from(indexMap.values());

      const [statRows] = await connection.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME as tableName, TABLE_ROWS as tableRows
           FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ?
            AND TABLE_TYPE = 'BASE TABLE'`,
        [config.database]
      );
      result.stats = statRows.map((row) => ({
        tableName: String(row.tableName),
        estimatedRows: row.tableRows === null || row.tableRows === undefined ? null : Number(row.tableRows),
      }));
    }

    return result;
  } finally {
    await connection.end().catch(() => undefined);
  }
}

async function buildDiagram(config: DriverConnectionConfig): Promise<DiagramResponse> {
  return buildDiagramFromIntrospection(await introspect(config), config.database);
}

async function executeReadOnlyQuery({
  sql,
  rowLimit = 200,
  timeoutMs = 8000,
  ...config
}: ReadOnlyQueryInput): Promise<QueryExecutionResult> {
  const normalizedSql = normalizeSql(sql);
  assertReadOnlyQuery(normalizedSql);
  const limit = boundRowLimit(rowLimit);

  const connection = await connect(config, { multipleStatements: false, connectTimeout: timeoutMs });
  const startedAt = Date.now();

  try {
    await connection.query("SET SESSION sql_select_limit = ?", [limit]).catch(() => undefined);
    await connection.query("SET SESSION max_execution_time = ?", [timeoutMs]).catch(() => undefined);

    const queryPromise = connection.query<RowDataPacket[]>(normalizedSql);
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        connection.destroy();
        reject(new HttpError(408, "A consulta excedeu o tempo limite permitido."));
      }, timeoutMs);

      queryPromise.finally(() => clearTimeout(timer)).catch(() => undefined);
    });

    const [rows, fields] = (await Promise.race([queryPromise, timeoutPromise])) as [RowDataPacket[], FieldPacket[]];

    const normalizedRows = Array.isArray(rows)
      ? rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeFieldValue(value)])))
      : [];

    return {
      columns: fields?.map((field) => field.name) ?? Object.keys(normalizedRows[0] ?? {}),
      rows: normalizedRows,
      rowCount: normalizedRows.length,
      durationMs: Date.now() - startedAt,
      truncated: normalizedRows.length >= limit,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error) throw new HttpError(400, error.message);
    throw new HttpError(500, "Falha ao executar a consulta.");
  } finally {
    await connection.end().catch(() => undefined);
  }
}

export const mysqlDriver: DiagramCapableDriver = {
  // No MySQL o database já é o schema — PROVIDER_META.MYSQL.schemaField é null de propósito.
  ...PROVIDER_META.MYSQL,
  testConnection,
  introspect,
  buildDiagram,
  executeReadOnlyQuery,
};

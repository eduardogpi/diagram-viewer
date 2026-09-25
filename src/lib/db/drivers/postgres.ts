import { Client, type ClientConfig } from "pg";

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

export const DEFAULT_SCHEMA = PROVIDER_META.POSTGRES.schemaField?.defaultValue ?? "public";

function resolveSchema(config: DriverConnectionConfig) {
  return config.schema?.trim() || DEFAULT_SCHEMA;
}

async function connect(config: DriverConnectionConfig, extra?: Partial<ClientConfig>): Promise<Client> {
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    // Provedores gerenciados (RDS, Supabase, Neon) exigem TLS mas usam CA própria.
    ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    ...extra,
  });
  await client.connect();
  return client;
}

async function testConnection(config: DriverConnectionConfig): Promise<void> {
  const client = await connect(config, { connectionTimeoutMillis: 5000 });
  try {
    await client.query("SELECT 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Códigos de ação referencial do pg_constraint (confupdtype/confdeltype). */
const FK_ACTIONS: Record<string, string> = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

async function introspect(config: DriverConnectionConfig, options?: IntrospectOptions): Promise<IntrospectionResult> {
  const schema = resolveSchema(config);
  const client = await connect(config);

  try {
    // relkind 'r' = tabela comum, 'p' = tabela particionada. Views ('v') ficam de fora, igual ao MySQL.
    const tables = await client.query<{ table_name: string; table_schema: string }>(
      `SELECT c.relname AS table_name, n.nspname AS table_schema
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relkind IN ('r', 'p')
        ORDER BY c.relname`,
      [schema]
    );

    // format_type() é o equivalente ao COLUMN_TYPE do MySQL: devolve o tipo já com
    // precisão/tamanho ("varchar(50)", "numeric(10,2)"), que INFORMATION_SCHEMA não dá pronto.
    const columns = await client.query<{
      table_name: string;
      column_name: string;
      column_type: string;
      is_nullable: boolean;
      is_primary: boolean;
    }>(
      `SELECT c.relname AS table_name,
              a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS column_type,
              NOT a.attnotnull AS is_nullable,
              EXISTS (
                SELECT 1 FROM pg_constraint pk
                 WHERE pk.conrelid = c.oid
                   AND pk.contype = 'p'
                   AND a.attnum = ANY (pk.conkey)
              ) AS is_primary
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relkind IN ('r', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum`,
      [schema]
    );

    // conkey/confkey são arrays paralelos de attnum. O unnest conjunto WITH ORDINALITY é o que
    // garante o pareamento correto coluna-a-coluna em FK composta — information_schema.
    // constraint_column_usage não garante essa ordem.
    const foreignKeys = await client.query<{
      constraint_name: string;
      table_name: string;
      column_name: string;
      referenced_table: string;
      referenced_column: string;
      update_rule: string | null;
      delete_rule: string | null;
    }>(
      `SELECT con.conname AS constraint_name,
              src.relname AS table_name,
              sa.attname AS column_name,
              tgt.relname AS referenced_table,
              ta.attname AS referenced_column,
              con.confupdtype AS update_rule,
              con.confdeltype AS delete_rule
         FROM pg_constraint con
         JOIN pg_class src ON src.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = src.relnamespace
         JOIN pg_class tgt ON tgt.oid = con.confrelid
         JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(src_att, tgt_att, ord) ON TRUE
         JOIN pg_attribute sa ON sa.attrelid = con.conrelid AND sa.attnum = k.src_att
         JOIN pg_attribute ta ON ta.attrelid = con.confrelid AND ta.attnum = k.tgt_att
        WHERE con.contype = 'f'
          AND n.nspname = $1
        ORDER BY con.conname, k.ord`,
      [schema]
    );

    const result: IntrospectionResult = {
      tables: tables.rows.map((row) => ({ tableName: row.table_name, tableSchema: row.table_schema })),
      columns: columns.rows.map((row) => ({
        tableName: row.table_name,
        columnName: row.column_name,
        columnType: row.column_type,
        isNullable: row.is_nullable,
        isPrimary: row.is_primary,
      })),
      foreignKeys: foreignKeys.rows.map((row) => ({
        constraintName: row.constraint_name,
        tableName: row.table_name,
        columnName: row.column_name,
        referencedTable: row.referenced_table,
        referencedColumn: row.referenced_column,
        updateRule: row.update_rule ? (FK_ACTIONS[row.update_rule] ?? null) : null,
        deleteRule: row.delete_rule ? (FK_ACTIONS[row.delete_rule] ?? null) : null,
      })),
    };

    if (options?.includeIndexes) {
      const indexRows = await client.query<{
        table_name: string;
        index_name: string;
        is_unique: boolean;
        is_primary: boolean;
        column_name: string | null;
      }>(
        `SELECT t.relname AS table_name,
                i.relname AS index_name,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                a.attname AS column_name
           FROM pg_index ix
           JOIN pg_class i ON i.oid = ix.indexrelid
           JOIN pg_class t ON t.oid = ix.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
           LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          WHERE n.nspname = $1
          ORDER BY t.relname, i.relname, k.ord`,
        [schema]
      );

      const indexMap = new Map<string, IntrospectedIndex>();
      for (const row of indexRows.rows) {
        const key = `${row.table_name}.${row.index_name}`;
        const entry = indexMap.get(key) ?? {
          tableName: row.table_name,
          indexName: row.index_name,
          columns: [],
          isUnique: row.is_unique,
          isPrimary: row.is_primary,
        };
        if (row.column_name) entry.columns.push(row.column_name);
        indexMap.set(key, entry);
      }
      result.indexes = Array.from(indexMap.values());

      const statRows = await client.query<{ table_name: string; estimated_rows: string }>(
        `SELECT c.relname AS table_name, c.reltuples::bigint AS estimated_rows
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
            AND c.relkind IN ('r', 'p')`,
        [schema]
      );
      result.stats = statRows.rows.map((row) => ({
        tableName: row.table_name,
        estimatedRows: Number(row.estimated_rows),
      }));
    }

    return result;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function buildDiagram(config: DriverConnectionConfig): Promise<DiagramResponse> {
  return buildDiagramFromIntrospection(await introspect(config), resolveSchema(config));
}

/** Formas que aceitam ser envelopadas numa subquery para aplicar o LIMIT no servidor. */
const WRAPPABLE_PATTERN = /^(select|with|table|values)\b/i;

async function executeReadOnlyQuery({
  sql,
  rowLimit = 200,
  timeoutMs = 8000,
  ...config
}: ReadOnlyQueryInput): Promise<QueryExecutionResult> {
  const normalizedSql = normalizeSql(sql);
  assertReadOnlyQuery(normalizedSql);
  const limit = boundRowLimit(rowLimit);

  // Pede uma linha a mais que o limite só para saber se houve corte.
  const effectiveSql = WRAPPABLE_PATTERN.test(normalizedSql)
    ? `SELECT * FROM (${normalizedSql}) AS _wb_limited LIMIT ${limit + 1}`
    : normalizedSql;

  const client = await connect(config, { connectionTimeoutMillis: timeoutMs, statement_timeout: timeoutMs });
  const startedAt = Date.now();

  try {
    // Garantia no próprio engine: nada de escrita passa daqui, independente do filtro por regex.
    await client.query("BEGIN TRANSACTION READ ONLY");
    const result = await client.query({ text: effectiveSql, rowMode: "array" as const });
    await client.query("ROLLBACK").catch(() => undefined);

    const columns = result.fields?.map((field) => field.name) ?? [];
    const truncated = result.rows.length > limit;
    const rows = (truncated ? result.rows.slice(0, limit) : result.rows).map((row: unknown[]) =>
      Object.fromEntries(row.map((value, idx) => [columns[idx] ?? `col_${idx}`, normalizeFieldValue(value)]))
    );

    return {
      columns,
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - startedAt,
      truncated,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof HttpError) throw error;
    // 57014 = query_canceled, o código que statement_timeout dispara.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "57014") {
      throw new HttpError(408, "A consulta excedeu o tempo limite permitido.");
    }
    if (error instanceof Error) throw new HttpError(400, error.message);
    throw new HttpError(500, "Falha ao executar a consulta.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export const postgresDriver: DiagramCapableDriver = {
  ...PROVIDER_META.POSTGRES,
  testConnection,
  introspect,
  buildDiagram,
  executeReadOnlyQuery,
};

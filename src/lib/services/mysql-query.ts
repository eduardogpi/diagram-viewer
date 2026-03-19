import mysql, { type FieldPacket, type RowDataPacket } from "mysql2/promise";

import { decryptSecret } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";

type QueryConnectionInput = {
  host: string;
  port: number;
  username: string;
  database: string;
  cipherText: string;
};

type ExecuteQueryInput = QueryConnectionInput & {
  sql: string;
  rowLimit?: number;
  timeoutMs?: number;
};

export type QueryExecutionResult = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
};

const DISALLOWED_PATTERN =
  /\b(insert|update|delete|drop|alter|truncate|create|replace|rename|grant|revoke|call|set|use|lock|unlock|analyze|optimize|repair)\b/i;
const LEADING_ALLOWED_PATTERN = /^(select|show|describe|desc|explain|with)\b/i;

export async function executeReadOnlyMySqlQuery({
  host,
  port,
  username,
  database,
  cipherText,
  sql,
  rowLimit = 200,
  timeoutMs = 8000,
}: ExecuteQueryInput): Promise<QueryExecutionResult> {
  const normalizedSql = normalizeSql(sql);
  assertReadOnlyQuery(normalizedSql);
  const boundedRowLimit = Math.min(Math.max(rowLimit, 1), 500);

  const password = decryptSecret(cipherText);
  const connection = await mysql.createConnection({
    host,
    port,
    user: username,
    password,
    database,
    multipleStatements: false,
    connectTimeout: timeoutMs,
  });

  const startedAt = Date.now();

  try {
    await connection.query("SET SESSION sql_select_limit = ?", [boundedRowLimit]).catch(() => undefined);
    await connection.query("SET SESSION max_execution_time = ?", [timeoutMs]).catch(() => undefined);

    const queryPromise = connection.query<RowDataPacket[]>(normalizedSql);
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        connection.destroy();
        reject(new HttpError(408, "A consulta excedeu o tempo limite permitido."));
      }, timeoutMs);

      queryPromise.finally(() => clearTimeout(timer)).catch(() => undefined);
    });

    const [rows, fields] = (await Promise.race([queryPromise, timeoutPromise])) as [
      RowDataPacket[],
      FieldPacket[],
    ];

    const normalizedRows = Array.isArray(rows)
      ? rows.map((row) => {
          const entries = Object.entries(row).map(([key, value]) => [key, normalizeFieldValue(value)]);
          return Object.fromEntries(entries);
        })
      : [];

    const columns =
      fields?.map((field) => field.name) ??
      Object.keys(normalizedRows[0] ?? {});

    return {
      columns,
      rows: normalizedRows,
      rowCount: normalizedRows.length,
      durationMs: Date.now() - startedAt,
      truncated: normalizedRows.length >= boundedRowLimit,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new HttpError(400, error.message);
    }

    throw new HttpError(500, "Falha ao executar a consulta.");
  } finally {
    await connection.end().catch(() => undefined);
  }
}

function normalizeSql(value: string) {
  const normalized = value.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    throw new HttpError(400, "Informe uma consulta SQL.");
  }

  const withoutTrailingSemicolon = normalized.replace(/;+\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    throw new HttpError(400, "Apenas uma consulta por vez e permitida.");
  }

  return withoutTrailingSemicolon;
}

function assertReadOnlyQuery(sql: string) {
  if (!LEADING_ALLOWED_PATTERN.test(sql)) {
    throw new HttpError(400, "Somente consultas de leitura sao permitidas nesta fase.");
  }

  if (DISALLOWED_PATTERN.test(sql)) {
    throw new HttpError(400, "Comandos mutaveis ou administrativos nao sao permitidos.");
  }
}

function normalizeFieldValue(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return value;
}

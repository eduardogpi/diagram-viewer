import { HttpError } from "@/lib/errors";
import type { DiagramColumnDTO, DiagramEdgeDTO, DiagramNodeDTO, DiagramResponse, DiagramScopeDTO } from "@/lib/types/diagram";

import type { IntrospectionResult } from "./types";

function humanizeScope(value: string) {
  const normalized = value.replace(/_/g, " ");
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Heurística de agrupamento: prefixo antes do primeiro "_" (ex: "auth_users" → "auth"). */
export function deriveScope(tableName: string, schema: string) {
  const [prefix] = tableName.split("_");
  if (!prefix || prefix.length < 3) {
    return schema;
  }
  return prefix;
}

/**
 * Monta o DiagramResponse canônico a partir das linhas de catálogo já normalizadas pelo driver.
 * Toda a lógica de agrupamento, FK composta e escopos vive aqui — os drivers só sabem traduzir
 * o catálogo do próprio banco.
 */
export function buildDiagramFromIntrospection(
  { tables, columns, foreignKeys }: IntrospectionResult,
  fallbackScope: string
): DiagramResponse {
  const columnsByTable = new Map<string, DiagramColumnDTO[]>();

  for (const row of columns) {
    const existing = columnsByTable.get(row.tableName) ?? [];
    existing.push({
      name: row.columnName,
      type: row.columnType,
      isNullable: row.isNullable,
      isPrimary: row.isPrimary,
      isForeign: false,
    });
    columnsByTable.set(row.tableName, existing);
  }

  const fkByConstraint = new Map<
    string,
    {
      source: string;
      target: string;
      constraint: string;
      columns: { source: string; target: string }[];
      onUpdate?: string;
      onDelete?: string;
    }
  >();

  for (const row of foreignKeys) {
    const targetColumn = columnsByTable.get(row.tableName)?.find((col) => col.name === row.columnName);
    if (targetColumn) {
      targetColumn.isForeign = true;
      targetColumn.references = { table: row.referencedTable, column: row.referencedColumn };
    }

    // A chave inclui a tabela: nomes de constraint só são únicos por tabela em alguns bancos.
    const key = `${row.tableName}.${row.constraintName}`;
    const existing = fkByConstraint.get(key) ?? {
      source: row.tableName,
      target: row.referencedTable,
      constraint: row.constraintName,
      columns: [],
      onUpdate: row.updateRule ?? undefined,
      onDelete: row.deleteRule ?? undefined,
    };
    existing.columns.push({ source: row.columnName, target: row.referencedColumn });
    fkByConstraint.set(key, existing);
  }

  const nodes: DiagramNodeDTO[] = tables.map((row) => ({
    id: row.tableName,
    label: row.tableName,
    schema: row.tableSchema,
    scope: deriveScope(row.tableName, row.tableSchema),
    columns: columnsByTable.get(row.tableName) ?? [],
  }));

  const edges: DiagramEdgeDTO[] = Array.from(fkByConstraint.values()).map((edge) => ({
    id: `${edge.source}-${edge.target}-${edge.constraint}`,
    source: edge.source,
    target: edge.target,
    scope: deriveScope(edge.source, fallbackScope),
    constraint: edge.constraint,
    columns: edge.columns,
    onUpdate: edge.onUpdate,
    onDelete: edge.onDelete,
  }));

  const scopeMap = new Map<string, DiagramScopeDTO>();
  for (const node of nodes) {
    const existing = scopeMap.get(node.scope);
    if (existing) {
      existing.tables += 1;
      continue;
    }
    scopeMap.set(node.scope, {
      id: node.scope,
      label: humanizeScope(node.scope),
      description: `Entidades relacionadas a ${humanizeScope(node.scope)}`,
      tables: 1,
    });
  }

  return { nodes, edges, scopes: Array.from(scopeMap.values()) };
}

export function stripSqlLiteralsAndComments(sql: string): string {
  let result = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" && !inDouble && !inBacktick) {
      if (inSingle && next === "'") {
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      continue;
    }
    if (char === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (char === "-" && next === "-") {
        while (i < sql.length && sql[i] !== "\n") i += 1;
        result += "\n";
        continue;
      }
      if (char === "/" && next === "*") {
        i += 2;
        while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
        i += 1;
        continue;
      }
      result += char;
    }
  }

  return result;
}

const DISALLOWED_PATTERN =
  /\b(insert|update|delete|drop|alter|truncate|create|replace\s+into|rename|grant|revoke|call|set|use|lock|unlock|analyze|optimize|repair|vacuum|copy|do)\b/i;
const LEADING_ALLOWED_PATTERN = /^(select|show|describe|desc|explain|with|table|values)\b/i;

/** Normaliza e recusa múltiplos statements — comum a todos os dialetos. */
export function normalizeSql(value: string) {
  const normalized = value.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    throw new HttpError(400, "Informe uma consulta SQL.");
  }

  const withoutTrailingSemicolon = normalized.replace(/;+\s*$/, "");
  const stripped = stripSqlLiteralsAndComments(withoutTrailingSemicolon);
  if (stripped.includes(";")) {
    throw new HttpError(400, "Apenas uma consulta por vez e permitida.");
  }

  return withoutTrailingSemicolon;
}

export function assertReadOnlyQuery(sql: string) {
  const stripped = stripSqlLiteralsAndComments(sql).trim();
  if (!LEADING_ALLOWED_PATTERN.test(stripped)) {
    throw new HttpError(400, "Somente consultas de leitura sao permitidas nesta fase.");
  }

  if (DISALLOWED_PATTERN.test(stripped)) {
    throw new HttpError(400, "Comandos mutaveis ou administrativos nao sao permitidos.");
  }
}

export function boundRowLimit(rowLimit: number) {
  return Math.min(Math.max(rowLimit, 1), 500);
}

export function normalizeFieldValue(value: unknown) {
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

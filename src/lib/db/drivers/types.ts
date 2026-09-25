import type { DiagramResponse } from "@/lib/types/diagram";

/** Dados de conexão já resolvidos — a senha chega em claro, decifrada na borda (rota/serviço). */
export type DriverConnectionConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  /**
   * Schema a inspecionar. Só faz sentido em bancos que separam database de schema (Postgres);
   * no MySQL o database já é o schema e este campo é ignorado.
   */
  schema?: string | null;
};

export type ReadOnlyQueryInput = DriverConnectionConfig & {
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

/**
 * Linhas de introspecção normalizadas: cada driver traduz o catálogo do seu banco para esta
 * forma, e a montagem do DiagramResponse (agrupamento, FKs compostas, escopos) é comum a todos.
 */
export type IntrospectedTable = { tableName: string; tableSchema: string };

export type IntrospectedColumn = {
  tableName: string;
  columnName: string;
  /** Tipo já formatado para exibição (ex: "varchar(50)", "numeric(10,2)"). */
  columnType: string;
  isNullable: boolean;
  isPrimary: boolean;
};

export type IntrospectedForeignKey = {
  constraintName: string;
  tableName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  updateRule?: string | null;
  deleteRule?: string | null;
};

export type IntrospectedIndex = {
  tableName: string;
  indexName: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
};

export type IntrospectedTableStat = {
  tableName: string;
  estimatedRows: number | null;
};

/** Metadados extras opcionais (usados pelo Explorer) — o diagrama não precisa deles. */
export type IntrospectOptions = { includeIndexes?: boolean };

export type IntrospectionResult = {
  tables: IntrospectedTable[];
  columns: IntrospectedColumn[];
  foreignKeys: IntrospectedForeignKey[];
  indexes?: IntrospectedIndex[];
  stats?: IntrospectedTableStat[];
};

export type DatabaseDriver = {
  /** Valor de `Connection.provider` atendido por este driver. */
  provider: string;
  label: string;
  defaultPort: number;
  /**
   * Rótulo do campo de schema no formulário de conexão, ou null quando o banco não separa
   * database de schema (MySQL) e o campo não deve aparecer.
   */
  schemaField: { label: string; placeholder: string; defaultValue: string } | null;
  testConnection(config: DriverConnectionConfig): Promise<void>;
  introspect(config: DriverConnectionConfig, options?: IntrospectOptions): Promise<IntrospectionResult>;
  executeReadOnlyQuery(input: ReadOnlyQueryInput): Promise<QueryExecutionResult>;
};

export type DiagramCapableDriver = DatabaseDriver & {
  buildDiagram(config: DriverConnectionConfig): Promise<DiagramResponse>;
};

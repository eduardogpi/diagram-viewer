export type ExplorerColumn = {
  name: string;
  type: string;
  isPrimary: boolean;
  isNullable: boolean;
  isForeign: boolean;
  references: { table: string; column: string } | null;
};

export type ExplorerIndex = {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
};

export type ExplorerRelation = {
  constraint: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
};

export type ExplorerTable = {
  name: string;
  schema: string;
  estimatedRows: number | null;
  columns: ExplorerColumn[];
  indexes: ExplorerIndex[];
  foreignKeys: ExplorerRelation[];
  /** Tabelas que referenciam esta (FKs de entrada). */
  referencedBy: ExplorerRelation[];
};

export type ExplorerCatalog = {
  provider: string;
  database: string;
  schemas: string[];
  tables: ExplorerTable[];
};

export type ExplorerPreview = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  durationMs: number;
};

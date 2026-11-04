import type { DiagramResponse } from "@/lib/types/diagram";

export type MigrationSourceProvider = "flyway" | "sql";

export type MigrationFileInput = {
  name: string;
  content: string;
  /**
   * Caminho relativo dentro do pacote/zip (ex: "resources/db/migration/core/V1__init.sql").
   * Quando ausente, assume-se o próprio `name`. Usado para ordenação por módulo.
   */
  path?: string;
};

export type MigrationFile = {
  id: string;
  name: string;
  order: number;
  content: string;
  checksum: string;
};

export type MigrationParseWarning = {
  migrationOrder: number;
  migrationName: string;
  statement: string;
  reason: string;
};

/**
 * Resumo do efeito de uma migration sobre o schema, comparada ao snapshot anterior.
 * Alimenta a timeline (barras de delta, filtros, linhagem de tabela) sem precisar
 * carregar os diagramas de todos os snapshots no cliente.
 */
export type MigrationSnapshotStats = {
  /** Totais no estado acumulado até esta migration. */
  tables: number;
  columns: number;
  edges: number;
  /** Tabelas criadas nesta migration (ids dos nós). */
  addedTables: string[];
  /** Tabelas removidas nesta migration. */
  removedTables: string[];
  /** Tabelas que já existiam e tiveram colunas/FKs alteradas nesta migration. */
  alteredTables: string[];
  addedEdges: number;
  removedEdges: number;
  /** Statements que o parser não entendeu (podem afetar o schema). */
  schemaWarnings: number;
  /** Statements reconhecidos e sem efeito no schema (DML, sequences, triggers, índices). */
  ignoredStatements: number;
};

export type MigrationSnapshot = {
  migrationOrder: number;
  migrationName: string;
  diagram: DiagramResponse;
  warnings: MigrationParseWarning[];
  stats: MigrationSnapshotStats;
};

export type MigrationParseResult = {
  snapshots: MigrationSnapshot[];
  finalDiagram: DiagramResponse;
  warnings: MigrationParseWarning[];
  fileCount: number;
};

export type MigrationPackageDTO = {
  id: string;
  name: string;
  sourceProvider: MigrationSourceProvider;
  fileCount: number;
  checksum: string;
  createdAt: string;
  /** Versão do parser que gerou os snapshots deste pacote. */
  parserVersion: number;
  /** true = os snapshots foram gerados por uma versão antiga do parser e precisam de reprocesso. */
  parserStale: boolean;
};

export type MigrationMergeResult = {
  /** Conjunto final de arquivos do package (existentes + novos, sem duplicatas). */
  files: MigrationFileInput[];
  added: string[];
  skipped: string[];
  changed: string[];
};

/**
 * Resultado de um append: além do package atualizado, diz o que foi feito com cada arquivo
 * enviado, para que o usuário possa reenviar o pacote inteiro (zip) sem duplicar nada.
 */
export type MigrationAppendResultDTO = {
  package: MigrationPackageDTO;
  /** Migrations que ainda não existiam no package. */
  added: string[];
  /** Migrations idênticas às já importadas (ignoradas). */
  skipped: string[];
  /** Migrations que já existiam mas cujo conteúdo mudou (sobrescritas). */
  changed: string[];
};

export type MigrationPackageDetailDTO = {
  id: string;
  name: string;
  sourceProvider: MigrationSourceProvider;
  fileCount: number;
  checksum: string;
  createdAt: string;
  parserVersion: number;
  parserStale: boolean;
  files: Array<{
    id: string;
    order: number;
    name: string;
    checksum: string;
  }>;
  snapshots: Array<{
    migrationOrder: number;
    migrationName: string;
    warnings: Array<{ statement: string; reason: string }>;
    stats: MigrationSnapshotStats;
  }>;
};

export type MigrationSnapshotDTO = {
  migrationOrder: number;
  migrationName: string;
  diagram: DiagramResponse;
  warnings: Array<{ statement: string; reason: string }>;
  stats: MigrationSnapshotStats;
};

/** Uma migration (com SQL + estatística) usada como material para o resumo por IA. */
export type MigrationSummaryItem = {
  order: number;
  name: string;
  content: string;
  stats: MigrationSnapshotStats | null;
};

/** Tudo que o resumo por IA precisa: a migration alvo, vizinhas opcionais e o estado do schema. */
export type MigrationSummaryInput = {
  packageName: string;
  sourceProvider: string;
  totalFiles: number;
  target: MigrationSummaryItem;
  /** Vizinhas imediatamente anteriores, em ordem crescente. */
  before: MigrationSummaryItem[];
  /** Vizinhas imediatamente posteriores, em ordem crescente. */
  after: MigrationSummaryItem[];
  tablesBefore: number;
  tablesAfter: number;
};

export type MigrationSummaryResult = {
  summary: string;
  truncated: boolean;
  provider: string;
  model: string;
  /** Quantas migrations vizinhas entraram como contexto de fato. */
  context: { before: number; after: number };
};

/** Um lote de migrations consecutivas resumido numa única chamada ao modelo. */
export type MigrationSummaryChunkPlan = {
  index: number;
  fromOrder: number;
  toOrder: number;
  count: number;
};

/** Plano do resumo de todo o package: quantos lotes e quais migrations cada um cobre. */
export type MigrationPackageSummaryPlan = {
  packageName: string;
  checksum: string;
  totalFiles: number;
  chunks: MigrationSummaryChunkPlan[];
};

export type MigrationChunkSummaryResult = {
  index: number;
  fromOrder: number;
  toOrder: number;
  summary: string;
  truncated: boolean;
  provider: string;
  model: string;
};

export type MigrationPackageOverviewResult = {
  overview: string;
  truncated: boolean;
  provider: string;
  model: string;
};


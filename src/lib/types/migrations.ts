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

export type MigrationSnapshot = {
  migrationOrder: number;
  migrationName: string;
  diagram: DiagramResponse;
  warnings: MigrationParseWarning[];
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
  }>;
};

export type MigrationSnapshotDTO = {
  migrationOrder: number;
  migrationName: string;
  diagram: DiagramResponse;
  warnings: Array<{ statement: string; reason: string }>;
};

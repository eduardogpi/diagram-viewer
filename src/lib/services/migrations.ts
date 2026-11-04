import { prisma } from "@/lib/prisma";
import {
  buildMigrationFiles,
  detectMigrationProvider,
  mergeMigrationFiles,
  packageChecksum,
  PARSER_VERSION,
  parseMigrations,
} from "@/lib/services/migration-parser";
import type {
  MigrationAppendResultDTO,
  MigrationFileInput,
  MigrationPackageDTO,
  MigrationPackageDetailDTO,
  MigrationSnapshotDTO,
  MigrationSnapshotStats,
  MigrationSummaryInput,
  MigrationSummaryItem,
} from "@/lib/types/migrations";
import type { DiagramResponse } from "@/lib/types/diagram";

export async function listMigrationPackages(connectionId: string, ownerId: string): Promise<MigrationPackageDTO[]> {
  const packages = await prisma.migrationPackage.findMany({
    where: { connectionId, ownerId },
    orderBy: { createdAt: "desc" },
  });

  return packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    sourceProvider: pkg.sourceProvider as MigrationPackageDTO["sourceProvider"],
    fileCount: pkg.fileCount,
    checksum: pkg.checksum,
    createdAt: pkg.createdAt.toISOString(),
    parserVersion: pkg.parserVersion,
    parserStale: pkg.parserVersion !== PARSER_VERSION,
  }));
}

export async function getMigrationPackage(
  packageId: string,
  connectionId: string,
  ownerId: string
): Promise<MigrationPackageDetailDTO | null> {
  const pkg = await prisma.migrationPackage.findFirst({
    where: { id: packageId, connectionId, ownerId },
    include: {
      files: { orderBy: { order: "asc" }, select: { id: true, order: true, name: true, checksum: true } },
      snapshots: {
        orderBy: { migrationOrder: "asc" },
        select: { migrationOrder: true, migrationName: true, warningsJson: true, statsJson: true },
      },
    },
  });

  if (!pkg) return null;

  return {
    id: pkg.id,
    name: pkg.name,
    sourceProvider: pkg.sourceProvider as MigrationPackageDetailDTO["sourceProvider"],
    fileCount: pkg.fileCount,
    checksum: pkg.checksum,
    createdAt: pkg.createdAt.toISOString(),
    parserVersion: pkg.parserVersion,
    parserStale: pkg.parserVersion !== PARSER_VERSION,
    files: pkg.files.map((file) => ({
      id: file.id,
      order: file.order,
      name: file.name,
      checksum: file.checksum,
    })),
    snapshots: pkg.snapshots.map((snapshot) => ({
      migrationOrder: snapshot.migrationOrder,
      migrationName: snapshot.migrationName,
      warnings: safeParseWarnings(snapshot.warningsJson),
      stats: safeParseStats(snapshot.statsJson),
    })),
  };
}

export async function getMigrationSnapshot(
  packageId: string,
  connectionId: string,
  ownerId: string,
  migrationOrder: number
): Promise<MigrationSnapshotDTO | null> {
  const pkg = await prisma.migrationPackage.findFirst({
    where: { id: packageId, connectionId, ownerId },
    select: { id: true },
  });

  if (!pkg) return null;

  const snapshot = await prisma.migrationSnapshotRow.findFirst({
    where: { packageId, migrationOrder },
  });

  if (!snapshot) return null;

  return {
    migrationOrder: snapshot.migrationOrder,
    migrationName: snapshot.migrationName,
    diagram: safeParseDiagram(snapshot.diagramJson),
    warnings: safeParseWarnings(snapshot.warningsJson),
    stats: safeParseStats(snapshot.statsJson),
  };
}

export async function getFinalDiagram(
  packageId: string,
  connectionId: string,
  ownerId: string
): Promise<DiagramResponse | null> {
  const pkg = await prisma.migrationPackage.findFirst({
    where: { id: packageId, connectionId, ownerId },
    select: { id: true },
  });

  if (!pkg) return null;

  const lastSnapshot = await prisma.migrationSnapshotRow.findFirst({
    where: { packageId },
    orderBy: { migrationOrder: "desc" },
  });

  if (!lastSnapshot) return null;

  return safeParseDiagram(lastSnapshot.diagramJson);
}

/**
 * Monta o material para o resumo por IA de uma migration: a migration alvo (SQL completo), uma
 * janela opcional de vizinhas (anteriores/posteriores) e a estatística de schema de cada uma.
 * A janela é limitada por `before`/`after` para não estourar o contexto do modelo.
 */
export async function loadMigrationSummaryInput({
  packageId,
  connectionId,
  ownerId,
  order,
  before,
  after,
}: {
  packageId: string;
  connectionId: string;
  ownerId: string;
  order: number;
  before: number;
  after: number;
}): Promise<MigrationSummaryInput | null> {
  const pkg = await prisma.migrationPackage.findFirst({
    where: { id: packageId, connectionId, ownerId },
    select: { id: true, name: true, sourceProvider: true, fileCount: true },
  });
  if (!pkg) return null;

  const start = Math.max(1, order - before);
  const end = order + after;

  const files = await prisma.migrationFile.findMany({
    where: { packageId, order: { gte: start, lte: end } },
    orderBy: { order: "asc" },
    select: { order: true, name: true, content: true },
  });
  const target = files.find((file) => file.order === order);
  if (!target) return null;

  const statsRows = await prisma.migrationSnapshotRow.findMany({
    where: { packageId, migrationOrder: { gte: start, lte: end } },
    select: { migrationOrder: true, statsJson: true },
  });
  const statsByOrder = new Map(statsRows.map((row) => [row.migrationOrder, safeParseStats(row.statsJson)]));

  const toItem = (file: { order: number; name: string; content: string }): MigrationSummaryItem => ({
    order: file.order,
    name: file.name,
    content: file.content,
    stats: statsByOrder.get(file.order) ?? null,
  });

  // O total "antes" vem do snapshot anterior, que pode ficar fora da janela quando before = 0.
  let tablesBefore = 0;
  if (order > 1) {
    const previous = await prisma.migrationSnapshotRow.findFirst({
      where: { packageId, migrationOrder: order - 1 },
      select: { statsJson: true },
    });
    tablesBefore = previous ? safeParseStats(previous.statsJson).tables : 0;
  }

  return {
    packageName: pkg.name,
    sourceProvider: pkg.sourceProvider,
    totalFiles: pkg.fileCount,
    target: toItem(target),
    before: files.filter((file) => file.order < order).map(toItem),
    after: files.filter((file) => file.order > order).map(toItem),
    tablesBefore,
    tablesAfter: statsByOrder.get(order)?.tables ?? 0,
  };
}

/** Metadados leves (sem SQL) de todas as migrations do package, para planejar os lotes do resumo. */
export async function loadPackageSummaryIndex({
  packageId,
  connectionId,
  ownerId,
}: {
  packageId: string;
  connectionId: string;
  ownerId: string;
}): Promise<{
  packageName: string;
  checksum: string;
  sourceProvider: string;
  items: Array<{ order: number; name: string; chars: number; stats: MigrationSnapshotStats | null }>;
} | null> {
  const pkg = await prisma.migrationPackage.findFirst({
    where: { id: packageId, connectionId, ownerId },
    select: { name: true, checksum: true, sourceProvider: true },
  });
  if (!pkg) return null;

  const [files, snapshots] = await Promise.all([
    prisma.migrationFile.findMany({ where: { packageId }, orderBy: { order: "asc" }, select: { order: true, name: true, content: true } }),
    prisma.migrationSnapshotRow.findMany({ where: { packageId }, select: { migrationOrder: true, statsJson: true } }),
  ]);
  const statsByOrder = new Map(snapshots.map((row) => [row.migrationOrder, safeParseStats(row.statsJson)]));

  return {
    packageName: pkg.name,
    checksum: pkg.checksum,
    sourceProvider: pkg.sourceProvider,
    items: files.map((file) => ({
      order: file.order,
      name: file.name,
      chars: file.content.length,
      stats: statsByOrder.get(file.order) ?? null,
    })),
  };
}

/** SQL + estatística das migrations de uma faixa de `order` (inclusive). */
export async function loadMigrationRange({
  packageId,
  connectionId,
  ownerId,
  fromOrder,
  toOrder,
}: {
  packageId: string;
  connectionId: string;
  ownerId: string;
  fromOrder: number;
  toOrder: number;
}): Promise<MigrationSummaryItem[] | null> {
  const pkg = await prisma.migrationPackage.findFirst({
    where: { id: packageId, connectionId, ownerId },
    select: { id: true },
  });
  if (!pkg) return null;

  const [files, snapshots] = await Promise.all([
    prisma.migrationFile.findMany({
      where: { packageId, order: { gte: fromOrder, lte: toOrder } },
      orderBy: { order: "asc" },
      select: { order: true, name: true, content: true },
    }),
    prisma.migrationSnapshotRow.findMany({
      where: { packageId, migrationOrder: { gte: fromOrder, lte: toOrder } },
      select: { migrationOrder: true, statsJson: true },
    }),
  ]);
  const statsByOrder = new Map(snapshots.map((row) => [row.migrationOrder, safeParseStats(row.statsJson)]));

  return files.map((file) => ({
    order: file.order,
    name: file.name,
    content: file.content,
    stats: statsByOrder.get(file.order) ?? null,
  }));
}

export async function createMigrationPackage({
  connectionId,
  ownerId,
  name,
  files,
}: {
  connectionId: string;
  ownerId: string;
  name: string;
  files: MigrationFileInput[];
}): Promise<MigrationPackageDTO> {
  const sourceProvider = detectMigrationProvider(files);
  const migrationFiles = buildMigrationFiles(files);
  const checksum = packageChecksum(migrationFiles);
  const parseResult = parseMigrations(files);

  const created = await prisma.$transaction(async (tx) => {
    const pkg = await tx.migrationPackage.create({
      data: {
        connectionId,
        ownerId,
        name,
        sourceProvider,
        fileCount: migrationFiles.length,
        checksum,
        parserVersion: PARSER_VERSION,
      },
    });

    await tx.migrationFile.createMany({
      data: migrationFiles.map((file) => ({
        packageId: pkg.id,
        order: file.order,
        name: file.name,
        content: file.content,
        checksum: file.checksum,
      })),
    });

    await tx.migrationSnapshotRow.createMany({
      data: parseResult.snapshots.map((snapshot) => ({
        packageId: pkg.id,
        migrationOrder: snapshot.migrationOrder,
        migrationName: snapshot.migrationName,
        diagramJson: JSON.stringify(snapshot.diagram),
        warningsJson: JSON.stringify(snapshot.warnings),
        statsJson: JSON.stringify(snapshot.stats),
      })),
    });

    return pkg;
  });

  return toPackageDTO(created);
}

/**
 * Anexa novos arquivos .sql a um package existente, continuando a timeline.
 * Reprocessa o schema do zero (arquivos antigos + novos) porque a ordenação Flyway é por
 * versão/módulo, não pela ordem de upload — um V6 novo deve encaixar depois do V5 existente
 * mesmo que módulos diferentes se intercalem.
 */
export async function appendMigrationsToPackage({
  packageId,
  connectionId,
  ownerId,
  files,
}: {
  packageId: string;
  connectionId: string;
  ownerId: string;
  files: MigrationFileInput[];
}): Promise<MigrationAppendResultDTO | null> {
  const pkg = await prisma.migrationPackage.findFirst({
    where: { id: packageId, connectionId, ownerId },
    include: { files: { orderBy: { order: "asc" } } },
  });

  if (!pkg) return null;

  const merge = mergeMigrationFiles(
    pkg.files.map((file) => ({ name: file.name, content: file.content, checksum: file.checksum })),
    files
  );

  // Nada novo: não reprocessa nem reescreve snapshots (o append é destrutivo por natureza).
  if (merge.added.length === 0 && merge.changed.length === 0) {
    return {
      package: toPackageDTO(pkg),
      added: merge.added,
      skipped: merge.skipped,
      changed: merge.changed,
    };
  }

  const combinedFiles = merge.files;
  const sourceProvider = detectMigrationProvider(combinedFiles);
  const migrationFiles = buildMigrationFiles(combinedFiles);
  const checksum = packageChecksum(migrationFiles);
  const parseResult = parseMigrations(combinedFiles);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.migrationSnapshotRow.deleteMany({ where: { packageId } });
    await tx.migrationFile.deleteMany({ where: { packageId } });

    await tx.migrationPackage.update({
      where: { id: packageId },
      data: { sourceProvider, fileCount: migrationFiles.length, checksum, parserVersion: PARSER_VERSION },
    });

    await tx.migrationFile.createMany({
      data: migrationFiles.map((file) => ({
        packageId,
        order: file.order,
        name: file.name,
        content: file.content,
        checksum: file.checksum,
      })),
    });

    await tx.migrationSnapshotRow.createMany({
      data: parseResult.snapshots.map((snapshot) => ({
        packageId,
        migrationOrder: snapshot.migrationOrder,
        migrationName: snapshot.migrationName,
        diagramJson: JSON.stringify(snapshot.diagram),
        warningsJson: JSON.stringify(snapshot.warnings),
        statsJson: JSON.stringify(snapshot.stats),
      })),
    });

    return tx.migrationPackage.findFirstOrThrow({ where: { id: packageId } });
  });

  return {
    package: toPackageDTO(updated),
    added: merge.added,
    skipped: merge.skipped,
    changed: merge.changed,
  };
}

function toPackageDTO(pkg: {
  id: string;
  name: string;
  sourceProvider: string;
  fileCount: number;
  checksum: string;
  createdAt: Date;
  parserVersion: number;
}): MigrationPackageDTO {
  return {
    id: pkg.id,
    name: pkg.name,
    sourceProvider: pkg.sourceProvider as MigrationPackageDTO["sourceProvider"],
    fileCount: pkg.fileCount,
    checksum: pkg.checksum,
    createdAt: pkg.createdAt.toISOString(),
    parserVersion: pkg.parserVersion,
    parserStale: pkg.parserVersion !== PARSER_VERSION,
  };
}

/**
 * Reprocessa um pacote já importado: relê os arquivos gravados e regrava todos os snapshots com
 * o parser atual. Necessário porque os snapshots são persistidos — sem isto, um pacote importado
 * com uma versão anterior do parser continua mostrando o resultado antigo (tabelas faltando).
 */
export async function reprocessMigrationPackage({
  packageId,
  connectionId,
  ownerId,
}: {
  packageId: string;
  connectionId: string;
  ownerId: string;
}): Promise<{ package: MigrationPackageDTO; snapshotCount: number; tables: number; warnings: number } | null> {
  const pkg = await prisma.migrationPackage.findFirst({
    where: { id: packageId, connectionId, ownerId },
    include: { files: { orderBy: { order: "asc" } } },
  });
  if (!pkg) return null;

  const inputs: MigrationFileInput[] = pkg.files.map((file) => ({ name: file.name, content: file.content }));
  const migrationFiles = buildMigrationFiles(inputs);
  const parseResult = parseMigrations(inputs);
  const checksum = packageChecksum(migrationFiles);
  const sourceProvider = detectMigrationProvider(inputs);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.migrationSnapshotRow.deleteMany({ where: { packageId } });
    await tx.migrationSnapshotRow.createMany({
      data: parseResult.snapshots.map((snapshot) => ({
        packageId,
        migrationOrder: snapshot.migrationOrder,
        migrationName: snapshot.migrationName,
        diagramJson: JSON.stringify(snapshot.diagram),
        warningsJson: JSON.stringify(snapshot.warnings),
        statsJson: JSON.stringify(snapshot.stats),
      })),
    });

    return tx.migrationPackage.update({
      where: { id: packageId },
      data: {
        sourceProvider,
        fileCount: migrationFiles.length,
        checksum,
        parserVersion: PARSER_VERSION,
      },
    });
  });

  return {
    package: toPackageDTO(updated),
    snapshotCount: parseResult.snapshots.length,
    tables: parseResult.finalDiagram.nodes.length,
    warnings: parseResult.warnings.length,
  };
}

export async function deleteMigrationPackage(
  packageId: string,
  connectionId: string,
  ownerId: string
): Promise<boolean> {
  const pkg = await prisma.migrationPackage.findFirst({
    where: { id: packageId, connectionId, ownerId },
    select: { id: true },
  });

  if (!pkg) return false;

  await prisma.$transaction([
    prisma.migrationSnapshotRow.deleteMany({ where: { packageId: pkg.id } }),
    prisma.migrationFile.deleteMany({ where: { packageId: pkg.id } }),
    prisma.migrationPackage.delete({ where: { id: pkg.id } }),
  ]);
  return true;
}

function safeParseDiagram(value: string): DiagramResponse {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return parsed as DiagramResponse;
    }
  } catch {
    // ignore
  }
  return { nodes: [], edges: [], scopes: [] };
}

function safeParseWarnings(value: string): Array<{ statement: string; reason: string }> {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is { statement: string; reason: string } =>
          !!item && typeof item.statement === "string" && typeof item.reason === "string"
      );
    }
  } catch {
    // ignore
  }
  return [];
}

const EMPTY_STATS: MigrationSnapshotStats = {
  tables: 0,
  columns: 0,
  edges: 0,
  addedTables: [],
  removedTables: [],
  alteredTables: [],
  addedEdges: 0,
  removedEdges: 0,
  schemaWarnings: 0,
  ignoredStatements: 0,
};

/** Lê o statsJson de um snapshot. Linhas gravadas antes desta coluna existir vêm como "{}". */
function safeParseStats(value: string): MigrationSnapshotStats {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const strArray = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return {
        tables: num(parsed.tables),
        columns: num(parsed.columns),
        edges: num(parsed.edges),
        addedTables: strArray(parsed.addedTables),
        removedTables: strArray(parsed.removedTables),
        alteredTables: strArray(parsed.alteredTables),
        addedEdges: num(parsed.addedEdges),
        removedEdges: num(parsed.removedEdges),
        schemaWarnings: num(parsed.schemaWarnings),
        ignoredStatements: num(parsed.ignoredStatements),
      };
    }
  } catch {
    // ignore
  }
  return { ...EMPTY_STATS };
}

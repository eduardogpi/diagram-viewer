import { prisma } from "@/lib/prisma";
import {
  buildMigrationFiles,
  detectMigrationProvider,
  mergeMigrationFiles,
  packageChecksum,
  parseMigrations,
} from "@/lib/services/migration-parser";
import type {
  MigrationAppendResultDTO,
  MigrationFileInput,
  MigrationPackageDTO,
  MigrationPackageDetailDTO,
  MigrationSnapshotDTO,
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
      files: { orderBy: { order: "asc" } },
      snapshots: { orderBy: { migrationOrder: "asc" } },
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
      })),
    });

    return pkg;
  });

  return {
    id: created.id,
    name: created.name,
    sourceProvider: created.sourceProvider as MigrationPackageDTO["sourceProvider"],
    fileCount: created.fileCount,
    checksum: created.checksum,
    createdAt: created.createdAt.toISOString(),
  };
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
      data: { sourceProvider, fileCount: migrationFiles.length, checksum },
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
}): MigrationPackageDTO {
  return {
    id: pkg.id,
    name: pkg.name,
    sourceProvider: pkg.sourceProvider as MigrationPackageDTO["sourceProvider"],
    fileCount: pkg.fileCount,
    checksum: pkg.checksum,
    createdAt: pkg.createdAt.toISOString(),
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

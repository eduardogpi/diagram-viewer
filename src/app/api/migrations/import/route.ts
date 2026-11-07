import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/crypto";
import { errorResponse } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeConnectionHealth, serializeTags } from "@/lib/serializers/connection";
import { readMigrationFilesFromFormData } from "@/lib/services/migration-upload";
import { createMigrationPackage } from "@/lib/services/migrations";
import { logConnectionAudit } from "@/lib/services/workspace";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireCurrentUserId();

    const formData = await req.formData();
    const name = (formData.get("name") as string | null)?.trim();
    if (!name || name.length < 3) {
      return NextResponse.json(
        { error: "Nome do projeto é obrigatório (mínimo 3 caracteres)" },
        { status: 400 }
      );
    }

    if (formData.getAll("files").length === 0) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    const inputs = await readMigrationFilesFromFormData(formData);

    if (inputs.length === 0) {
      return NextResponse.json({ error: "Nenhum arquivo .sql válido enviado" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const secret = await tx.credentialSecret.create({
        data: {
          provider: "MIGRATIONS",
          externalId: `migrations-${Date.now()}`,
          cipherText: encryptSecret("(migrations-only)"),
          metadata: serializeConnectionHealth({
            status: "ONLINE",
            checkedAt: new Date().toISOString(),
            error: null,
          }),
        },
      });

      const connection = await tx.connection.create({
        data: {
          name,
          provider: "MIGRATIONS",
          host: "(migrations)",
          port: 0,
          database: name,
          username: "(migrations)",
          tagsJson: serializeTags(["migrations"]),
          ownerId: userId,
          secretId: secret.id,
        },
      });

      return { connection, secret };
    });

    let pkg;
    try {
      pkg = await createMigrationPackage({
        connectionId: result.connection.id,
        ownerId: userId,
        name,
        files: inputs,
      });
    } catch (pkgError) {
      await prisma
        .$transaction([
          prisma.connection.deleteMany({ where: { id: result.connection.id, ownerId: userId } }),
          prisma.credentialSecret.deleteMany({ where: { id: result.secret.id } }),
        ])
        .catch(() => {});
      throw pkgError;
    }

    await logConnectionAudit({
      action: "MIGRATION_PROJECT_CREATED",
      userId,
      connectionId: result.connection.id,
      context: `${name} (${pkg.fileCount} arquivos, ${pkg.sourceProvider})`,
    });

    return NextResponse.json(
      {
        connectionId: result.connection.id,
        packageId: pkg.id,
        name,
        fileCount: pkg.fileCount,
        sourceProvider: pkg.sourceProvider,
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error, "Falha ao importar projeto de migrations");
  }
}

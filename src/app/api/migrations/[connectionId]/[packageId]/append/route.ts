import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { readMigrationFilesFromFormData } from "@/lib/services/migration-upload";
import { appendMigrationsToPackage } from "@/lib/services/migrations";
import { logConnectionAudit } from "@/lib/services/workspace";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string; packageId: string }> }
) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const formData = await req.formData();
    const inputs = await readMigrationFilesFromFormData(formData);
    if (inputs.length === 0) {
      return NextResponse.json({ error: "Nenhum arquivo .sql válido enviado" }, { status: 400 });
    }

    const result = await appendMigrationsToPackage({
      packageId,
      connectionId,
      ownerId: userId,
      files: inputs,
    });

    if (!result) {
      return NextResponse.json({ error: "Package não encontrado" }, { status: 404 });
    }

    // Só registra auditoria quando algo mudou de fato — reenviar o zip inteiro sem novidades
    // é operação corriqueira e não deve poluir o log.
    if (result.added.length > 0 || result.changed.length > 0) {
      await logConnectionAudit({
        action: "MIGRATION_PACKAGE_APPENDED",
        userId,
        connectionId,
        context: `${result.package.name} (+${result.added.length} nova(s), ${result.changed.length} alterada(s), ${result.skipped.length} ignorada(s), total ${result.package.fileCount})`,
      });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return errorResponse(error, "Falha ao anexar migrations");
  }
}

import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { readMigrationFilesFromFormData } from "@/lib/services/migration-upload";
import { createMigrationPackage } from "@/lib/services/migrations";
import { logConnectionAudit } from "@/lib/services/workspace";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const formData = await req.formData();
    const name = (formData.get("name") as string | null)?.trim();
    if (!name || name.length < 3) {
      return NextResponse.json({ error: "Nome do package é obrigatório (mínimo 3 caracteres)" }, { status: 400 });
    }

    const inputs = await readMigrationFilesFromFormData(formData);
    if (inputs.length === 0) {
      return NextResponse.json({ error: "Nenhum arquivo .sql válido enviado" }, { status: 400 });
    }

    const created = await createMigrationPackage({
      connectionId,
      ownerId: userId,
      name,
      files: inputs,
    });

    await logConnectionAudit({
      action: "MIGRATION_PACKAGE_UPLOADED",
      userId,
      connectionId,
      context: `${created.name} (${created.fileCount} arquivos, ${created.sourceProvider})`,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Falha ao importar migrations");
  }
}

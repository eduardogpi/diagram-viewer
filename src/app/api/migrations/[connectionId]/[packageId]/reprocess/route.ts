import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { reprocessMigrationPackage } from "@/lib/services/migrations";
import { logConnectionAudit } from "@/lib/services/workspace";

type RouteContext = {
  params: Promise<{ connectionId: string; packageId: string }>;
};

/**
 * Reprocessa um pacote de migrations com o parser atual, regravando todos os snapshots.
 * Usado quando o pacote foi importado com uma versão anterior do parser (snapshots defasados).
 */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const result = await reprocessMigrationPackage({ packageId, connectionId, ownerId: userId });
    if (!result) {
      return NextResponse.json({ error: "Package não encontrado" }, { status: 404 });
    }

    await logConnectionAudit({
      action: "MIGRATION_PACKAGE_REPROCESSED",
      userId,
      connectionId,
      context: `${result.package.name} (${result.snapshotCount} snapshots, ${result.tables} tabelas, ${result.warnings} aviso(s))`,
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Falha ao reprocessar o package de migrations");
  }
}

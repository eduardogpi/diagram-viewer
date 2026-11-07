import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { findDriver, toDriverConfig } from "@/lib/db/drivers";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { getFinalDiagram, getMigrationSnapshot } from "@/lib/services/migrations";
import { computeSchemaDrift, type SchemaDriftReport } from "@/lib/services/schema-drift";

type RouteContext = {
  params: Promise<{ connectionId: string; packageId: string }>;
};

export type MigrationDriftResponseDTO = {
  targetConnectionId: string;
  targetConnectionName: string;
  targetProvider: string;
  snapshotOrder: number | null;
  report: SchemaDriftReport;
};

export async function GET(
  req: NextRequest,
  { params }: RouteContext
): Promise<NextResponse<MigrationDriftResponseDTO | { error: string }>> {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;

    const sourceConnection = await findConnectionForUser(connectionId, userId);
    if (!sourceConnection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const url = new URL(req.url);
    const targetConnectionId = url.searchParams.get("targetConnectionId")?.trim() || connectionId;
    const orderParam = url.searchParams.get("order");
    const parsedOrder = orderParam ? Number.parseInt(orderParam, 10) : null;

    const targetConnection =
      targetConnectionId === connectionId
        ? sourceConnection
        : await findConnectionForUser(targetConnectionId, userId);

    if (!targetConnection) {
      return NextResponse.json({ error: "Conexão de banco alvo não encontrada" }, { status: 404 });
    }

    const driver = findDriver(targetConnection.provider);
    if (!driver || !targetConnection.secret) {
      return NextResponse.json(
        {
          error:
            "A conexão selecionada não possui banco de dados ativo (MySQL/PostgreSQL) para comparar o schema ao vivo",
        },
        { status: 422 }
      );
    }

    let expectedDiagram = null;
    if (parsedOrder !== null && Number.isFinite(parsedOrder) && parsedOrder > 0) {
      const snap = await getMigrationSnapshot(packageId, connectionId, userId, parsedOrder);
      expectedDiagram = snap?.diagram ?? null;
    } else {
      expectedDiagram = await getFinalDiagram(packageId, connectionId, userId);
    }

    if (!expectedDiagram) {
      return NextResponse.json({ error: "Package ou snapshot não encontrado" }, { status: 404 });
    }

    const actualDiagram = await driver.buildDiagram(toDriverConfig(targetConnection));
    const dialect = targetConnection.provider === "MYSQL" ? "mysql" : "postgres";
    const report = computeSchemaDrift(expectedDiagram, actualDiagram, dialect);

    return NextResponse.json(
      {
        targetConnectionId: targetConnection.id,
        targetConnectionName: targetConnection.name,
        targetProvider: targetConnection.provider,
        snapshotOrder: parsedOrder,
        report,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error, "Falha ao verificar schema drift com o banco conectado");
  }
}

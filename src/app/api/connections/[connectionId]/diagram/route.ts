import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { requireDriver, toDriverConfig } from "@/lib/db/drivers";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import type { DiagramResponse } from "@/lib/types/diagram";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
): Promise<NextResponse<DiagramResponse | { error: string }>> {
  try {
    const ownerId = await requireCurrentUserId();
    const { connectionId } = await params;

    const connection = await findConnectionForUser(connectionId, ownerId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    if (!connection.secret) {
      return NextResponse.json({ error: "Nenhum segredo associado à conexão" }, { status: 422 });
    }

    const driver = requireDriver(connection.provider);
    const payload = await driver.buildDiagram(toDriverConfig(connection));

    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "SECRET_ENCRYPTION_KEY is not set") {
      return NextResponse.json({ error: "SECRET_ENCRYPTION_KEY não configurada" }, { status: 500 });
    }

    return errorResponse(error, "Falha ao carregar diagrama");
  }
}

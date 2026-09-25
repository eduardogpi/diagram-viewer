import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { getFinalDiagram } from "@/lib/services/migrations";
import type { DiagramResponse } from "@/lib/types/diagram";

type RouteContext = {
  params: Promise<{ connectionId: string; packageId: string }>;
};

export async function GET(
  _req: NextRequest,
  { params }: RouteContext
): Promise<NextResponse<DiagramResponse | { error: string }>> {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const diagram = await getFinalDiagram(packageId, connectionId, userId);
    if (!diagram) {
      return NextResponse.json({ error: "Package não encontrado" }, { status: 404 });
    }

    return NextResponse.json(diagram, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Falha ao carregar diagrama das migrations");
  }
}

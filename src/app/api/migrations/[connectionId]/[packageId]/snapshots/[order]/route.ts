import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { getMigrationSnapshot } from "@/lib/services/migrations";
import type { MigrationSnapshotDTO } from "@/lib/types/migrations";

type RouteContext = {
  params: Promise<{ connectionId: string; packageId: string; order: string }>;
};

export async function GET(
  _req: NextRequest,
  { params }: RouteContext
): Promise<NextResponse<MigrationSnapshotDTO | { error: string }>> {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId, order } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const migrationOrder = Number.parseInt(order, 10);
    if (!Number.isFinite(migrationOrder) || migrationOrder < 1) {
      return NextResponse.json({ error: "Ordem inválida" }, { status: 400 });
    }

    const snapshot = await getMigrationSnapshot(packageId, connectionId, userId, migrationOrder);
    if (!snapshot) {
      return NextResponse.json({ error: "Snapshot não encontrado" }, { status: 404 });
    }

    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Falha ao carregar snapshot da migration");
  }
}

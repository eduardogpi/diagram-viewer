import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { requireDriver, toDriverConfig } from "@/lib/db/drivers";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { buildExplorerCatalog } from "@/lib/services/explorer";
import type { ExplorerCatalog } from "@/lib/types/explorer";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
): Promise<NextResponse<ExplorerCatalog | { error: string }>> {
  try {
    const ownerId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, ownerId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const driver = requireDriver(connection.provider);
    const introspection = await driver.introspect(toDriverConfig(connection), { includeIndexes: true });

    return NextResponse.json(
      buildExplorerCatalog(introspection, { provider: connection.provider, database: connection.database }),
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error, "Falha ao carregar o catálogo de schema");
  }
}

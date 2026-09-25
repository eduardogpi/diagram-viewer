import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { requireDriver, toDriverConfig } from "@/lib/db/drivers";
import { errorResponse, HttpError } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { buildPreviewSql } from "@/lib/services/explorer";
import type { ExplorerPreview } from "@/lib/types/explorer";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
): Promise<NextResponse<ExplorerPreview | { error: string }>> {
  try {
    const ownerId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, ownerId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const table = req.nextUrl.searchParams.get("table")?.trim();
    if (!table) {
      throw new HttpError(400, "Informe a tabela para o preview.");
    }
    const schema = req.nextUrl.searchParams.get("schema")?.trim() || null;
    const requestedLimit = Number(req.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

    const driver = requireDriver(connection.provider);
    const sql = buildPreviewSql(connection.provider, { table, schema }, limit);
    const result = await driver.executeReadOnlyQuery({
      ...toDriverConfig(connection),
      sql,
      rowLimit: limit,
    });

    return NextResponse.json(
      {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
        durationMs: result.durationMs,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error, "Falha ao carregar preview da tabela");
  }
}

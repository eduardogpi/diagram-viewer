import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse, HttpError } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { executeReadOnlyMySqlQuery } from "@/lib/services/mysql-query";
import { listSqlQueryHistory, logConnectionAudit } from "@/lib/services/workspace";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexao nao encontrada" }, { status: 404 });
    }

    const history = await listSqlQueryHistory(connectionId, userId);
    return NextResponse.json(history);
  } catch (error) {
    return errorResponse(error, "Falha ao carregar historico SQL");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  let body: { sql?: string; rowLimit?: number } = {};

  try {
    const userId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexao nao encontrada" }, { status: 404 });
    }

    if (!connection.secret) {
      throw new HttpError(422, "Nenhum segredo associado a conexao.");
    }

    body = (await req.json()) as { sql?: string; rowLimit?: number };
    const result = await executeReadOnlyMySqlQuery({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      database: connection.database,
      cipherText: connection.secret.cipherText,
      sql: body.sql ?? "",
      rowLimit: typeof body.rowLimit === "number" ? body.rowLimit : 200,
    });

    await logConnectionAudit({
      action: "SQL_QUERY_SUCCEEDED",
      userId,
      connectionId,
      context: JSON.stringify({
        sql: body.sql ?? "",
        durationMs: result.durationMs,
        rowCount: result.rowCount,
      }),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao executar consulta";

    try {
      const userId = await requireCurrentUserId();
      const { connectionId } = await params;
      await logConnectionAudit({
        action: "SQL_QUERY_FAILED",
        userId,
        connectionId,
        context: JSON.stringify({
          sql: body.sql ?? "",
          error: message,
        }),
      });
    } catch {
      // ignore secondary audit failure
    }

    return errorResponse(error, "Falha ao executar consulta SQL");
  }
}

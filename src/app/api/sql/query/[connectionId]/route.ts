import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { requireDriver, toDriverConfig } from "@/lib/db/drivers";
import { errorResponse, HttpError } from "@/lib/errors";
import { withTracing } from "@/lib/observability";
import { hashSql, rateLimit, summarizeSql } from "@/lib/security/rate-limit";
import { findConnectionForUser } from "@/lib/services/connections";
import { listSqlQueryHistory, logConnectionAudit } from "@/lib/services/workspace";
import { sqlQuerySchema } from "@/lib/validators/sql";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId } = await params;
    const url = new URL(_req.url);
    const limit = Number(url.searchParams.get("limit") ?? 12);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexao nao encontrada" }, { status: 404 });
    }

    const history = await listSqlQueryHistory(connectionId, userId, Number.isFinite(limit) ? limit : 12, Number.isFinite(offset) ? offset : 0);
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

    const rl = rateLimit("sql", `${userId}:${connectionId}`);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Muitas consultas. Aguarde alguns instantes." },
        { status: 429, headers: rl.retryAfterMs ? { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } : undefined }
      );
    }

    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexao nao encontrada" }, { status: 404 });
    }

    if (!connection.secret) {
      throw new HttpError(422, "Nenhum segredo associado a conexao.");
    }

    const driver = requireDriver(connection.provider);

    const parsed = sqlQuerySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    body = { sql: parsed.data.sql, rowLimit: parsed.data.rowLimit };

    const result = await withTracing(
      "sql.query",
      () =>
        driver.executeReadOnlyQuery({
          ...toDriverConfig(connection),
          sql: body.sql ?? "",
          rowLimit: body.rowLimit ?? 200,
        }),
      { provider: connection.provider }
    );

    // Auditoria sem PII: guarda hash + resumo redatado, nunca literais.
    await logConnectionAudit({
      action: "SQL_QUERY_SUCCEEDED",
      userId,
      connectionId,
      context: JSON.stringify({
        sqlHash: hashSql(body.sql ?? ""),
        sqlSummary: summarizeSql(body.sql ?? ""),
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
          sqlHash: hashSql(body.sql ?? ""),
          sqlSummary: summarizeSql(body.sql ?? ""),
          error: message.slice(0, 200),
        }),
      });
    } catch {
      // ignore secondary audit failure
    }

    return errorResponse(error, "Falha ao executar consulta SQL");
  }
}

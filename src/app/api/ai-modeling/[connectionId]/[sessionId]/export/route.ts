import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { exportAiModelingSql, exportAiModelingToPackage } from "@/lib/services/ai-modeling";
import { findConnectionForUser } from "@/lib/services/connections";
import { isDdlDialect, type DdlDialect } from "@/lib/services/ddl-generator";
import { logConnectionAudit } from "@/lib/services/workspace";

type RouteContext = { params: Promise<{ connectionId: string; sessionId: string }> };

function resolveDialect(raw: string | null): DdlDialect {
  return raw && isDdlDialect(raw) ? raw : "mysql";
}

/** Download do DDL gerado a partir do estado atual da modelagem. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, sessionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const dialect = resolveDialect(req.nextUrl.searchParams.get("dialect"));
    const databaseName = req.nextUrl.searchParams.get("database")?.trim() || undefined;
    const exported = await exportAiModelingSql({
      sessionId,
      connectionId,
      ownerId: userId,
      dialect,
      databaseName,
    });
    if (!exported) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    return new NextResponse(exported.sql, {
      headers: {
        "content-type": "application/sql; charset=utf-8",
        "content-disposition": `attachment; filename="${exported.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "Falha ao exportar SQL da modelagem");
  }
}

/**
 * Materializa a modelagem como um package de migrations na própria conexão — o modelo entra na
 * timeline e passa a aceitar append, reaproveitando toda a infra de migrations.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, sessionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      dialect?: unknown;
      database?: unknown;
      packageName?: unknown;
    };

    const dialect = resolveDialect(typeof body.dialect === "string" ? body.dialect : null);
    const databaseName = typeof body.database === "string" && body.database.trim() ? body.database.trim() : undefined;
    const packageName =
      typeof body.packageName === "string" && body.packageName.trim().length >= 3
        ? body.packageName.trim()
        : undefined;

    const pkg = await exportAiModelingToPackage({
      sessionId,
      connectionId,
      ownerId: userId,
      dialect,
      databaseName,
      packageName,
    });
    if (!pkg) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    await logConnectionAudit({
      action: "AI_MODELING_EXPORTED_TO_PACKAGE",
      userId,
      connectionId,
      context: `${pkg.name} (${dialect})`,
    });

    return NextResponse.json(pkg, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Falha ao salvar a modelagem como migrations");
  }
}

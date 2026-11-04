import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { summarizeMigration } from "@/lib/services/migration-summary";
import { logConnectionAudit } from "@/lib/services/workspace";
import { migrationSummaryRequestSchema } from "@/lib/validators/migration";

type RouteContext = {
  params: Promise<{ connectionId: string; packageId: string }>;
};

/**
 * Gera um resumo por IA de uma migration, opcionalmente com as migrations vizinhas como contexto.
 * Usa o mesmo roteador de provedores da Modelagem IA (gemini/openrouter/nvidia).
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = migrationSummaryRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Parâmetros inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await summarizeMigration({
      packageId,
      connectionId,
      ownerId: userId,
      ...parsed.data,
    });

    if (!result) {
      return NextResponse.json({ error: "Migration não encontrada neste package" }, { status: 404 });
    }

    await logConnectionAudit({
      action: "MIGRATION_SUMMARY_GENERATED",
      userId,
      connectionId,
      context: `#${parsed.data.order} (${result.provider}/${result.model}, contexto: ${result.context.before} antes, ${result.context.after} depois)`,
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Falha ao gerar o resumo da migration");
  }
}

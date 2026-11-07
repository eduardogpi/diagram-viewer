import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { documentAiModelingSession } from "@/lib/services/ai-modeling";
import { findConnectionForUser } from "@/lib/services/connections";
import { logConnectionAudit } from "@/lib/services/workspace";

/** Documenta em lote (via LLM da sessão) as tabelas/colunas que ainda não têm comentário. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string; sessionId: string }> }
) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, sessionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as { tables?: unknown };
    const tables = Array.isArray(body.tables)
      ? body.tables.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 500)
      : undefined;

    const result = await documentAiModelingSession({ sessionId, connectionId, ownerId: userId, tables });
    if (!result) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    await logConnectionAudit({
      action: "AI_MODELING_DOCUMENT_UI",
      userId,
      connectionId,
      context: `${sessionId}: ${result.commented.tables} tabela(s), ${result.commented.columns} coluna(s)`,
    });

    return NextResponse.json(result, { status: result.assistantTurn ? 201 : 200 });
  } catch (error) {
    return errorResponse(error, "Falha ao documentar o modelo");
  }
}

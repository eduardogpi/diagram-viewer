import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { revertAiModelingSession } from "@/lib/services/ai-modeling";
import { findConnectionForUser } from "@/lib/services/connections";
import { logConnectionAudit } from "@/lib/services/workspace";

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

    const body = await req.json().catch(() => ({}));
    const turnOrder = Number(body?.turnOrder);
    if (!Number.isInteger(turnOrder) || turnOrder < 1) {
      return NextResponse.json({ error: "turnOrder inválido" }, { status: 400 });
    }

    const result = await revertAiModelingSession({ sessionId, connectionId, ownerId: userId, turnOrder });
    if (!result) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    await logConnectionAudit({
      action: "AI_MODELING_REVERT",
      userId,
      connectionId,
      context: `${sessionId}: voltou para o turno ${turnOrder}`,
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Falha ao voltar para o checkpoint");
  }
}

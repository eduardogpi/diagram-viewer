import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { postAiModelingTurn } from "@/lib/services/ai-modeling";
import { findConnectionForUser } from "@/lib/services/connections";
import { logConnectionAudit } from "@/lib/services/workspace";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string; sessionId: string }> }
) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, sessionId } = await params;

    const rl = rateLimit("ai", userId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Limite de mensagens de modelagem atingido. Aguarde alguns instantes." },
        { status: 429, headers: rl.retryAfterMs ? { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } : undefined }
      );
    }

    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
    }
    if (message.length > 4000) {
      return NextResponse.json({ error: "Mensagem muito longa (máximo 4000 caracteres)" }, { status: 400 });
    }
    const discussOnly = body?.discussOnly === true;

    const result = await postAiModelingTurn({ sessionId, connectionId, ownerId: userId, message, discussOnly });
    if (!result) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    await logConnectionAudit({
      action: "AI_MODELING_TURN",
      userId,
      connectionId,
      context: `${sessionId}: +${result.assistantTurn.operations.length} operação(ões)`,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Falha ao processar mensagem");
  }
}

import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { createAiModelingSession, listAiModelingSessions } from "@/lib/services/ai-modeling";
import { findConnectionForUser } from "@/lib/services/connections";
import { logConnectionAudit } from "@/lib/services/workspace";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const sessions = await listAiModelingSessions(connectionId, userId);
    return NextResponse.json(sessions, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Falha ao listar sessões de modelagem");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length < 3) {
      return NextResponse.json({ error: "Nome da sessão é obrigatório (mínimo 3 caracteres)" }, { status: 400 });
    }
    const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const provider = typeof body?.provider === "string" && body.provider.trim() ? body.provider.trim() : undefined;

    const session = await createAiModelingSession({ connectionId, ownerId: userId, name, model, provider });

    await logConnectionAudit({
      action: "AI_MODELING_SESSION_CREATED",
      userId,
      connectionId,
      context: session.name,
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Falha ao criar sessão de modelagem");
  }
}

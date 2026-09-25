import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import {
  deleteAiModelingSession,
  getAiModelingSession,
  updateAiModelingSession,
} from "@/lib/services/ai-modeling";
import { findConnectionForUser } from "@/lib/services/connections";
import { logConnectionAudit } from "@/lib/services/workspace";

type RouteContext = { params: Promise<{ connectionId: string; sessionId: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, sessionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const detail = await getAiModelingSession(sessionId, connectionId, userId);
    if (!detail) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    return NextResponse.json(detail, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Falha ao carregar sessão de modelagem");
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, sessionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      model?: unknown;
      provider?: unknown;
      name?: unknown;
      memoryEnabled?: unknown;
      memoryProjectId?: unknown;
    };

    const updated = await updateAiModelingSession({
      sessionId,
      connectionId,
      ownerId: userId,
      model: typeof body.model === "string" ? body.model.trim() : undefined,
      provider: typeof body.provider === "string" ? body.provider.trim() : undefined,
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      memoryEnabled: typeof body.memoryEnabled === "boolean" ? body.memoryEnabled : undefined,
      memoryProjectId:
        typeof body.memoryProjectId === "string"
          ? body.memoryProjectId
          : body.memoryProjectId === null
            ? null
            : undefined,
    });

    if (!updated) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    if (body.model || body.provider) {
      await logConnectionAudit({
        action: "AI_MODELING_MODEL_CHANGED",
        userId,
        connectionId,
        context: `${sessionId}: modelo alterado para ${updated.provider} / ${updated.model}`,
      }).catch(() => {});
    }

    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "Falha ao atualizar sessão de modelagem");
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, sessionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const removed = await deleteAiModelingSession(sessionId, connectionId, userId);
    if (!removed) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    await logConnectionAudit({
      action: "AI_MODELING_SESSION_DELETED",
      userId,
      connectionId,
      context: sessionId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Falha ao remover sessão de modelagem");
  }
}

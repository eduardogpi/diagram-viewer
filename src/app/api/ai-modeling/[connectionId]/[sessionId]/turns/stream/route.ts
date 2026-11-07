import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { postAiModelingTurnStream } from "@/lib/services/ai-modeling";
import { findConnectionForUser } from "@/lib/services/connections";
import { logConnectionAudit } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";

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
      return new Response(JSON.stringify({ error: "Conexão não encontrada" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) {
      return new Response(JSON.stringify({ error: "Mensagem vazia" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (message.length > 4000) {
      return new Response(JSON.stringify({ error: "Mensagem muito longa (máximo 4000 caracteres)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const discussOnly = body?.discussOnly === true;

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    function sendEvent(event: string, data: unknown) {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      writer.write(encoder.encode(payload)).catch(() => {});
    }

    (async () => {
      try {
        sendEvent("status", { status: "thinking" });

        const result = await postAiModelingTurnStream({
          sessionId,
          connectionId,
          ownerId: userId,
          message,
          discussOnly,
          onReplyDelta(delta) {
            sendEvent("delta", { delta });
          },
        });

        if (!result) {
          sendEvent("error", { error: "Sessão não encontrada" });
          return;
        }

        await logConnectionAudit({
          action: "AI_MODELING_TURN_STREAM",
          userId,
          connectionId,
          context: `${sessionId}: +${result.assistantTurn.operations.length} operação(ões)`,
        }).catch(() => {});

        sendEvent("done", result);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Falha ao processar mensagem";
        sendEvent("error", { error: errorMessage });
      } finally {
        writer.close().catch(() => {});
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return errorResponse(error, "Falha na autenticação ou parâmetros");
  }
}

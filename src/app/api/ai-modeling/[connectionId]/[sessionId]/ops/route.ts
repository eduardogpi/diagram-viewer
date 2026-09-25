import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { postAiModelingOperations } from "@/lib/services/ai-modeling";
import { findConnectionForUser } from "@/lib/services/connections";
import { schemaOpSchema } from "@/lib/services/schema-ops";
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

    const body = (await req.json().catch(() => ({}))) as { message?: unknown; operations?: unknown };
    const parsed = schemaOpSchema.array().min(1).safeParse(body.operations);
    if (!parsed.success) {
      return NextResponse.json({ error: "Operações inválidas", details: parsed.error.flatten() }, { status: 400 });
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const result = await postAiModelingOperations({
      sessionId,
      connectionId,
      ownerId: userId,
      message: message || "Edição manual no diagrama.",
      operations: parsed.data,
    });
    if (!result) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    await logConnectionAudit({
      action: "AI_MODELING_OPS_UI",
      userId,
      connectionId,
      context: `${sessionId}: +${parsed.data.length - result.warnings.length} operação(ões)`,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Falha ao aplicar operações");
  }
}

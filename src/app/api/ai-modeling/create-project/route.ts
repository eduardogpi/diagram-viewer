import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/crypto";
import { errorResponse } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeConnectionHealth, serializeTags } from "@/lib/serializers/connection";
import { createAiModelingSession } from "@/lib/services/ai-modeling";
import { logConnectionAudit } from "@/lib/services/workspace";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireCurrentUserId();
    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length < 3) {
      return NextResponse.json({ error: "Nome do projeto é obrigatório (mínimo 3 caracteres)" }, { status: 400 });
    }
    const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const provider = typeof body?.provider === "string" && body.provider.trim() ? body.provider.trim() : undefined;

    const { connection } = await prisma.$transaction(async (tx) => {
      const secret = await tx.credentialSecret.create({
        data: {
          provider: "MIGRATIONS",
          externalId: `ai-modeling-${Date.now()}`,
          cipherText: encryptSecret("(ai-modeling-only)"),
          metadata: serializeConnectionHealth({
            status: "ONLINE",
            checkedAt: new Date().toISOString(),
            error: null,
          }),
        },
      });

      const connection = await tx.connection.create({
        data: {
          name,
          provider: "MIGRATIONS",
          host: "(ai-modeling)",
          port: 0,
          database: name,
          username: "(ai-modeling)",
          tagsJson: serializeTags(["ai-modeling"]),
          ownerId: userId,
          secretId: secret.id,
        },
      });

      return { connection };
    });

    const session = await createAiModelingSession({ connectionId: connection.id, ownerId: userId, name, model, provider });

    await logConnectionAudit({
      action: "AI_MODELING_PROJECT_CREATED",
      userId,
      connectionId: connection.id,
      context: name,
    });

    return NextResponse.json({ connectionId: connection.id, sessionId: session.id, name }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Falha ao criar projeto de modelagem com IA");
  }
}

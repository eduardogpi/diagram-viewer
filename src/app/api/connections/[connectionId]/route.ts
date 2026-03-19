import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeTags } from "@/lib/serializers/connection";
import { findConnectionForUser } from "@/lib/services/connections";
import { logConnectionAudit } from "@/lib/services/workspace";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const ownerId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, ownerId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const body = (await req.json()) as { name?: string; tags?: string[] };
    const updated = await prisma.connection.update({
      where: { id: connection.id },
      data: {
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : connection.name,
        tagsJson: Array.isArray(body.tags) ? serializeTags(body.tags) : connection.tagsJson,
      },
      select: {
        id: true,
        name: true,
      },
    });

    await logConnectionAudit({
      action: "CONNECTION_UPDATED",
      userId: ownerId,
      connectionId: connection.id,
      context: `Nome atualizado para ${updated.name}`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "Falha ao atualizar conexão");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const ownerId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, ownerId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.auditLog.updateMany({
        where: { connectionId: connection.id },
        data: { connectionId: null },
      });

      await tx.connection.delete({
        where: { id: connection.id },
      });

      const remainingUsages = await tx.connection.count({
        where: { secretId: connection.secretId },
      });

      if (remainingUsages === 0) {
        await tx.credentialSecret.delete({
          where: { id: connection.secretId },
        });
      }
    });

    await logConnectionAudit({
      action: "CONNECTION_DELETED",
      userId: ownerId,
      connectionId: undefined,
      context: `${connection.provider} ${connection.host}:${connection.port}/${connection.database}`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Falha ao remover conexão");
  }
}

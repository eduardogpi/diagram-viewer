import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { decryptSecret } from "@/lib/crypto";
import { errorResponse } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeConnectionHealth } from "@/lib/serializers/connection";
import { findConnectionForUser } from "@/lib/services/connections";
import { logConnectionAudit } from "@/lib/services/workspace";
import { testMySQLConnection } from "@/lib/db/mysql";

export async function POST(
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

    if (!connection.secret) {
      return NextResponse.json({ error: "Nenhum segredo associado à conexão" }, { status: 422 });
    }

    try {
      await testMySQLConnection({
        host: connection.host,
        port: connection.port,
        user: connection.username,
        password: decryptSecret(connection.secret.cipherText),
        database: connection.database,
      });

      await prisma.credentialSecret.update({
        where: { id: connection.secret.id },
        data: {
          metadata: serializeConnectionHealth({
            status: "ONLINE",
            checkedAt: new Date().toISOString(),
            error: null,
          }),
        },
      });

      await logConnectionAudit({
        action: "CONNECTION_RETEST_OK",
        userId: ownerId,
        connectionId: connection.id,
        context: `${connection.host}:${connection.port}/${connection.database}`,
      });

      return NextResponse.json({ status: "ONLINE" });
    } catch (error) {
      await prisma.credentialSecret.update({
        where: { id: connection.secret.id },
        data: {
          metadata: serializeConnectionHealth({
            status: "OFFLINE",
            checkedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Falha ao testar conexão",
          }),
        },
      });

      await logConnectionAudit({
        action: "CONNECTION_RETEST_FAILED",
        userId: ownerId,
        connectionId: connection.id,
        context: error instanceof Error ? error.message : "Falha ao testar conexão",
      });

      return NextResponse.json(
        { status: "OFFLINE", error: error instanceof Error ? error.message : "Falha ao testar conexão" },
        { status: 400 }
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "SECRET_ENCRYPTION_KEY is not set") {
      return NextResponse.json({ error: "SECRET_ENCRYPTION_KEY não configurada" }, { status: 500 });
    }

    return errorResponse(error, "Falha ao retestar conexão");
  }
}

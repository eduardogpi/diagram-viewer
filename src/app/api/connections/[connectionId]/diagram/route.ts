import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { buildMySqlDiagram } from "@/lib/services/mysql-diagram";
import type { DiagramResponse } from "@/lib/types/diagram";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
): Promise<NextResponse<DiagramResponse | { error: string }>> {
  const { connectionId } = await params;

  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    include: { secret: true },
  });

  if (!connection) {
    return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
  }

  if (!connection.secret) {
    return NextResponse.json({ error: "Nenhum segredo associado à conexão" }, { status: 422 });
  }

  try {
    const payload = await buildMySqlDiagram({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      database: connection.database,
      cipherText: connection.secret.cipherText,
    });

    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao montar diagrama", error);
    return NextResponse.json({ error: "Falha ao carregar diagrama" }, { status: 500 });
  }
}

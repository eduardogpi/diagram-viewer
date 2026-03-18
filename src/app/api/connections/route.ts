import { NextResponse, NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { connectionPayloadSchema, ConnectionProvider } from "@/lib/validators/connection";
import { encryptSecret } from "@/lib/crypto";
import { testMySQLConnection } from "@/lib/db/mysql";
import { parseTagsJson, serializeTags } from "@/lib/serializers/connection";

async function ensureConnectionWorks(payload: {
  provider: ConnectionProvider;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}) {
  switch (payload.provider) {
    case "MYSQL":
      await testMySQLConnection({
        host: payload.host,
        port: payload.port,
        user: payload.username,
        password: payload.password,
        database: payload.database,
      });
      return;
    default:
      throw new Error(`Provider ${payload.provider} ainda não suportado para teste automático.`);
  }
}

export async function GET() {
  const connections = await prisma.connection.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      provider: true,
      host: true,
      port: true,
      database: true,
      username: true,
      tagsJson: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    connections.map((conn) => ({
      id: conn.id,
      name: conn.name,
      provider: conn.provider,
      host: conn.host,
      port: conn.port,
      database: conn.database,
      username: conn.username,
      tags: parseTagsJson(conn.tagsJson),
      createdAt: conn.createdAt,
    }))
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = connectionPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const payload = parsed.data;

  try {
    await ensureConnectionWorks(payload);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "Falha ao testar conexão" },
      { status: 400 }
    );
  }

  const cipherText = encryptSecret(payload.password);

  const connection = await prisma.$transaction(async (tx) => {
    const secret = await tx.credentialSecret.create({
      data: {
        provider: payload.provider,
        externalId: `local-${Date.now()}`,
        cipherText,
      },
    });

    return tx.connection.create({
      data: {
        name: payload.name,
        provider: payload.provider,
        host: payload.host,
        port: payload.port,
        database: payload.database,
        username: payload.username,
        tagsJson: serializeTags(payload.tags),
        ownerId: "demo-user",
        secretId: secret.id,
      },
      select: {
        id: true,
        name: true,
        provider: true,
        host: true,
        port: true,
        database: true,
        username: true,
        tagsJson: true,
      },
    });
  });

  return NextResponse.json(
    {
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      tags: parseTagsJson(connection.tagsJson),
    },
    { status: 201 }
  );
}

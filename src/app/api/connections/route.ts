import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/crypto";
import { findDriver } from "@/lib/db/drivers";
import { errorResponse, HttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/security/rate-limit";
import { assertPublicDbHost } from "@/lib/security/ssrf";
import { parseConnectionHealth, parseTagsJson, serializeConnectionHealth, serializeTags } from "@/lib/serializers/connection";
import { listConnectionsForUser } from "@/lib/services/connections";
import { logConnectionAudit } from "@/lib/services/workspace";
import { connectionPayloadSchema, type ConnectionProvider } from "@/lib/validators/connection";

async function ensureConnectionWorks(payload: {
  provider: ConnectionProvider;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  schema?: string;
}) {
  // MIGRATIONS não tem banco real por trás — nada a testar.
  if (payload.provider === "MIGRATIONS") return;

  // Anti-SSRF: resolve o host e garante que não aponta para IP privado/loopback.
  await assertPublicDbHost(payload.host);

  const driver = findDriver(payload.provider);
  if (!driver) {
    throw new HttpError(400, `Provider ${payload.provider} ainda não suportado para teste automático.`);
  }

  await driver.testConnection({
    host: payload.host,
    port: payload.port,
    username: payload.username,
    password: payload.password,
    database: payload.database,
    schema: payload.schema ?? null,
  });
}

export async function GET() {
  try {
    const ownerId = await requireCurrentUserId();
    const connections = await listConnectionsForUser(ownerId);
    return NextResponse.json(connections);
  } catch (error) {
    return errorResponse(error, "Falha ao listar conexões");
  }
}

export async function POST(req: NextRequest) {
  try {
    const ownerId = await requireCurrentUserId();
    const rl = rateLimit("connections", ownerId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas de criar conexão. Aguarde alguns instantes." },
        { status: 429, headers: rl.retryAfterMs ? { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } : undefined }
      );
    }
    const body = await req.json();
    const parsed = connectionPayloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    await ensureConnectionWorks(payload);

    const cipherText = encryptSecret(payload.password);

    const connection = await prisma.$transaction(async (tx) => {
      const secret = await tx.credentialSecret.create({
        data: {
          provider: payload.provider,
          externalId: `local-${Date.now()}`,
          cipherText,
          metadata: serializeConnectionHealth({
            status: "ONLINE",
            checkedAt: new Date().toISOString(),
            error: null,
          }),
        },
      });

      return tx.connection.create({
        data: {
          name: payload.name,
          provider: payload.provider,
          host: payload.host,
          port: payload.port,
          database: payload.database,
          // Só faz sentido para providers que separam database de schema.
          schema: findDriver(payload.provider)?.schemaField ? (payload.schema ?? null) : null,
          username: payload.username,
          tagsJson: serializeTags(payload.tags),
          ownerId,
          secretId: secret.id,
        },
        select: {
          id: true,
          name: true,
          provider: true,
          host: true,
          port: true,
          database: true,
          schema: true,
          username: true,
          tagsJson: true,
          secret: {
            select: {
              metadata: true,
            },
          },
        },
      });
    });

    await logConnectionAudit({
      action: "CONNECTION_CREATED",
      userId: ownerId,
      connectionId: connection.id,
      context: `${connection.provider} ${connection.host}:${connection.port}/${connection.database}`,
    });

    return NextResponse.json(
      {
        id: connection.id,
        name: connection.name,
        provider: connection.provider,
        host: connection.host,
        port: connection.port,
        database: connection.database,
        schema: connection.schema,
        username: connection.username,
        tags: parseTagsJson(connection.tagsJson),
        health: parseConnectionHealth(connection.secret?.metadata),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "SECRET_ENCRYPTION_KEY is not set") {
      return NextResponse.json({ error: "SECRET_ENCRYPTION_KEY não configurada" }, { status: 500 });
    }

    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message !== "UNAUTHENTICATED") {
      // Não vazar mensagem crua do driver (pode conter host/porta/credenciais na mensagem)
      return NextResponse.json({ error: "Falha ao testar conexão" }, { status: 400 });
    }

    return errorResponse(error, "Falha ao criar conexão");
  }
}

import { prisma } from "@/lib/prisma";
import { parseConnectionHealth, parseTagsJson } from "@/lib/serializers/connection";

export async function listConnectionsForUser(ownerId: string) {
  const connections = await prisma.connection.findMany({
    where: { ownerId },
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
      updatedAt: true,
      secret: {
        select: {
          metadata: true,
        },
      },
    },
  });

  return connections.map((conn) => ({
    id: conn.id,
    name: conn.name,
    provider: conn.provider,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    username: conn.username,
    tags: parseTagsJson(conn.tagsJson),
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    health: parseConnectionHealth(conn.secret?.metadata),
  }));
}

export async function findConnectionForUser(connectionId: string, ownerId: string) {
  return prisma.connection.findFirst({
    where: {
      id: connectionId,
      ownerId,
    },
    include: { secret: true },
  });
}

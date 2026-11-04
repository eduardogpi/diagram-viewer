import { prisma } from "@/lib/prisma";
import { parseConnectionHealth, parseTagsJson } from "@/lib/serializers/connection";
import {
  parseDiagramPreferences,
  parseLayoutSettings,
  serializeDiagramPreferences,
  serializeLayoutSettings,
  type DiagramPreferences,
} from "@/lib/serializers/workspace";

export async function getWorkspaceConnectionForUser(connectionId: string, ownerId: string) {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, ownerId },
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
      secret: { select: { metadata: true } },
    },
  });

  if (!connection) {
    return null;
  }

  return {
    ...connection,
    tags: parseTagsJson(connection.tagsJson),
    health: parseConnectionHealth(connection.secret?.metadata),
  };
}

export async function getWorkspacePreference(userId: string, connectionId: string) {
  const preference = await prisma.workspacePreference.findUnique({
    where: { userId_connectionId: { userId, connectionId } },
  });

  const favoriteTabs = preference?.favoriteTabs ? safeParseStringArray(preference.favoriteTabs) : [];

  return {
    favoriteTabs,
    minimap: preference?.minimap ?? true,
    scopeDepth: preference?.scopeDepth ?? 2,
    diagramPreferences: parseDiagramPreferences(preference?.theme),
  };
}

export async function upsertFavoriteTab(userId: string, connectionId: string, favoriteTab: string) {
  return prisma.workspacePreference.upsert({
    where: { userId_connectionId: { userId, connectionId } },
    update: {
      favoriteTabs: JSON.stringify([favoriteTab]),
    },
    create: {
      userId,
      connectionId,
      favoriteTabs: JSON.stringify([favoriteTab]),
    },
  });
}

export async function updateDiagramPreferences(
  userId: string,
  connectionId: string,
  preferences: Partial<DiagramPreferences>
) {
  const current = await prisma.workspacePreference.findUnique({
    where: { userId_connectionId: { userId, connectionId } },
  });

  const currentPreferences = parseDiagramPreferences(current?.theme);
  const nextPreferences = {
    ...currentPreferences,
    ...preferences,
  };

  return prisma.workspacePreference.upsert({
    where: { userId_connectionId: { userId, connectionId } },
    update: {
      minimap: nextPreferences.minimap,
      scopeDepth: nextPreferences.scopeDepth,
      theme: serializeDiagramPreferences(nextPreferences),
    },
    create: {
      userId,
      connectionId,
      minimap: nextPreferences.minimap,
      scopeDepth: nextPreferences.scopeDepth,
      theme: serializeDiagramPreferences(nextPreferences),
    },
  });
}

export async function listRecentConnectionEvents(connectionId: string, limit = 6, offset = 0) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return prisma.auditLog.findMany({
    where: { connectionId },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
    skip: Math.max(offset, 0),
  });
}

export async function listSqlQueryHistory(connectionId: string, userId: string, limit = 12, offset = 0) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const logs = await prisma.auditLog.findMany({
    where: {
      connectionId,
      userId,
      action: {
        in: ["SQL_QUERY_SUCCEEDED", "SQL_QUERY_FAILED"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
    skip: Math.max(offset, 0),
  });

  return logs
    .map((log) => {
      const payload = safeParseObject(log.context);
      // Registros antigos tinham `sql` em claro; novos têm `sqlSummary` redatado.
      const sql = typeof payload.sqlSummary === "string" ? payload.sqlSummary : typeof payload.sql === "string" ? payload.sql : "";
      return {
        id: log.id,
        action: log.action,
        createdAt: log.createdAt.toISOString(),
        sql,
        sqlHash: typeof payload.sqlHash === "string" ? payload.sqlHash : null,
        durationMs: typeof payload.durationMs === "number" ? payload.durationMs : null,
        rowCount: typeof payload.rowCount === "number" ? payload.rowCount : null,
        error: typeof payload.error === "string" ? payload.error : null,
      };
    })
    .filter((item) => item.sql);
}

export async function listLayoutSnapshots(connectionId: string, limit = 10, offset = 0) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const snapshots = await prisma.layoutSnapshot.findMany({
    where: { connectionId },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
    skip: Math.max(offset, 0),
  });

  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    name: snapshot.name,
    nodes: safeParseNodes(snapshot.nodes),
    edges: safeParseEdges(snapshot.edges),
    settings: parseLayoutSettings(snapshot.settings),
    createdAt: snapshot.createdAt.toISOString(),
    createdBy: snapshot.createdBy,
  }));
}

export async function createLayoutSnapshot({
  connectionId,
  name,
  nodes,
  edges,
  settings,
  createdBy,
}: {
  connectionId: string;
  name: string;
  nodes: Array<{ id: string; position: { x: number; y: number } }>;
  edges: string[];
  settings: Partial<DiagramPreferences>;
  createdBy: string;
}) {
  const checksum = `${Date.now()}-${nodes.length}-${edges.length}`;
  return prisma.layoutSnapshot.create({
    data: {
      connectionId,
      name,
      checksum,
      nodes: JSON.stringify(nodes),
      edges: JSON.stringify(edges),
      settings: serializeLayoutSettings(settings),
      createdBy,
    },
  });
}

export async function logConnectionAudit({
  action,
  userId,
  connectionId,
  context,
}: {
  action: string;
  userId: string;
  connectionId?: string;
  context?: string;
}) {
  return prisma.auditLog.create({
    data: {
      action,
      userId,
      connectionId,
      context,
    },
  });
}

function safeParseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function safeParseNodes(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is { id: string; position: { x: number; y: number } } =>
            !!item &&
            typeof item.id === "string" &&
            item.position &&
            typeof item.position.x === "number" &&
            typeof item.position.y === "number"
        )
      : [];
  } catch {
    return [];
  }
}

function safeParseEdges(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function safeParseObject(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

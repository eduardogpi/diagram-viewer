import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { computeDiagramDiff } from "@/lib/diagram-diff";
import { prisma } from "@/lib/prisma";
import { parseTagsJson } from "@/lib/serializers/connection";
import {
  createAiModelingSession,
  deleteAiModelingSession,
  exportAiModelingSql,
  exportAiModelingToPackage,
  getAiModelingSession,
  listAiModelingSessions,
  postAiModelingOperations,
  postAiModelingTurn,
  revertAiModelingSession,
  updateAiModelingMemory,
} from "@/lib/services/ai-modeling";
import { isDdlDialect } from "@/lib/services/ddl-generator";
import { availableLlmProviders, currentLlmProvider } from "@/lib/services/llm";
import { isMemoryConfigured } from "@/lib/services/memory";
import { schemaOpSchema, type SchemaOp } from "@/lib/services/schema-ops";
import { logConnectionAudit } from "@/lib/services/workspace";
import { getStickyState } from "@/mcp/session-store";

/**
 * Servidor MCP do AI Modeling: expõe as sessões de modelagem (as mesmas da aba "Modelagem IA"
 * no workbench) como tools para Claude Code, Codex, Devin etc. Toda alteração cai nas mesmas
 * tabelas Prisma — a UI aberta enxerga as mudanças pelo polling do AiModelingWorkbench.
 */

// --- Seleção de conexão: explícita > sticky (use_connection) > MCP_CONNECTION_ID > única ---

type ConnectionRef = {
  id: string;
  name: string;
  provider: string;
  database: string;
  host: string;
  port: number;
  tags: string[];
  environments: string[];
};

const ENV_TAGS = new Set(["dev", "homolog", "prod", "staging", "local", "test"]);

/** Nomes/ids liberados via MCP_ALLOWED_CONNECTIONS (vírgula). Vazio = todas as do usuário. */
const allowlist = new Set(
  (process.env.MCP_ALLOWED_CONNECTIONS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
);

const allowedEnvironments = new Set(
  (process.env.MCP_ALLOWED_ENVIRONMENTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
);

function environmentsOf(tags: string[]): string[] {
  return tags.filter((tag) => ENV_TAGS.has(tag.toLowerCase()));
}

function allowedByEnvironment(tags: string[]): boolean {
  if (allowedEnvironments.size === 0) return true;
  const envs = environmentsOf(tags).map((tag) => tag.toLowerCase());
  if (envs.length === 0) return process.env.MCP_REQUIRE_ENV_TAG !== "1";
  return envs.some((env) => allowedEnvironments.has(env));
}

type ToolExtra = { sessionId?: string };

async function resolveOwnerId(extra?: ToolExtra): Promise<string> {
  if (process.env.MCP_USER_ID?.trim()) return process.env.MCP_USER_ID.trim();
  const sticky = getStickyState(extra?.sessionId);
  if (sticky.ownerId) return sticky.ownerId;
  // Conveniência local: com um usuário só, usa o dono da conexão mexida mais recentemente.
  const latest = await prisma.connection.findFirst({ orderBy: { updatedAt: "desc" }, select: { ownerId: true } });
  if (!latest) {
    throw new Error("Nenhuma conexão cadastrada. Defina MCP_USER_ID ou crie uma conexão no workbench.");
  }
  sticky.ownerId = latest.ownerId;
  return sticky.ownerId;
}

async function listAllowedConnections(ownerId: string): Promise<ConnectionRef[]> {
  const connections = await prisma.connection.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, provider: true, database: true, host: true, port: true, tagsJson: true },
  });
  return connections
    .map((c) => {
      const tags = parseTagsJson(c.tagsJson);
      return { ...c, tags, environments: environmentsOf(tags) };
    })
    .filter((c) => {
      if (allowlist.size > 0 && !allowlist.has(c.id.toLowerCase()) && !allowlist.has(c.name.toLowerCase())) {
        return false;
      }
      return allowedByEnvironment(c.tags);
    });
}

async function resolveConnection(ref?: string, extra?: ToolExtra): Promise<ConnectionRef> {
  const ownerId = await resolveOwnerId(extra);
  const connections = await listAllowedConnections(ownerId);
  const sticky = getStickyState(extra?.sessionId);

  if (ref?.trim()) {
    const needle = ref.trim().toLowerCase();
    const match =
      connections.find((c) => c.id.toLowerCase() === needle || c.name.toLowerCase() === needle) ??
      connections.find((c) => c.name.toLowerCase().startsWith(needle));
    if (!match) {
      throw new Error(
        `Conexão "${ref}" não encontrada, fora da allowlist ou do ambiente permitido. Disponíveis: ${connections.map((c) => c.name).join(", ") || "(nenhuma)"}`
      );
    }
    return match;
  }

  if (sticky.activeConnectionId) {
    const active = connections.find((c) => c.id === sticky.activeConnectionId);
    if (active) return active;
  }

  if (connections.length === 1) return connections[0];
  throw new Error(
    `Nenhuma conexão ativa. Chame use_connection com uma de: ${connections.map((c) => c.name).join(", ") || "(nenhuma)"}`
  );
}

type SessionRef = { connectionId: string; sessionId: string; name: string };

async function resolveSession(ref?: string, connectionRef?: string, extra?: ToolExtra): Promise<SessionRef> {
  const ownerId = await resolveOwnerId(extra);
  const sticky = getStickyState(extra?.sessionId);

  if (ref?.trim()) {
    const needle = ref.trim().toLowerCase();
    const sessions = await prisma.aiModelingSession.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, connectionId: true },
    });
    const allowed = await listAllowedConnections(ownerId);
    const allowedIds = new Set(allowed.map((c) => c.id));
    const candidates = sessions.filter((s) => allowedIds.has(s.connectionId));
    const match =
      candidates.find((s) => s.id.toLowerCase() === needle || s.name.toLowerCase() === needle) ??
      candidates.find((s) => s.name.toLowerCase().startsWith(needle));
    if (!match) {
      throw new Error(
        `Sessão "${ref}" não encontrada. Disponíveis: ${candidates.map((s) => s.name).join(", ") || "(nenhuma)"}`
      );
    }
    return { connectionId: match.connectionId, sessionId: match.id, name: match.name };
  }

  if (sticky.activeSession) {
    const stillThere = await prisma.aiModelingSession.findFirst({
      where: { id: sticky.activeSession.sessionId, ownerId },
      select: { id: true, name: true, connectionId: true },
    });
    if (stillThere) return { connectionId: stillThere.connectionId, sessionId: stillThere.id, name: stillThere.name };
    sticky.activeSession = null;
  }

  if (connectionRef) {
    const connection = await resolveConnection(connectionRef, extra);
    throw new Error(
      `Nenhuma sessão ativa na conexão "${connection.name}". Use use_session ou modeling_list_sessions.`
    );
  }
  throw new Error("Nenhuma sessão ativa. Use use_session (nome ou id) ou modeling_create_session.");
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Erro: ${message}` }], isError: true as const };
}

function summarizeOps(operations: SchemaOp[]): string[] {
  return operations.map((op) => {
    switch (op.op) {
      case "createTable":
        return `Criar tabela "${op.table}" (${op.columns.length} coluna(s))`;
      case "addColumn":
        return `Adicionar coluna "${op.newColumn.name}" em "${op.table}"`;
      case "alterColumn":
        return `Alterar coluna "${op.column}" em "${op.table}"`;
      case "dropColumn":
        return `Remover coluna "${op.column}" de "${op.table}"`;
      case "renameColumn":
        return `Renomear coluna "${op.column}" → "${op.newName}" em "${op.table}"`;
      case "addForeignKey":
        return `FK "${op.table}.${op.column}" → "${op.referencesTable}.${op.referencesColumn}"`;
      case "dropForeignKey":
        return `Remover FK de "${op.table}.${op.column}"`;
      case "dropTable":
        return `Remover tabela "${op.table}"`;
      case "renameTable":
        return `Renomear tabela "${op.table}" → "${op.newName}"`;
    }
  });
}

const connectionParam = z
  .string()
  .optional()
  .describe("Nome ou id da conexão. Omitido = conexão ativa (use_connection) ou a única disponível.");
const sessionParam = z
  .string()
  .optional()
  .describe("Nome ou id da sessão de modelagem. Omitido = sessão ativa (use_session / última criada).");

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "diagram-viewer-ai-modeling", version: "1.0.0" },
    {
      instructions:
        "Modelagem de schema de banco compartilhada com o Diagram Viewer. " +
        "Fluxo: list_connections → use_connection → modeling_create_session (ou use_session). " +
        "Para alterar o modelo, PREFIRA modeling_apply_ops: VOCÊ (agente) faz a análise do pedido " +
        "do usuário e envia as operações estruturadas prontas (createTable, addColumn, alterColumn, dropColumn, " +
        "renameColumn, addForeignKey, dropForeignKey, dropTable, renameTable) — a sessão só persiste " +
        "o resultado, sem chamar outro modelo. Use modeling_send_message apenas quando o usuário " +
        "quiser explicitamente a LLM configurada na sessão. Cada mudança aparece em tempo real na " +
        "aba 'Modelagem IA' do workbench. Nada é aplicado ao banco real: o resultado vira SQL via " +
        "modeling_export_sql.",
    }
  );

  server.registerTool(
    "list_connections",
    {
      title: "Listar conexões",
      description:
        "Lista as conexões de banco disponíveis para modelagem (respeitando MCP_ALLOWED_CONNECTIONS), marcando a ativa.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      try {
        const ownerId = await resolveOwnerId(extra);
        const connections = await listAllowedConnections(ownerId);
        const sticky = getStickyState(extra.sessionId);
        return ok({
          activeConnectionId: sticky.activeConnectionId,
          allowedEnvironments: allowedEnvironments.size > 0 ? Array.from(allowedEnvironments) : "(todos)",
          connections: connections.map((c) => ({
            id: c.id,
            name: c.name,
            provider: c.provider,
            target: `${c.host}:${c.port}/${c.database}`,
            tags: c.tags,
            environments: c.environments,
            active: c.id === sticky.activeConnectionId,
          })),
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "use_connection",
    {
      title: "Selecionar conexão ativa",
      description:
        "Fixa a conexão de trabalho (nome ou id). As próximas chamadas que omitirem connectionId usam esta conexão.",
      inputSchema: { connection: z.string().describe("Nome ou id da conexão") },
    },
    async ({ connection }, extra) => {
      try {
        const resolved = await resolveConnection(connection, extra);
        const sticky = getStickyState(extra.sessionId);
        sticky.activeConnectionId = resolved.id;
        sticky.activeSession = null;
        return ok({
          activeConnection: {
            id: resolved.id,
            name: resolved.name,
            provider: resolved.provider,
            target: `${resolved.host}:${resolved.port}/${resolved.database}`,
            tags: resolved.tags,
            environments: resolved.environments,
          },
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_list_sessions",
    {
      title: "Listar sessões de modelagem",
      description: "Lista as sessões de modelagem IA da conexão (ativa ou informada).",
      inputSchema: { connectionId: connectionParam },
      annotations: { readOnlyHint: true },
    },
    async ({ connectionId }, extra) => {
      try {
        const connection = await resolveConnection(connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        const sessions = await listAiModelingSessions(connection.id, ownerId);
        return ok({
          connection: connection.name,
          activeSessionId: getStickyState(extra.sessionId).activeSession?.sessionId ?? null,
          sessions,
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_create_session",
    {
      title: "Criar sessão de modelagem",
      description:
        "Cria uma sessão de modelagem IA na conexão. O diagrama inicial é semeado com o schema atual da conexão (introspecção ao vivo ou último snapshot de migrations). A sessão criada vira a ativa.",
      inputSchema: {
        name: z.string().min(3).describe("Nome da sessão (ex: 'Loja online')"),
        connectionId: connectionParam,
        provider: z.string().optional().describe("Provedor LLM: gemini, openrouter ou nvidia"),
        model: z.string().optional().describe("Modelo LLM (ex: gemini-2.0-flash)"),
      },
    },
    async ({ name, connectionId, provider, model }, extra) => {
      try {
        const connection = await resolveConnection(connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        const session = await createAiModelingSession({
          connectionId: connection.id,
          ownerId,
          name,
          provider,
          model,
        });
        const sticky = getStickyState(extra.sessionId);
        sticky.activeConnectionId = connection.id;
        sticky.activeSession = { connectionId: connection.id, sessionId: session.id };
        await logConnectionAudit({
          action: "AI_MODELING_SESSION_CREATED_MCP",
          userId: ownerId,
          connectionId: connection.id,
          context: session.id,
        });
        return ok({ session, connection: connection.name, active: true });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "use_session",
    {
      title: "Selecionar sessão ativa",
      description: "Fixa a sessão de modelagem ativa (nome ou id), em qualquer conexão permitida.",
      inputSchema: { session: z.string().describe("Nome ou id da sessão") },
    },
    async ({ session }, extra) => {
      try {
        const resolved = await resolveSession(session, undefined, extra);
        const sticky = getStickyState(extra.sessionId);
        sticky.activeSession = { connectionId: resolved.connectionId, sessionId: resolved.sessionId };
        sticky.activeConnectionId = resolved.connectionId;
        return ok({ activeSession: resolved });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_get_session",
    {
      title: "Ver sessão de modelagem",
      description:
        "Retorna metadados da sessão, histórico de turnos (mensagens e operações propostas) e estatísticas do diagrama atual.",
      inputSchema: { sessionId: sessionParam, connectionId: connectionParam },
      annotations: { readOnlyHint: true },
    },
    async ({ sessionId, connectionId }, extra) => {
      try {
        const ref = await resolveSession(sessionId, connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        const detail = await getAiModelingSession(ref.sessionId, ref.connectionId, ownerId);
        if (!detail) throw new Error("Sessão não encontrada.");
        return ok({
          session: detail.session,
          stats: {
            tables: detail.diagram.nodes.length,
            relations: detail.diagram.edges.length,
            scopes: detail.diagram.scopes.map((s) => s.id),
          },
          turns: detail.turns.map((t) => ({
            order: t.order,
            role: t.role,
            message: t.message,
            operations: summarizeOps(t.operations),
            createdAt: t.createdAt,
          })),
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_get_diagram",
    {
      title: "Ver diagrama da sessão",
      description:
        "Retorna o diagrama completo (nodes com colunas/tipos/PK/FK, edges com constraints e scopes) da sessão de modelagem.",
      inputSchema: { sessionId: sessionParam, connectionId: connectionParam },
      annotations: { readOnlyHint: true },
    },
    async ({ sessionId, connectionId }, extra) => {
      try {
        const ref = await resolveSession(sessionId, connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        const detail = await getAiModelingSession(ref.sessionId, ref.connectionId, ownerId);
        if (!detail) throw new Error("Sessão não encontrada.");
        return ok(detail.diagram);
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_apply_ops",
    {
      title: "Aplicar operações de schema",
      description:
        "Aplica operações estruturadas diretamente no diagrama da sessão, SEM chamar a LLM da sessão — " +
        "você (agente) é quem analisa o pedido do usuário e produz as operações. " +
        "Vocabulário: createTable {table, scope?, columns[{name,type,isPrimary?,isNullable?}]} | " +
        "addColumn {table, newColumn} | alterColumn {table, column, type?, isNullable?, isPrimary?} | dropColumn {table, column} | renameColumn {table, column, newName} | " +
        "addForeignKey {table, column, referencesTable, referencesColumn, onDelete?, onUpdate?} | " +
        "dropForeignKey {table, column} | dropTable {table} | renameTable {table, newName}. " +
        "Retorna o que foi aplicado, avisos de operações rejeitadas e o diff de tabelas. " +
        "A aba 'Modelagem IA' aberta no workbench reflete a mudança automaticamente.",
      inputSchema: {
        operations: z
          .array(schemaOpSchema)
          .min(1)
          .describe("Operações estruturadas a aplicar, em ordem"),
        message: z
          .string()
          .max(4000)
          .optional()
          .describe("Resumo do que foi feito, exibido no chat da sessão (ex: 'Criei cupons ligado a pedidos em N:1')"),
        sessionId: sessionParam,
        connectionId: connectionParam,
      },
    },
    async ({ operations, message, sessionId, connectionId }, extra) => {
      try {
        const ref = await resolveSession(sessionId, connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        // Estado anterior só para computar o diff da resposta.
        const before = await getAiModelingSession(ref.sessionId, ref.connectionId, ownerId);
        if (!before) throw new Error("Sessão não encontrada.");

        const result = await postAiModelingOperations({
          sessionId: ref.sessionId,
          connectionId: ref.connectionId,
          ownerId,
          message: message ?? "",
          operations,
        });
        if (!result) throw new Error("Sessão não encontrada.");

        await logConnectionAudit({
          action: "AI_MODELING_OPS_MCP",
          userId: ownerId,
          connectionId: ref.connectionId,
          context: `${ref.sessionId}: +${operations.length - result.warnings.length} operação(ões)`,
        });

        const diff = computeDiagramDiff(before.diagram, result.diagram);
        const diffSummary = { added: [] as string[], altered: [] as string[], removed: [] as string[] };
        diff.forEach((status, table) => diffSummary[status].push(table));

        return ok({
          operationsApplied: summarizeOps(result.assistantTurn.operations),
          rejected: result.warnings.map((w) => ({ op: w.op.op, reason: w.reason })),
          notes: result.notes,
          tableDiff: diffSummary,
          stats: { tables: result.diagram.nodes.length, relations: result.diagram.edges.length },
          session: { id: ref.sessionId, name: ref.name },
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_send_message",
    {
      title: "Enviar instrução de modelagem",
      description:
        "Envia uma instrução em linguagem natural para a LLM CONFIGURADA NA SESSÃO (Gemini/OpenRouter/Nvidia), " +
        "que analisa e devolve operações aplicadas ao diagrama. ATENÇÃO: para análise feita por você (agente), " +
        "use modeling_apply_ops — esta tool gasta a cota da LLM da sessão.",
      inputSchema: {
        message: z.string().min(1).max(4000).describe("Instrução de modelagem em linguagem natural"),
        discussOnly: z
          .boolean()
          .optional()
          .describe("true = só conversar, sem alterar o diagrama (útil para tirar dúvidas antes de mudar)"),
        sessionId: sessionParam,
        connectionId: connectionParam,
      },
    },
    async ({ message, discussOnly, sessionId, connectionId }, extra) => {
      try {
        const ref = await resolveSession(sessionId, connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        const result = await postAiModelingTurn({
          sessionId: ref.sessionId,
          connectionId: ref.connectionId,
          ownerId,
          message,
          discussOnly,
        });
        if (!result) throw new Error("Sessão não encontrada.");

        await logConnectionAudit({
          action: "AI_MODELING_TURN_MCP",
          userId: ownerId,
          connectionId: ref.connectionId,
          context: `${ref.sessionId}: +${result.assistantTurn.operations.length} operação(ões)`,
        });

        const diff = computeDiagramDiff(result.userTurn.diagram, result.diagram);
        const diffSummary = { added: [] as string[], altered: [] as string[], removed: [] as string[] };
        diff.forEach((status, table) => diffSummary[status].push(table));

        return ok({
          reply: result.assistantTurn.message,
          operationsApplied: summarizeOps(result.assistantTurn.operations),
          tableDiff: diffSummary,
          stats: { tables: result.diagram.nodes.length, relations: result.diagram.edges.length },
          session: { id: ref.sessionId, name: ref.name },
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_revert",
    {
      title: "Voltar para checkpoint",
      description:
        "Restaura o diagrama da sessão para o estado logo após um turno (ver 'order' em modeling_get_session). Não apaga o histórico.",
      inputSchema: {
        turnOrder: z.number().int().min(1).describe("Ordem do turno de destino"),
        sessionId: sessionParam,
        connectionId: connectionParam,
      },
    },
    async ({ turnOrder, sessionId, connectionId }, extra) => {
      try {
        const ref = await resolveSession(sessionId, connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        const detail = await revertAiModelingSession({
          sessionId: ref.sessionId,
          connectionId: ref.connectionId,
          ownerId,
          turnOrder,
        });
        if (!detail) throw new Error("Sessão não encontrada.");
        return ok({
          checkpointOrder: detail.session.checkpointOrder,
          stats: { tables: detail.diagram.nodes.length, relations: detail.diagram.edges.length },
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_export_sql",
    {
      title: "Exportar SQL do modelo",
      description:
        "Gera o DDL (CREATE TABLEs + FKs) do estado atual da sessão, em MySQL ou PostgreSQL. Não executa nada no banco. " +
        "Com saveAsPackage=true, também materializa o SQL como package de migrations na conexão.",
      inputSchema: {
        dialect: z.string().describe("mysql ou postgres"),
        databaseName: z.string().optional().describe("Nome do banco/schema a criar antes das tabelas"),
        saveAsPackage: z.boolean().optional().describe("true = grava também como package de migrations na conexão"),
        packageName: z.string().optional().describe("Nome do package (mín. 3). Omitido = nome da sessão."),
        sessionId: sessionParam,
        connectionId: connectionParam,
      },
    },
    async ({ dialect, databaseName, saveAsPackage, packageName, sessionId, connectionId }, extra) => {
      try {
        if (!isDdlDialect(dialect)) throw new Error(`Dialeto inválido: "${dialect}". Use mysql ou postgres.`);
        const ref = await resolveSession(sessionId, connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        const exported = await exportAiModelingSql({
          sessionId: ref.sessionId,
          connectionId: ref.connectionId,
          ownerId,
          dialect,
          databaseName,
        });
        if (!exported) throw new Error("Sessão não encontrada.");

        let packageSaved: { id: string; name: string; fileCount: number } | undefined;
        if (saveAsPackage) {
          const pkg = await exportAiModelingToPackage({
            sessionId: ref.sessionId,
            connectionId: ref.connectionId,
            ownerId,
            dialect,
            databaseName,
            packageName,
          });
          if (!pkg) throw new Error("Sessão não encontrada.");
          packageSaved = { id: pkg.id, name: pkg.name, fileCount: pkg.fileCount };
          await logConnectionAudit({
            action: "AI_MODELING_EXPORTED_TO_PACKAGE_MCP",
            userId: ownerId,
            connectionId: ref.connectionId,
            context: `${pkg.name} (${dialect})`,
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: packageSaved
                ? `${exported.sql}\n\n-- Package salvo: ${packageSaved.name} (${packageSaved.id})`
                : exported.sql,
            },
          ],
        };
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_delete_session",
    {
      title: "Remover sessão de modelagem",
      description: "Remove uma sessão e todo o seu histórico de turnos. Irreversível.",
      inputSchema: { sessionId: sessionParam, connectionId: connectionParam },
      annotations: { destructiveHint: true },
    },
    async ({ sessionId, connectionId }, extra) => {
      try {
        const ref = await resolveSession(sessionId, connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        const removed = await deleteAiModelingSession(ref.sessionId, ref.connectionId, ownerId);
        if (!removed) throw new Error("Sessão não encontrada.");
        const sticky = getStickyState(extra.sessionId);
        if (sticky.activeSession?.sessionId === ref.sessionId) sticky.activeSession = null;
        return ok({ removed: ref.name });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_status",
    {
      title: "Status do servidor MCP",
      description: "Mostra provedores de LLM configurados, conexão/sessão ativas e allowlist.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      try {
        const ownerId = await resolveOwnerId(extra);
        const sticky = getStickyState(extra.sessionId);
        return ok({
          ownerId,
          llmProviders: availableLlmProviders(),
          defaultLlmProvider: currentLlmProvider(),
          memoryAvailable: isMemoryConfigured(),
          activeConnectionId: sticky.activeConnectionId,
          activeSession: sticky.activeSession,
          allowlist: allowlist.size > 0 ? Array.from(allowlist) : "(todas as conexões do usuário)",
          allowedEnvironments: allowedEnvironments.size > 0 ? Array.from(allowedEnvironments) : "(todos)",
          transport: extra.sessionId ? "http" : "stdio",
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "modeling_set_memory",
    {
      title: "Configurar memória da sessão",
      description:
        "Liga/desliga a memória do projeto (CodeGraph) nesta sessão e, opcionalmente, aponta para um project_id existente.",
      inputSchema: {
        memoryEnabled: z.boolean().optional().describe("true = buscar/gravar memória do projeto nesta sessão"),
        memoryProjectId: z
          .string()
          .nullable()
          .optional()
          .describe("project_id do CodeGraph. null = namespace derivado da conexão (workbench:<id>)"),
        sessionId: sessionParam,
        connectionId: connectionParam,
      },
    },
    async ({ memoryEnabled, memoryProjectId, sessionId, connectionId }, extra) => {
      try {
        const ref = await resolveSession(sessionId, connectionId, extra);
        const ownerId = await resolveOwnerId(extra);
        const updated = await updateAiModelingMemory({
          sessionId: ref.sessionId,
          connectionId: ref.connectionId,
          ownerId,
          memoryEnabled,
          memoryProjectId,
        });
        if (!updated) throw new Error("Sessão não encontrada.");
        return ok({
          session: updated,
          memoryAvailable: isMemoryConfigured(),
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  return server;
}

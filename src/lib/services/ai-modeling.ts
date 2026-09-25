import { findDriver, toDriverConfig } from "@/lib/db/drivers";
import { HttpError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { currentLlmProvider, streamSchemaOps, isLlmProvider, type LlmStreamCallback } from "@/lib/services/llm";
import { isMemoryConfigured, recallForTurn, saveTurnMemory } from "@/lib/services/memory";
import { generateDdl, isDdlDialect, type DdlDialect } from "@/lib/services/ddl-generator";
import { createMigrationPackage, getFinalDiagram } from "@/lib/services/migrations";
import { applySchemaOps, type ApplyOpsWarning, type SchemaOp } from "@/lib/services/schema-ops";
import type { DiagramResponse } from "@/lib/types/diagram";
import type { MigrationPackageDTO } from "@/lib/types/migrations";

const EMPTY_DIAGRAM: DiagramResponse = { nodes: [], edges: [], scopes: [] };

export type AiModelingSessionDTO = {
  id: string;
  name: string;
  provider: string;
  model: string;
  /** Turno para o qual a sessão foi revertida; null quando está na ponta do histórico. */
  checkpointOrder: number | null;
  memoryEnabled: boolean;
  memoryProjectId: string | null;
  /** Se o servidor tem memória configurada — sem isso o toggle da sessão não tem efeito. */
  memoryAvailable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AiModelingTurnDTO = {
  id: string;
  order: number;
  role: "user" | "assistant";
  message: string;
  operations: SchemaOp[];
  diagram: DiagramResponse;
  createdAt: string;
};

export async function listAiModelingSessions(connectionId: string, ownerId: string): Promise<AiModelingSessionDTO[]> {
  const sessions = await prisma.aiModelingSession.findMany({
    where: { connectionId, ownerId },
    orderBy: { updatedAt: "desc" },
  });
  return sessions.map(toSessionDTO);
}

export async function createAiModelingSession({
  connectionId,
  ownerId,
  name,
  model,
  provider,
}: {
  connectionId: string;
  ownerId: string;
  name: string;
  model?: string;
  provider?: string;
}): Promise<AiModelingSessionDTO> {
  const resolvedProvider = provider && isLlmProvider(provider) ? provider : currentLlmProvider();
  const seedDiagram = await getExistingConnectionDiagram(connectionId, ownerId);
  const session = await prisma.aiModelingSession.create({
    data: {
      connectionId,
      ownerId,
      name,
      provider: resolvedProvider,
      ...(model ? { model } : {}),
      diagramJson: JSON.stringify(seedDiagram ?? EMPTY_DIAGRAM),
    },
  });
  return toSessionDTO(session);
}

/**
 * Busca o schema que já existe na conexão (último snapshot de um package de migrations, ou
 * introspecção ao vivo de um banco real) pra usar como ponto de partida de uma nova sessão —
 * em vez de sempre começar do zero, mesmo quando a conexão já tem tabelas de outra origem.
 * Best-effort: qualquer falha aqui não deve impedir a criação da sessão, só cai pro vazio.
 */
async function getExistingConnectionDiagram(connectionId: string, ownerId: string): Promise<DiagramResponse | null> {
  try {
    const connection = await prisma.connection.findFirst({
      where: { id: connectionId, ownerId },
      include: { secret: true },
    });
    if (!connection) return null;

    if (connection.provider === "MIGRATIONS") {
      const latestPackage = await prisma.migrationPackage.findFirst({
        where: { connectionId, ownerId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!latestPackage) return null;
      return await getFinalDiagram(latestPackage.id, connectionId, ownerId);
    }

    const driver = findDriver(connection.provider);
    if (driver && connection.secret) {
      return await driver.buildDiagram(toDriverConfig(connection));
    }

    return null;
  } catch (err) {
    logger.error({ err }, "falha ao buscar schema existente da conexão para seed da modelagem IA");
    return null;
  }
}

export async function getAiModelingSession(
  sessionId: string,
  connectionId: string,
  ownerId: string
): Promise<{ session: AiModelingSessionDTO; diagram: DiagramResponse; turns: AiModelingTurnDTO[] } | null> {
  const session = await prisma.aiModelingSession.findFirst({
    where: { id: sessionId, connectionId, ownerId },
    include: { turns: { orderBy: { order: "asc" } } },
  });
  if (!session) return null;

  return {
    session: toSessionDTO(session),
    diagram: safeParseDiagram(session.diagramJson),
    turns: session.turns.map(toTurnDTO),
  };
}

/**
 * Restaura o diagrama da sessão para o estado gravado em um turno — o "desfazer" da modelagem.
 * Não apaga nada: os turnos à frente continuam no histórico, então dá pra ir e voltar livremente
 * entre checkpoints. Eles só são descartados quando uma nova mensagem é enviada a partir daqui
 * (ver postAiModelingTurn).
 */
export async function revertAiModelingSession({
  sessionId,
  connectionId,
  ownerId,
  turnOrder,
}: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  turnOrder: number;
}): Promise<{ session: AiModelingSessionDTO; diagram: DiagramResponse; turns: AiModelingTurnDTO[] } | null> {
  const session = await prisma.aiModelingSession.findFirst({
    where: { id: sessionId, connectionId, ownerId },
    include: { turns: { orderBy: { order: "asc" } } },
  });
  if (!session) return null;

  const target = session.turns.find((t) => t.order === turnOrder);
  if (!target) {
    throw new HttpError(404, "Checkpoint não encontrado nesta sessão.");
  }

  const lastOrder = session.turns.at(-1)?.order ?? null;
  await prisma.aiModelingSession.update({
    where: { id: session.id },
    data: {
      diagramJson: target.diagramJson,
      // Voltar para o último turno é o mesmo que estar na ponta — sem checkpoint pendente.
      checkpointOrder: turnOrder === lastOrder ? null : turnOrder,
    },
  });

  return getAiModelingSession(sessionId, connectionId, ownerId);
}

/** Atualiza atributos da sessão (modelo, provedor, nome, preferências de memória). */
export async function updateAiModelingSession({
  sessionId,
  connectionId,
  ownerId,
  name,
  model,
  provider,
  memoryEnabled,
  memoryProjectId,
}: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  name?: string;
  model?: string;
  provider?: string;
  memoryEnabled?: boolean;
  memoryProjectId?: string | null;
}): Promise<AiModelingSessionDTO | null> {
  const session = await prisma.aiModelingSession.findFirst({
    where: { id: sessionId, connectionId, ownerId },
    select: { id: true },
  });
  if (!session) return null;

  const updated = await prisma.aiModelingSession.update({
    where: { id: session.id },
    data: {
      ...(name !== undefined && name.trim() ? { name: name.trim() } : {}),
      ...(model !== undefined && model.trim() ? { model: model.trim() } : {}),
      ...(provider !== undefined && isLlmProvider(provider) ? { provider } : {}),
      ...(memoryEnabled === undefined ? {} : { memoryEnabled }),
      ...(memoryProjectId === undefined ? {} : { memoryProjectId: memoryProjectId?.trim() || null }),
    },
  });

  return toSessionDTO(updated);
}

/** Atualiza as preferências de memória da sessão (retrocompatibilidade). */
export async function updateAiModelingMemory(params: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  memoryEnabled?: boolean;
  memoryProjectId?: string | null;
}): Promise<AiModelingSessionDTO | null> {
  return updateAiModelingSession(params);
}

export async function deleteAiModelingSession(
  sessionId: string,
  connectionId: string,
  ownerId: string
): Promise<boolean> {
  const session = await prisma.aiModelingSession.findFirst({
    where: { id: sessionId, connectionId, ownerId },
    select: { id: true },
  });
  if (!session) return false;
  await prisma.$transaction([
    prisma.aiModelingTurn.deleteMany({ where: { sessionId: session.id } }),
    prisma.aiModelingSession.delete({ where: { id: session.id } }),
  ]);
  return true;
}

export async function postAiModelingTurn(params: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  message: string;
  discussOnly?: boolean;
}): Promise<{ userTurn: AiModelingTurnDTO; assistantTurn: AiModelingTurnDTO; diagram: DiagramResponse } | null> {
  return postAiModelingTurnStream(params);
}

export async function postAiModelingTurnStream({
  sessionId,
  connectionId,
  ownerId,
  message,
  discussOnly,
  onReplyDelta,
}: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  message: string;
  discussOnly?: boolean;
  onReplyDelta?: LlmStreamCallback;
}): Promise<{
  userTurn: AiModelingTurnDTO;
  assistantTurn: AiModelingTurnDTO;
  diagram: DiagramResponse;
  warnings?: ApplyOpsWarning[];
  notes?: string[];
} | null> {
  const session = await prisma.aiModelingSession.findFirst({
    where: { id: sessionId, connectionId, ownerId },
    include: { turns: { orderBy: { order: "asc" } } },
  });
  if (!session) return null;

  // Continuar a partir de um checkpoint torna o desfazer definitivo: os turnos à frente saem do
  // histórico (e são apagados abaixo, na mesma transação da gravação dos novos turnos).
  const activeTurns =
    session.checkpointOrder === null
      ? session.turns
      : session.turns.filter((t) => t.order <= session.checkpointOrder!);

  const currentDiagram = safeParseDiagram(session.diagramJson);
  const history = activeTurns.map((t) => ({ role: t.role as "user" | "assistant", message: t.message }));

  // Memória do projeto: buscada antes da chamada e injetada no prompt como contexto. Falha aqui
  // não interrompe o turno — o chat só perde o histórico de decisões de sessões anteriores.
  const memories = session.memoryEnabled
    ? await recallForTurn({
        connectionId,
        ownerId,
        memoryProjectId: session.memoryProjectId,
        userMessage: message,
      })
    : [];

  const provider = isLlmProvider(session.provider) ? session.provider : currentLlmProvider();
  const llmResponse = await streamSchemaOps(
    provider,
    {
      currentDiagram,
      history,
      userMessage: message,
      model: session.model,
      discussOnly,
      memories,
    },
    onReplyDelta
  );

  // Garantia de verdade do modo "só discutir": mesmo que a LLM ignore a instrução e devolva
  // operações, elas são descartadas aqui — não depende do modelo obedecer o prompt.
  if (discussOnly && llmResponse.operations.length > 0) {
    llmResponse.operations = [];
  }

  const { next, warnings, notes } = applySchemaOps(currentDiagram, llmResponse.operations);
  const nextOrder = (activeTurns.at(-1)?.order ?? 0) + 1;

  const assistantMessage = [
    llmResponse.reply,
    // Nota fixa, independente do que a LLM disser no texto: alguns modelos mais fracos
    // "alucinam" e afirmam ter feito uma mudança mesmo com operations vazio.
    discussOnly ? "\nℹ️ Modo só discutir: nenhuma alteração foi aplicada ao diagrama." : null,
    notes.length > 0 ? `\nℹ️ ${notes.join("; ")}.` : null,
    warnings.length > 0
      ? `\n⚠️ ${warnings.length} operação(ões) não puderam ser aplicadas: ${warnings.map((w) => w.reason).join("; ")}.`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");

  const [userTurn, assistantTurn] = await prisma.$transaction(async (tx) => {
    if (session.checkpointOrder !== null) {
      await tx.aiModelingTurn.deleteMany({
        where: { sessionId, order: { gt: session.checkpointOrder } },
      });
    }

    const userRow = await tx.aiModelingTurn.create({
      data: {
        sessionId,
        order: nextOrder,
        role: "user",
        message,
        diagramJson: session.diagramJson,
      },
    });
    const assistantRow = await tx.aiModelingTurn.create({
      data: {
        sessionId,
        order: nextOrder + 1,
        role: "assistant",
        message: assistantMessage,
        operationsJson: JSON.stringify(llmResponse.operations),
        diagramJson: JSON.stringify(next),
      },
    });
    await tx.aiModelingSession.update({
      where: { id: sessionId },
      data: { diagramJson: JSON.stringify(next), checkpointOrder: null },
    });
    return [userRow, assistantRow];
  });

  // Grava a decisão deste turno na memória do projeto. Só o que foi de fato aplicado: operação
  // rejeitada por applySchemaOps não mudou o modelo e viraria memória de algo que não existe.
  if (session.memoryEnabled) {
    const rejected = new Set(warnings.map((w) => w.op));
    await saveTurnMemory({
      connectionId,
      ownerId,
      memoryProjectId: session.memoryProjectId,
      sessionId,
      sessionName: session.name,
      operations: llmResponse.operations.filter((op) => !rejected.has(op)),
    });
  }

  return {
    userTurn: toTurnDTO(userTurn),
    assistantTurn: toTurnDTO(assistantTurn),
    diagram: next,
    warnings,
    notes,
  };
}

/**
 * Aplica operações estruturadas vindas de um agente externo (ex: Claude Code via MCP), SEM
 * chamar a LLM da sessão: quem analisa é o agente, a sessão só persiste o resultado como um
 * turno de assistente — o histórico, o checkpoint/revert e a UI em tempo real funcionam igual
 * ao caminho conversado (postAiModelingTurn).
 */
export async function postAiModelingOperations({
  sessionId,
  connectionId,
  ownerId,
  message,
  operations,
}: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  /** Resumo do que foi feito, exibido no chat como resposta da "IA". */
  message: string;
  operations: SchemaOp[];
}): Promise<{
  assistantTurn: AiModelingTurnDTO;
  diagram: DiagramResponse;
  warnings: ApplyOpsWarning[];
  notes: string[];
} | null> {
  const session = await prisma.aiModelingSession.findFirst({
    where: { id: sessionId, connectionId, ownerId },
    include: { turns: { orderBy: { order: "asc" } } },
  });
  if (!session) return null;

  // Mesma regra do caminho conversado: continuar de um checkpoint descarta os turnos à frente.
  const activeTurns =
    session.checkpointOrder === null
      ? session.turns
      : session.turns.filter((t) => t.order <= session.checkpointOrder!);

  const currentDiagram = safeParseDiagram(session.diagramJson);
  const { next, warnings, notes } = applySchemaOps(currentDiagram, operations);
  const nextOrder = (activeTurns.at(-1)?.order ?? 0) + 1;

  const assistantMessage = [
    message.trim() || "Operações aplicadas por agente externo (MCP).",
    notes.length > 0 ? `\nℹ️ ${notes.join("; ")}.` : null,
    warnings.length > 0
      ? `\n⚠️ ${warnings.length} operação(ões) não puderam ser aplicadas: ${warnings.map((w) => w.reason).join("; ")}.`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");

  const assistantRow = await prisma.$transaction(async (tx) => {
    if (session.checkpointOrder !== null) {
      await tx.aiModelingTurn.deleteMany({
        where: { sessionId, order: { gt: session.checkpointOrder } },
      });
    }
    const row = await tx.aiModelingTurn.create({
      data: {
        sessionId,
        order: nextOrder,
        role: "assistant",
        message: assistantMessage,
        operationsJson: JSON.stringify(operations),
        diagramJson: JSON.stringify(next),
      },
    });
    await tx.aiModelingSession.update({
      where: { id: sessionId },
      data: { diagramJson: JSON.stringify(next), checkpointOrder: null },
    });
    return row;
  });

  // Igual ao caminho conversado: só vira memória o que foi de fato aplicado.
  if (session.memoryEnabled) {
    const rejected = new Set(warnings.map((w) => w.op));
    await saveTurnMemory({
      connectionId,
      ownerId,
      memoryProjectId: session.memoryProjectId,
      sessionId,
      sessionName: session.name,
      operations: operations.filter((op) => !rejected.has(op)),
    });
  }

  return { assistantTurn: toTurnDTO(assistantRow), diagram: next, warnings, notes };
}

/** Nome de arquivo seguro a partir do nome da modelagem. */
export function slugifyModelingName(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "modelagem"
  );
}

export async function exportAiModelingSql({
  sessionId,
  connectionId,
  ownerId,
  dialect,
  databaseName,
}: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  dialect: string;
  databaseName?: string;
}): Promise<{ sql: string; filename: string; sessionName: string } | null> {
  if (!isDdlDialect(dialect)) {
    throw new HttpError(400, `Dialeto inválido: "${dialect}". Use mysql ou postgres.`);
  }
  const detail = await getAiModelingSession(sessionId, connectionId, ownerId);
  if (!detail) return null;
  return {
    sql: generateDdl(detail.diagram, { dialect, databaseName, title: detail.session.name }),
    filename: `${slugifyModelingName(detail.session.name)}_${dialect}.sql`,
    sessionName: detail.session.name,
  };
}

export async function exportAiModelingToPackage({
  sessionId,
  connectionId,
  ownerId,
  dialect,
  databaseName,
  packageName,
}: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  dialect: DdlDialect;
  databaseName?: string;
  packageName?: string;
}): Promise<MigrationPackageDTO | null> {
  const detail = await getAiModelingSession(sessionId, connectionId, ownerId);
  if (!detail) return null;
  if (detail.diagram.nodes.length === 0) {
    throw new HttpError(400, "A modelagem está vazia — nada para salvar.");
  }

  const sql = generateDdl(detail.diagram, { dialect, databaseName, title: detail.session.name });
  const name = packageName?.trim() && packageName.trim().length >= 3 ? packageName.trim() : detail.session.name;
  return createMigrationPackage({
    connectionId,
    ownerId,
    name,
    files: [{ name: `V1__${slugifyModelingName(detail.session.name)}.sql`, content: sql }],
  });
}

function toSessionDTO(session: {
  id: string;
  name: string;
  provider: string;
  model: string;
  checkpointOrder: number | null;
  memoryEnabled: boolean;
  memoryProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AiModelingSessionDTO {
  return {
    id: session.id,
    name: session.name,
    provider: session.provider,
    model: session.model,
    checkpointOrder: session.checkpointOrder,
    memoryEnabled: session.memoryEnabled,
    memoryProjectId: session.memoryProjectId,
    memoryAvailable: isMemoryConfigured(),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function toTurnDTO(turn: {
  id: string;
  order: number;
  role: string;
  message: string;
  operationsJson: string | null;
  diagramJson: string;
  createdAt: Date;
}): AiModelingTurnDTO {
  return {
    id: turn.id,
    order: turn.order,
    role: turn.role === "assistant" ? "assistant" : "user",
    message: turn.message,
    operations: turn.operationsJson ? safeParseOperations(turn.operationsJson) : [],
    diagram: safeParseDiagram(turn.diagramJson),
    createdAt: turn.createdAt.toISOString(),
  };
}

function safeParseDiagram(value: string): DiagramResponse {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return parsed as DiagramResponse;
    }
  } catch {
    // ignore
  }
  return EMPTY_DIAGRAM;
}

function safeParseOperations(value: string): SchemaOp[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as SchemaOp[]) : [];
  } catch {
    return [];
  }
}

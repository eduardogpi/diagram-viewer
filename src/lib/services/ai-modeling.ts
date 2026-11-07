import { findDriver, toDriverConfig } from "@/lib/db/drivers";
import { HttpError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { currentLlmProvider, generateText, streamSchemaOps, isLlmProvider, type LlmStreamCallback } from "@/lib/services/llm";
import { isMemoryConfigured, recallForTurn, saveTurnMemory } from "@/lib/services/memory";
import {
  generateDdl,
  generateDeltaDdl,
  inferMigrationSlug,
  isDdlDialect,
  type DdlDialect,
} from "@/lib/services/ddl-generator";
import { appendMigrationsToPackage, createMigrationPackage, getFinalDiagram } from "@/lib/services/migrations";
import { applySchemaOps, type ApplyOpsWarning, type SchemaOp } from "@/lib/services/schema-ops";
import {
  buildDocumentationPrompt,
  DOCUMENTER_SYSTEM_INSTRUCTION,
  parseDocumentationReply,
  planDocumentationBatches,
} from "@/lib/services/schema-documenter";
import type { DiagramResponse } from "@/lib/types/diagram";
import type { MigrationPackageDTO } from "@/lib/types/migrations";

const EMPTY_DIAGRAM: DiagramResponse = { nodes: [], edges: [], scopes: [] };

/**
 * Lock em memória por sessão para impedir que dois turnos/operações simultâneos na mesma
 * sessão disparem chamadas duplicadas à LLM ou colidam no order dos turnos.
 */
const activeSessionLocks = new Set<string>();

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  if (activeSessionLocks.has(sessionId)) {
    throw new HttpError(409, "Já existe uma operação em andamento nesta sessão. Aguarde a conclusão.");
  }
  activeSessionLocks.add(sessionId);
  try {
    return await fn();
  } finally {
    activeSessionLocks.delete(sessionId);
  }
}

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

export async function listAiModelingSessions(connectionId: string, ownerId: string, limit = 50, offset = 0): Promise<AiModelingSessionDTO[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const sessions = await prisma.aiModelingSession.findMany({
    where: { connectionId, ownerId },
    orderBy: { updatedAt: "desc" },
    take: safeLimit,
    skip: Math.max(offset, 0),
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
  return withSessionLock(sessionId, async () => {
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
  });
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
  return withSessionLock(sessionId, async () => {
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
      const freshSession = await tx.aiModelingSession.findFirst({
        where: { id: sessionId, connectionId, ownerId },
        select: { checkpointOrder: true, diagramJson: true },
      });
      if (!freshSession) {
        throw new HttpError(404, "Sessão não encontrada.");
      }
      if (
        freshSession.checkpointOrder !== session.checkpointOrder ||
        freshSession.diagramJson !== session.diagramJson
      ) {
        throw new HttpError(409, "A sessão foi modificada concorrentemente durante a geração. Tente novamente.");
      }

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
  });
}

/**
 * Aplica operações estruturadas vindas de um agente externo (ex: Claude Code via MCP), SEM
 * chamar a LLM da sessão: quem analisa é o agente, a sessão só persiste o resultado como um
 * turno de assistente — o histórico, o checkpoint/revert e a UI em tempo real funcionam igual
 * ao caminho conversado (postAiModelingTurn).
 */
type ApplyOperationsParams = {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  /** Resumo do que foi feito, exibido no chat como resposta da "IA". */
  message: string;
  operations: SchemaOp[];
};

type ApplyOperationsResult = {
  assistantTurn: AiModelingTurnDTO;
  diagram: DiagramResponse;
  warnings: ApplyOpsWarning[];
  notes: string[];
};

export async function postAiModelingOperations(params: ApplyOperationsParams): Promise<ApplyOperationsResult | null> {
  return withSessionLock(params.sessionId, () => applyOperationsLocked(params));
}

/** Corpo de `postAiModelingOperations`; quem chama já precisa estar dentro do lock da sessão. */
async function applyOperationsLocked({
  sessionId,
  connectionId,
  ownerId,
  message,
  operations,
}: ApplyOperationsParams): Promise<ApplyOperationsResult | null> {
  {
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
}

export type DocumentSessionResult = {
  /** null quando não havia nada a documentar (nenhum turno é criado). */
  assistantTurn: AiModelingTurnDTO | null;
  diagram: DiagramResponse;
  /** Comentários gerados e aplicados. */
  commented: { tables: number; columns: number };
  /** Tabelas com lacuna que ficaram para uma próxima execução (teto por rodada). */
  remainingTables: number;
  /** Lotes em que a LLM falhou ou devolveu algo inaproveitável. */
  failedBatches: number;
  truncated: boolean;
};

/**
 * Documenta em lote tabelas/colunas sem comentário usando a LLM configurada na sessão. Gera só
 * `setComment` para o que ainda não tem comentário e grava tudo como UM turno — revisável no
 * diagrama e desfazível pela linha do tempo como qualquer outro.
 */
export async function documentAiModelingSession({
  sessionId,
  connectionId,
  ownerId,
  tables,
}: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  /** Restringe a estas tabelas (id ou nome). Omitido = todas com lacuna. */
  tables?: string[];
}): Promise<DocumentSessionResult | null> {
  return withSessionLock(sessionId, async () => {
    const session = await prisma.aiModelingSession.findFirst({
      where: { id: sessionId, connectionId, ownerId },
      select: { provider: true, model: true, diagramJson: true },
    });
    if (!session) return null;

    const diagram = safeParseDiagram(session.diagramJson);
    const plan = planDocumentationBatches(diagram, { tables });
    if (plan.batches.length === 0) {
      return {
        assistantTurn: null,
        diagram,
        commented: { tables: 0, columns: 0 },
        remainingTables: 0,
        failedBatches: 0,
        truncated: false,
      };
    }

    const provider = isLlmProvider(session.provider) ? session.provider : currentLlmProvider();
    const operations: SchemaOp[] = [];
    let failedBatches = 0;
    let truncated = false;

    // Sequencial de propósito: lotes em paralelo estouram o rate limit dos provedores gratuitos.
    for (const batch of plan.batches) {
      try {
        const result = await generateText(provider, {
          model: session.model,
          systemInstruction: DOCUMENTER_SYSTEM_INSTRUCTION,
          prompt: buildDocumentationPrompt(diagram, batch),
        });
        truncated ||= result.truncated;
        const ops = parseDocumentationReply(result.text, batch);
        if (ops.length === 0) failedBatches += 1;
        operations.push(...ops);
      } catch (err) {
        failedBatches += 1;
        logger.warn({ err, sessionId }, "documentação em lote: falha em um lote (seguindo com os demais)");
      }
    }

    if (operations.length === 0) {
      throw new HttpError(502, "A IA não devolveu comentários aproveitáveis. Tente novamente ou troque o modelo da sessão.");
    }

    const commented = {
      tables: operations.filter((op) => op.op === "setComment" && !op.column).length,
      columns: operations.filter((op) => op.op === "setComment" && op.column).length,
    };
    const message = [
      `📝 Documentação automática: ${commented.tables} tabela(s) e ${commented.columns} coluna(s) comentadas.`,
      plan.remaining > 0
        ? `Ainda há ${plan.remaining} tabela(s) sem documentação completa — rode de novo para continuar.`
        : null,
      failedBatches > 0 ? `⚠️ ${failedBatches} lote(s) falharam e foram pulados.` : null,
      "Revise os textos no diagrama; se não gostar, desfaça este passo na linha do tempo.",
    ]
      .filter(Boolean)
      .join("\n");

    const applied = await applyOperationsLocked({ sessionId, connectionId, ownerId, message, operations });
    if (!applied) return null;

    return {
      assistantTurn: applied.assistantTurn,
      diagram: applied.diagram,
      commented,
      remainingTables: plan.remaining,
      failedBatches,
      truncated,
    };
  });
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

export type AiModelingExportMode = "full" | "delta" | "last_turn";

export function isAiModelingExportMode(value: unknown): value is AiModelingExportMode {
  return value === "full" || value === "delta" || value === "last_turn";
}

async function resolveIncrementalContext(
  detail: NonNullable<Awaited<ReturnType<typeof getAiModelingSession>>>,
  connectionId: string,
  ownerId: string,
  mode: "delta" | "last_turn"
): Promise<{ baseDiagram: DiagramResponse; operations: SchemaOp[] }> {
  const activeTurns =
    detail.session.checkpointOrder === null
      ? detail.turns
      : detail.turns.filter((t) => t.order <= detail.session.checkpointOrder!);

  if (activeTurns.length === 0) {
    return { baseDiagram: detail.diagram, operations: [] };
  }

  if (mode === "last_turn") {
    let lastAssistantIdx = -1;
    for (let i = activeTurns.length - 1; i >= 0; i -= 1) {
      if (activeTurns[i].role === "assistant" && activeTurns[i].operations.length > 0) {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx === -1) {
      return { baseDiagram: detail.diagram, operations: [] };
    }
    const baseDiagram =
      lastAssistantIdx > 0
        ? activeTurns[lastAssistantIdx - 1].diagram
        : (await getExistingConnectionDiagram(connectionId, ownerId)) ?? EMPTY_DIAGRAM;
    return { baseDiagram, operations: activeTurns[lastAssistantIdx].operations };
  }

  // mode === "delta": todas as operações da sessão até o checkpoint ativo.
  const baseDiagram =
    activeTurns[0].role === "user"
      ? activeTurns[0].diagram
      : (await getExistingConnectionDiagram(connectionId, ownerId)) ?? EMPTY_DIAGRAM;
  const operations = activeTurns.flatMap((t) => (t.role === "assistant" ? t.operations : []));
  return { baseDiagram, operations };
}

function nextFlywayFileName(existingNames: string[], slug: string): string {
  let maxVersion = 0;
  const dirs = new Set<string>();

  for (const rawName of existingNames) {
    const normalized = rawName.replace(/\\/g, "/");
    const slashIdx = normalized.lastIndexOf("/");
    const dir = slashIdx >= 0 ? normalized.slice(0, slashIdx) : "";
    const base = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
    dirs.add(dir);

    const match = /^V(\d+)(?:[._]\d+)*__/i.exec(base);
    if (match) {
      const major = Number.parseInt(match[1], 10);
      if (Number.isFinite(major) && major > maxVersion) {
        maxVersion = major;
      }
    }
  }

  let nextVer = Math.max(maxVersion + 1, existingNames.length + 1);
  const commonDir = dirs.size === 1 ? Array.from(dirs)[0] : "";
  const existingSet = new Set(existingNames.map((n) => n.replace(/\\/g, "/").toLowerCase()));

  while (true) {
    const candidateBase = `V${nextVer}__${slug}.sql`;
    const candidate = commonDir ? `${commonDir}/${candidateBase}` : candidateBase;
    if (!existingSet.has(candidate.toLowerCase())) {
      return candidate;
    }
    nextVer += 1;
  }
}

export async function exportAiModelingSql({
  sessionId,
  connectionId,
  ownerId,
  dialect,
  databaseName,
  mode = "full",
  description,
}: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  dialect: string;
  databaseName?: string;
  mode?: AiModelingExportMode;
  description?: string;
}): Promise<{
  sql: string;
  filename: string;
  sessionName: string;
  mode: AiModelingExportMode;
  operationCount: number;
} | null> {
  if (!isDdlDialect(dialect)) {
    throw new HttpError(400, `Dialeto inválido: "${dialect}". Use mysql ou postgres.`);
  }
  const detail = await getAiModelingSession(sessionId, connectionId, ownerId);
  if (!detail) return null;

  if (mode === "delta" || mode === "last_turn") {
    const { baseDiagram, operations } = await resolveIncrementalContext(detail, connectionId, ownerId, mode);
    const slug = description?.trim()
      ? slugifyModelingName(description.trim())
      : inferMigrationSlug(operations, detail.session.name);
    const sql = generateDeltaDdl(operations, {
      dialect,
      databaseName,
      title: detail.session.name,
      baseDiagram,
    });
    return {
      sql,
      filename: `V_next__${slug}_${dialect}.sql`,
      sessionName: detail.session.name,
      mode,
      operationCount: operations.length,
    };
  }

  return {
    sql: generateDdl(detail.diagram, { dialect, databaseName, title: detail.session.name }),
    filename: `${slugifyModelingName(detail.session.name)}_${dialect}.sql`,
    sessionName: detail.session.name,
    mode: "full",
    operationCount: 0,
  };
}

export async function exportAiModelingToPackage({
  sessionId,
  connectionId,
  ownerId,
  dialect,
  databaseName,
  packageName,
  mode = "full",
  targetPackageId,
  description,
}: {
  sessionId: string;
  connectionId: string;
  ownerId: string;
  dialect: DdlDialect;
  databaseName?: string;
  packageName?: string;
  mode?: AiModelingExportMode;
  /** Quando informado, anexa a migration incremental (`V{N+1}__...sql`) ao package existente. */
  targetPackageId?: string;
  /** Descrição opcional para compor o nome do arquivo `V{N}__<description>.sql`. */
  description?: string;
}): Promise<(MigrationPackageDTO & { appendedFile?: string; mode?: AiModelingExportMode }) | null> {
  const detail = await getAiModelingSession(sessionId, connectionId, ownerId);
  if (!detail) return null;

  if (targetPackageId) {
    const effectiveMode = mode === "last_turn" ? "last_turn" : "delta";
    const { baseDiagram, operations } = await resolveIncrementalContext(
      detail,
      connectionId,
      ownerId,
      effectiveMode
    );
    if (operations.length === 0) {
      throw new HttpError(400, "Nenhuma operação incremental encontrada nesta sessão para anexar.");
    }

    const sql = generateDeltaDdl(operations, {
      dialect,
      databaseName,
      title: detail.session.name,
      baseDiagram,
    });
    if (sql.startsWith("-- Nenhuma alteração incremental")) {
      throw new HttpError(400, "As operações da sessão não produziram alterações de schema para anexar.");
    }

    const existingPkg = await prisma.migrationPackage.findFirst({
      where: { id: targetPackageId, connectionId, ownerId },
      include: { files: { orderBy: { order: "asc" }, select: { name: true } } },
    });
    if (!existingPkg) {
      throw new HttpError(404, "Package de migrations de destino não encontrado.");
    }

    const slug = description?.trim()
      ? slugifyModelingName(description.trim())
      : inferMigrationSlug(operations, detail.session.name);
    const fileName = nextFlywayFileName(
      existingPkg.files.map((f) => f.name),
      slug
    );

    const appended = await appendMigrationsToPackage({
      packageId: targetPackageId,
      connectionId,
      ownerId,
      files: [{ name: fileName, path: fileName, content: sql }],
    });
    if (!appended) {
      throw new HttpError(404, "Package de migrations de destino não encontrado.");
    }

    return { ...appended.package, appendedFile: fileName, mode: effectiveMode };
  }

  if (mode === "delta" || mode === "last_turn") {
    const { baseDiagram, operations } = await resolveIncrementalContext(detail, connectionId, ownerId, mode);
    if (operations.length === 0) {
      throw new HttpError(400, "Nenhuma operação incremental encontrada para salvar.");
    }
    const sql = generateDeltaDdl(operations, {
      dialect,
      databaseName,
      title: detail.session.name,
      baseDiagram,
    });
    const slug = description?.trim()
      ? slugifyModelingName(description.trim())
      : inferMigrationSlug(operations, detail.session.name);
    const name = packageName?.trim() && packageName.trim().length >= 3 ? packageName.trim() : detail.session.name;
    const created = await createMigrationPackage({
      connectionId,
      ownerId,
      name,
      files: [{ name: `V1__${slug}.sql`, content: sql }],
    });
    return { ...created, appendedFile: `V1__${slug}.sql`, mode };
  }

  if (detail.diagram.nodes.length === 0) {
    throw new HttpError(400, "A modelagem está vazia — nada para salvar.");
  }

  const sql = generateDdl(detail.diagram, { dialect, databaseName, title: detail.session.name });
  const slug = description?.trim()
    ? slugifyModelingName(description.trim())
    : slugifyModelingName(detail.session.name);
  const name = packageName?.trim() && packageName.trim().length >= 3 ? packageName.trim() : detail.session.name;
  const created = await createMigrationPackage({
    connectionId,
    ownerId,
    name,
    files: [{ name: `V1__${slug}.sql`, content: sql }],
  });
  return { ...created, appendedFile: `V1__${slug}.sql`, mode: "full" };
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

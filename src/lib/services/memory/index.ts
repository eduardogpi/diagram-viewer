import { logger } from "@/lib/logger";
import {
  isCodegraphConfigured,
  recallMemories,
  saveMemory,
  type SaveMemoryParams,
} from "@/lib/services/memory/codegraph";
import type { SchemaOp } from "@/lib/services/schema-ops";

/**
 * Memória do projeto para o chat de modelagem.
 *
 * O padrão é "buscar antes, gravar depois" — o modelo não decide quando usar memória, o que
 * mantém o fluxo em uma única chamada de LLM e funciona até com modelos sem tool calling.
 * Toda operação aqui é best-effort: memória indisponível degrada a qualidade da resposta,
 * nunca derruba o turno do usuário.
 */

export { isCodegraphConfigured as isMemoryConfigured };

/**
 * Namespace da memória. `project_id` agrupa por conexão (todas as sessões de IA do mesmo
 * projeto compartilham memória) e `user_id` isola por dono, igual ao resto do app.
 * `memoryProjectId` permite apontar para um projeto já existente no CodeGraph — por exemplo o
 * repositório de código correspondente, para o chat herdar o que já foi registrado lá.
 */
export function memoryNamespace(session: {
  connectionId: string;
  ownerId: string;
  memoryProjectId?: string | null;
}): { projectId: string; userId: string } {
  return {
    projectId: session.memoryProjectId?.trim() || `workbench:${session.connectionId}`,
    userId: session.ownerId,
  };
}

/** Busca memórias relevantes para a mensagem do usuário. Devolve [] se algo falhar. */
export async function recallForTurn({
  connectionId,
  ownerId,
  memoryProjectId,
  userMessage,
}: {
  connectionId: string;
  ownerId: string;
  memoryProjectId?: string | null;
  userMessage: string;
}): Promise<string[]> {
  if (!isCodegraphConfigured()) return [];

  try {
    const { projectId, userId } = memoryNamespace({ connectionId, ownerId, memoryProjectId });
    const memories = await recallMemories({ projectId, userId, query: userMessage });
    return memories.map((m) => m.content);
  } catch (err) {
    logger.error({ err }, "memória do projeto: falha ao buscar (seguindo sem memória)");
    return [];
  }
}

/**
 * Grava o que este turno decidiu. O conteúdo sai das operações já aplicadas, não de uma
 * segunda chamada de LLM: é determinístico, sem custo e sem alucinação. Turnos que não mudaram
 * o modelo (perguntas, modo "só discutir") não viram memória — o dedupe do CodeGraph resolve
 * repetição, mas não resolve ruído.
 */
export async function saveTurnMemory({
  connectionId,
  ownerId,
  memoryProjectId,
  sessionId,
  sessionName,
  operations,
}: {
  connectionId: string;
  ownerId: string;
  memoryProjectId?: string | null;
  sessionId: string;
  sessionName: string;
  operations: SchemaOp[];
}): Promise<void> {
  if (!isCodegraphConfigured() || operations.length === 0) return;

  const summary = summarizeOperations(operations);
  if (!summary) return;

  try {
    const { projectId, userId } = memoryNamespace({ connectionId, ownerId, memoryProjectId });
    const params: SaveMemoryParams = {
      projectId,
      userId,
      sessionId,
      content: `Modelagem "${sessionName}": ${summary}`,
      memoryType: "decision",
      tags: ["ai-modeling", "schema"],
      importance: 0.6,
    };
    await saveMemory(params);
  } catch (err) {
    logger.error({ err }, "memória do projeto: falha ao gravar (turno segue normalmente)");
  }
}

/** Descreve as operações aplicadas em uma frase, para virar conteúdo de memória. */
export function summarizeOperations(operations: SchemaOp[]): string {
  const parts = operations.map((op) => {
    switch (op.op) {
      case "createTable": {
        const columns = op.columns.map((c) => `${c.name} ${c.type}`).join(", ");
        return `criou a tabela ${op.table}${op.scope ? ` (escopo ${op.scope})` : ""} com as colunas ${columns}${op.comment ? ` — propósito: ${op.comment}` : ""}`;
      }
      case "addColumn":
        return `adicionou a coluna ${op.newColumn.name} (${op.newColumn.type}) em ${op.table}`;
      case "alterColumn": {
        const bits = [
          op.type ? `tipo ${op.type}` : null,
          op.isNullable !== undefined ? (op.isNullable ? "nullable" : "NOT NULL") : null,
          op.isPrimary !== undefined ? (op.isPrimary ? "PK" : "sem PK") : null,
        ].filter(Boolean);
        return `alterou a coluna ${op.column} em ${op.table}${bits.length ? ` (${bits.join(", ")})` : ""}`;
      }
      case "dropColumn":
        return `removeu a coluna ${op.column} de ${op.table}`;
      case "renameColumn":
        return `renomeou a coluna ${op.column} para ${op.newName} em ${op.table}`;
      case "addForeignKey":
        return `ligou ${op.table}.${op.column} a ${op.referencesTable}.${op.referencesColumn} por foreign key`;
      case "dropForeignKey":
        return `removeu a foreign key de ${op.table}.${op.column}`;
      case "dropTable":
        return `removeu a tabela ${op.table}`;
      case "renameTable":
        return `renomeou a tabela ${op.table} para ${op.newName}`;
      case "createIndex":
        return `criou o índice ${op.isUnique ? "UNIQUE " : ""}${op.name ?? op.columns.join("_")} em ${op.table} (${op.columns.join(", ")})`;
      case "dropIndex":
        return `removeu o índice ${op.name} de ${op.table}`;
      case "setComment":
        return op.comment.trim()
          ? `documentou ${op.column ? `a coluna ${op.table}.${op.column}` : `a tabela ${op.table}`}: ${op.comment.trim()}`
          : `removeu o comentário de ${op.column ? `${op.table}.${op.column}` : op.table}`;
    }
  });

  return parts.join("; ");
}

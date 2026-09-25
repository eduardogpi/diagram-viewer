import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Garantia: o caminho de operações diretas NÃO pode chamar a LLM da sessão.
vi.mock("@/lib/services/llm", () => ({
  currentLlmProvider: () => "gemini",
  isLlmProvider: () => true,
  generateSchemaOps: vi.fn(async () => {
    throw new Error("generateSchemaOps não deveria ser chamado por postAiModelingOperations");
  }),
}));

import { prisma } from "@/lib/prisma";
import {
  getAiModelingSession,
  postAiModelingOperations,
  revertAiModelingSession,
} from "@/lib/services/ai-modeling";
import type { SchemaOp } from "@/lib/services/schema-ops";

const OWNER = "apply-ops-test-owner";
let connectionId = "";
let sessionId = "";

const createClientes: SchemaOp = {
  op: "createTable",
  table: "clientes",
  columns: [{ name: "id", type: "BIGINT", isPrimary: true, isNullable: false }],
};

async function tables() {
  const detail = await getAiModelingSession(sessionId, connectionId, OWNER);
  return detail!.diagram.nodes.map((n) => n.id);
}

beforeEach(async () => {
  const secret = await prisma.credentialSecret.create({
    data: { provider: "MIGRATIONS", externalId: `ao-${Date.now()}-${Math.random()}`, cipherText: "x", metadata: "{}" },
  });
  const connection = await prisma.connection.create({
    data: {
      name: "ao-test", provider: "MIGRATIONS", host: "-", port: 0, database: "-",
      username: "-", ownerId: OWNER, secretId: secret.id,
    },
  });
  connectionId = connection.id;
  const session = await prisma.aiModelingSession.create({
    data: { connectionId, ownerId: OWNER, name: "ao", provider: "gemini" },
  });
  sessionId = session.id;
});

// O teste roda contra o dev.db real, então cada caso limpa o que criou.
afterEach(async () => {
  const sessions = await prisma.aiModelingSession.findMany({ where: { ownerId: OWNER }, select: { id: true } });
  await prisma.aiModelingTurn.deleteMany({ where: { sessionId: { in: sessions.map((s) => s.id) } } });
  await prisma.aiModelingSession.deleteMany({ where: { ownerId: OWNER } });
  const connections = await prisma.connection.findMany({ where: { ownerId: OWNER }, select: { id: true, secretId: true } });
  await prisma.connection.deleteMany({ where: { ownerId: OWNER } });
  await prisma.credentialSecret.deleteMany({ where: { id: { in: connections.map((c) => c.secretId) } } });
});

describe("aplicação direta de operações (agente via MCP, sem LLM)", () => {
  it("aplica operações e persiste um único turno de assistente", async () => {
    const result = await postAiModelingOperations({
      sessionId,
      connectionId,
      ownerId: OWNER,
      message: "Criei clientes",
      operations: [createClientes],
    });

    expect(result).not.toBeNull();
    expect(await tables()).toEqual(["clientes"]);

    const detail = await getAiModelingSession(sessionId, connectionId, OWNER);
    expect(detail!.turns).toHaveLength(1);
    expect(detail!.turns[0].role).toBe("assistant");
    expect(detail!.turns[0].message).toContain("Criei clientes");
    expect(detail!.turns[0].operations).toHaveLength(1);
  });

  it("reporta operações rejeitadas sem aplicar mudança parcial escondida", async () => {
    const result = await postAiModelingOperations({
      sessionId,
      connectionId,
      ownerId: OWNER,
      message: "tentativa",
      operations: [
        createClientes,
        { op: "dropTable", table: "inexistente" },
      ],
    });

    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0].reason).toMatch(/não encontrada/);
    expect(await tables()).toEqual(["clientes"]);
  });

  it("funciona com revert/checkpoint igual ao caminho conversado", async () => {
    await postAiModelingOperations({ sessionId, connectionId, ownerId: OWNER, message: "a", operations: [createClientes] });
    const segundo = await postAiModelingOperations({
      sessionId, connectionId, ownerId: OWNER, message: "b",
      operations: [{ op: "createTable", table: "pedidos", columns: [{ name: "id", type: "BIGINT", isPrimary: true, isNullable: false }] }],
    });

    await revertAiModelingSession({ sessionId, connectionId, ownerId: OWNER, turnOrder: 1 });
    expect(await tables()).toEqual(["clientes"]);

    // Continuar do checkpoint descarta o turno à frente.
    await postAiModelingOperations({
      sessionId, connectionId, ownerId: OWNER, message: "c",
      operations: [{ op: "createTable", table: "faturas", columns: [{ name: "id", type: "BIGINT", isPrimary: true, isNullable: false }] }],
    });
    expect(await tables()).toEqual(["clientes", "faturas"]);
    const detail = await getAiModelingSession(sessionId, connectionId, OWNER);
    expect(detail!.turns).toHaveLength(2);
    expect(segundo).not.toBeNull();
  });

  it("não deixa outro usuário aplicar operações na sessão", async () => {
    const result = await postAiModelingOperations({
      sessionId, connectionId, ownerId: "intruso", message: "x", operations: [createClientes],
    });
    expect(result).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
vi.mock("@/lib/services/llm", () => ({
  currentLlmProvider: () => "gemini",
  isLlmProvider: () => true,
  generateText: (...args: unknown[]) => generateText(...args),
}));

import { prisma } from "@/lib/prisma";
import { documentAiModelingSession, getAiModelingSession } from "@/lib/services/ai-modeling";
import type { DiagramResponse } from "@/lib/types/diagram";

const OWNER = "document-test-owner";
let connectionId = "";
let sessionId = "";

const seed: DiagramResponse = {
  nodes: [
    {
      id: "pedidos",
      label: "pedidos",
      schema: "public",
      scope: "app",
      columns: [
        { name: "id", type: "BIGINT", isNullable: false, isPrimary: true, isForeign: false },
        { name: "status", type: "VARCHAR(20)", isNullable: true, isPrimary: false, isForeign: false, comment: "Já documentado" },
      ],
    },
  ],
  edges: [],
  scopes: [],
};

beforeEach(async () => {
  generateText.mockReset();
  const secret = await prisma.credentialSecret.create({
    data: { provider: "MIGRATIONS", externalId: `doc-${Date.now()}-${Math.random()}`, cipherText: "x", metadata: "{}" },
  });
  const connection = await prisma.connection.create({
    data: {
      name: "doc-test", provider: "MIGRATIONS", host: "-", port: 0, database: "-",
      username: "-", ownerId: OWNER, secretId: secret.id,
    },
  });
  connectionId = connection.id;
  const session = await prisma.aiModelingSession.create({
    data: { connectionId, ownerId: OWNER, name: "doc", provider: "gemini", diagramJson: JSON.stringify(seed) },
  });
  sessionId = session.id;
});

// Roda contra o dev.db real: cada caso limpa o que criou.
afterEach(async () => {
  const sessions = await prisma.aiModelingSession.findMany({ where: { ownerId: OWNER }, select: { id: true } });
  await prisma.aiModelingTurn.deleteMany({ where: { sessionId: { in: sessions.map((s) => s.id) } } });
  await prisma.aiModelingSession.deleteMany({ where: { ownerId: OWNER } });
  const connections = await prisma.connection.findMany({ where: { ownerId: OWNER }, select: { id: true, secretId: true } });
  await prisma.connection.deleteMany({ where: { ownerId: OWNER } });
  await prisma.credentialSecret.deleteMany({ where: { id: { in: connections.map((c) => c.secretId) } } });
});

describe("documentAiModelingSession", () => {
  it("aplica só comentários faltantes como um único turno desfazível", async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({
        comments: [
          { table: "pedidos", comment: "Pedidos de compra" },
          { table: "pedidos", column: "status", comment: "tentativa de sobrescrever" },
        ],
      }),
      truncated: false,
    });

    const result = await documentAiModelingSession({ sessionId, connectionId, ownerId: OWNER });
    expect(result?.commented).toEqual({ tables: 1, columns: 0 });
    expect(generateText).toHaveBeenCalledTimes(1);

    const detail = await getAiModelingSession(sessionId, connectionId, OWNER);
    const node = detail!.diagram.nodes[0];
    expect(node.comment).toBe("Pedidos de compra");
    expect(node.columns.find((c) => c.name === "status")?.comment).toBe("Já documentado");
    expect(detail!.turns).toHaveLength(1);
    expect(detail!.turns[0].operations).toEqual([{ op: "setComment", table: "pedidos", comment: "Pedidos de compra" }]);
  });

  it("não chama a LLM nem cria turno quando já está tudo documentado", async () => {
    generateText.mockResolvedValue({ text: JSON.stringify({ comments: [{ table: "pedidos", comment: "x" }] }), truncated: false });
    await documentAiModelingSession({ sessionId, connectionId, ownerId: OWNER });
    generateText.mockClear();

    const again = await documentAiModelingSession({ sessionId, connectionId, ownerId: OWNER });
    expect(again?.assistantTurn).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("falha com 502 quando a LLM não devolve nada aproveitável", async () => {
    generateText.mockResolvedValue({ text: "não entendi", truncated: false });
    await expect(documentAiModelingSession({ sessionId, connectionId, ownerId: OWNER })).rejects.toMatchObject({ status: 502 });
    const detail = await getAiModelingSession(sessionId, connectionId, OWNER);
    expect(detail!.turns).toHaveLength(0);
  });
});

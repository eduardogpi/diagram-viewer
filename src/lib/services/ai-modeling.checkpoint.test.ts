import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A LLM é substituída: cada chamada devolve a operação enfileirada pelo teste.
const queue: Array<{ reply: string; operations: unknown[] }> = [];
vi.mock("@/lib/services/llm", () => ({
  currentLlmProvider: () => "gemini",
  isLlmProvider: () => true,
  generateSchemaOps: vi.fn(async () => queue.shift() ?? { reply: "vazio", operations: [] }),
  streamSchemaOps: vi.fn(async () => queue.shift() ?? { reply: "vazio", operations: [] }),
}));

import { prisma } from "@/lib/prisma";
import {
  getAiModelingSession,
  postAiModelingTurn,
  revertAiModelingSession,
  updateAiModelingSession,
} from "@/lib/services/ai-modeling";

const OWNER = "checkpoint-test-owner";
let connectionId = "";
let sessionId = "";

async function send(message: string, table: string) {
  queue.push({
    reply: `criei ${table}`,
    operations: [{ op: "createTable", table, columns: [{ name: "id", type: "INTEGER", isPrimary: true }] }],
  });
  return postAiModelingTurn({ sessionId, connectionId, ownerId: OWNER, message });
}

async function tables() {
  const detail = await getAiModelingSession(sessionId, connectionId, OWNER);
  return detail!.diagram.nodes.map((n) => n.id);
}

beforeEach(async () => {
  const secret = await prisma.credentialSecret.create({
    data: { provider: "MIGRATIONS", externalId: `cp-${Date.now()}-${Math.random()}`, cipherText: "x", metadata: "{}" },
  });
  const connection = await prisma.connection.create({
    data: {
      name: "cp-test", provider: "MIGRATIONS", host: "-", port: 0, database: "-",
      username: "-", ownerId: OWNER, secretId: secret.id,
    },
  });
  connectionId = connection.id;
  const session = await prisma.aiModelingSession.create({
    data: { connectionId, ownerId: OWNER, name: "cp", provider: "gemini" },
  });
  sessionId = session.id;
  queue.length = 0;
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

describe("checkpoints da modelagem IA", () => {
  it("volta o diagrama para o estado de um turno anterior", async () => {
    await send("crie clientes", "clientes");
    await send("crie pedidos", "pedidos");
    expect(await tables()).toEqual(["clientes", "pedidos"]);

    // Turno 2 = resposta da IA que criou "clientes".
    await revertAiModelingSession({ sessionId, connectionId, ownerId: OWNER, turnOrder: 2 });
    expect(await tables()).toEqual(["clientes"]);

    // Nada foi apagado: os 4 turnos seguem no histórico, dá pra refazer.
    const detail = await getAiModelingSession(sessionId, connectionId, OWNER);
    expect(detail!.turns).toHaveLength(4);
    expect(detail!.session.checkpointOrder).toBe(2);
  });

  it("refaz voltando para o último turno e limpa o checkpoint", async () => {
    await send("crie clientes", "clientes");
    await send("crie pedidos", "pedidos");
    await revertAiModelingSession({ sessionId, connectionId, ownerId: OWNER, turnOrder: 2 });

    await revertAiModelingSession({ sessionId, connectionId, ownerId: OWNER, turnOrder: 4 });
    expect(await tables()).toEqual(["clientes", "pedidos"]);
    const detail = await getAiModelingSession(sessionId, connectionId, OWNER);
    expect(detail!.session.checkpointOrder).toBeNull();
  });

  it("descarta os turnos à frente ao continuar a partir do checkpoint", async () => {
    await send("crie clientes", "clientes");
    await send("crie pedidos", "pedidos");
    await revertAiModelingSession({ sessionId, connectionId, ownerId: OWNER, turnOrder: 2 });

    await send("crie faturas", "faturas");

    expect(await tables()).toEqual(["clientes", "faturas"]);
    const detail = await getAiModelingSession(sessionId, connectionId, OWNER);
    expect(detail!.turns.map((t) => t.message)).toEqual([
      "crie clientes",
      "criei clientes",
      "crie faturas",
      "criei faturas",
    ]);
    expect(detail!.session.checkpointOrder).toBeNull();
  });

  it("recusa checkpoint inexistente", async () => {
    await send("crie clientes", "clientes");
    await expect(
      revertAiModelingSession({ sessionId, connectionId, ownerId: OWNER, turnOrder: 99 })
    ).rejects.toThrow(/não encontrado/);
  });

  it("não deixa outro usuário reverter a sessão", async () => {
    await send("crie clientes", "clientes");
    const result = await revertAiModelingSession({
      sessionId, connectionId, ownerId: "intruso", turnOrder: 2,
    });
    expect(result).toBeNull();
  });

  it("permite trocar o modelo e provedor de uma sessão já iniciada", async () => {
    const updated = await updateAiModelingSession({
      sessionId,
      connectionId,
      ownerId: OWNER,
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct:free",
    });

    expect(updated).not.toBeNull();
    expect(updated!.provider).toBe("openrouter");
    expect(updated!.model).toBe("meta-llama/llama-3.3-70b-instruct:free");

    const session = await getAiModelingSession(sessionId, connectionId, OWNER);
    expect(session!.session.provider).toBe("openrouter");
    expect(session!.session.model).toBe("meta-llama/llama-3.3-70b-instruct:free");
  });
});

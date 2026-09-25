import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUserId: vi.fn(),
  listConnectionsForUser: vi.fn(),
  findConnectionForUser: vi.fn(),
  requireDriver: vi.fn(),
  toDriverConfig: vi.fn(),
  findDriver: vi.fn(),
  listSqlQueryHistory: vi.fn(),
  logConnectionAudit: vi.fn(),
  listLlmModels: vi.fn(),
  availableLlmProviders: vi.fn(),
  currentLlmProvider: vi.fn(),
  encryptSecret: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/session", () => ({ requireCurrentUserId: mocks.requireCurrentUserId }));
vi.mock("@/lib/services/connections", () => ({
  listConnectionsForUser: mocks.listConnectionsForUser,
  findConnectionForUser: mocks.findConnectionForUser,
}));
vi.mock("@/lib/db/drivers", () => ({
  requireDriver: mocks.requireDriver,
  toDriverConfig: mocks.toDriverConfig,
  findDriver: mocks.findDriver,
}));
vi.mock("@/lib/services/workspace", () => ({
  listSqlQueryHistory: mocks.listSqlQueryHistory,
  logConnectionAudit: mocks.logConnectionAudit,
}));
vi.mock("@/lib/services/llm", () => ({
  listLlmModels: mocks.listLlmModels,
  availableLlmProviders: mocks.availableLlmProviders,
  currentLlmProvider: mocks.currentLlmProvider,
}));
vi.mock("@/lib/crypto", () => ({ encryptSecret: mocks.encryptSecret }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { GET as getModels } from "@/app/api/ai-modeling/models/route";
import { GET as listConnections, POST as createConnection } from "@/app/api/connections/route";
import { POST as runQuery } from "@/app/api/sql/query/[connectionId]/route";

function jsonRequest(url: string, body?: unknown, method = "POST") {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (connectionId: string) => ({ params: Promise.resolve({ connectionId }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/ai-modeling/models", () => {
  it("devolve provedores e modelos disponíveis", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.availableLlmProviders.mockReturnValue(["gemini"]);
    mocks.currentLlmProvider.mockReturnValue("gemini");
    mocks.listLlmModels.mockResolvedValue([{ id: "gemini-2.0-flash", displayName: "Flash", provider: "gemini" }]);

    const res = await getModels(jsonRequest("http://localhost/api/ai-modeling/models", undefined, "GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.defaultProvider).toBe("gemini");
    expect(body.models).toHaveLength(1);
  });

  it("responde 401 quando não há usuário autenticado", async () => {
    mocks.requireCurrentUserId.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const res = await getModels(jsonRequest("http://localhost/api/ai-modeling/models", undefined, "GET"));

    expect(res.status).toBe(401);
  });
});

describe("GET /api/connections", () => {
  it("lista as conexões do usuário", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.listConnectionsForUser.mockResolvedValue([{ id: "c1", name: "Loja" }]);

    const res = await listConnections();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.listConnectionsForUser).toHaveBeenCalledWith("user-1");
    expect(body).toEqual([{ id: "c1", name: "Loja" }]);
  });
});

describe("POST /api/connections", () => {
  it("rejeita payload inválido com 400", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");

    const res = await createConnection(jsonRequest("http://localhost/api/connections", { name: "ab" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Payload inválido");
  });
});

describe("POST /api/sql/query/[connectionId]", () => {
  it("executa consulta read-only e registra auditoria", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.findConnectionForUser.mockResolvedValue({
      id: "c1",
      provider: "MYSQL",
      secret: { cipherText: "enc" },
    });
    const executeReadOnlyQuery = vi.fn().mockResolvedValue({
      columns: ["id"],
      rows: [{ id: 1 }],
      rowCount: 1,
      durationMs: 5,
      truncated: false,
    });
    mocks.requireDriver.mockReturnValue({ executeReadOnlyQuery });
    mocks.toDriverConfig.mockReturnValue({ host: "h", port: 3306, username: "u", password: "p", database: "d" });

    const res = await runQuery(
      jsonRequest("http://localhost/api/sql/query/c1", { sql: "SELECT id FROM clientes" }),
      params("c1")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rowCount).toBe(1);
    expect(executeReadOnlyQuery).toHaveBeenCalledWith(
      expect.objectContaining({ sql: "SELECT id FROM clientes", rowLimit: 200 })
    );
    expect(mocks.logConnectionAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SQL_QUERY_SUCCEEDED", connectionId: "c1" })
    );
  });

  it("responde 404 quando a conexão não pertence ao usuário", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.findConnectionForUser.mockResolvedValue(null);

    const res = await runQuery(
      jsonRequest("http://localhost/api/sql/query/c9", { sql: "SELECT 1" }),
      params("c9")
    );

    expect(res.status).toBe(404);
  });
});

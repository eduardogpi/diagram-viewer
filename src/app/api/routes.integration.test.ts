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
  summarizeMigration: vi.fn(),
  reprocessMigrationPackage: vi.fn(),
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
vi.mock("@/lib/services/migration-summary", () => ({ summarizeMigration: mocks.summarizeMigration }));
vi.mock("@/lib/services/migrations", () => ({
  reprocessMigrationPackage: mocks.reprocessMigrationPackage,
}));
vi.mock("@/lib/crypto", () => ({ encryptSecret: mocks.encryptSecret }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { GET as getModels } from "@/app/api/ai-modeling/models/route";
import { GET as listConnections, POST as createConnection } from "@/app/api/connections/route";
import { POST as reprocessMigrationRoute } from "@/app/api/migrations/[connectionId]/[packageId]/reprocess/route";
import { POST as summarizeMigrationRoute } from "@/app/api/migrations/[connectionId]/[packageId]/summary/route";
import { POST as runQuery } from "@/app/api/sql/query/[connectionId]/route";

function jsonRequest(url: string, body?: unknown, method = "POST") {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (connectionId: string) => ({ params: Promise.resolve({ connectionId }) });

const summaryParams = (connectionId: string, packageId: string) => ({
  params: Promise.resolve({ connectionId, packageId }),
});

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

describe("POST /api/migrations/[connectionId]/[packageId]/summary", () => {
  it("gera o resumo e registra auditoria", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.findConnectionForUser.mockResolvedValue({ id: "c1", provider: "MIGRATIONS" });
    mocks.summarizeMigration.mockResolvedValue({
      summary: "Adiciona a coluna email.",
      truncated: false,
      provider: "gemini",
      model: "gemini-2.0-flash",
      context: { before: 2, after: 1 },
    });

    const res = await summarizeMigrationRoute(
      jsonRequest("http://localhost/api/migrations/c1/p1/summary", { order: 4, before: 2, after: 1 }),
      summaryParams("c1", "p1")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary).toBe("Adiciona a coluna email.");
    expect(mocks.summarizeMigration).toHaveBeenCalledWith(
      expect.objectContaining({ packageId: "p1", connectionId: "c1", ownerId: "user-1", order: 4, before: 2, after: 1 })
    );
    expect(mocks.logConnectionAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MIGRATION_SUMMARY_GENERATED", connectionId: "c1" })
    );
  });

  it("aplica os defaults de contexto quando omitidos", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.findConnectionForUser.mockResolvedValue({ id: "c1", provider: "MIGRATIONS" });
    mocks.summarizeMigration.mockResolvedValue({
      summary: "x",
      truncated: false,
      provider: "gemini",
      model: "m",
      context: { before: 2, after: 2 },
    });

    await summarizeMigrationRoute(
      jsonRequest("http://localhost/api/migrations/c1/p1/summary", { order: 7 }),
      summaryParams("c1", "p1")
    );

    expect(mocks.summarizeMigration).toHaveBeenCalledWith(
      expect.objectContaining({ order: 7, before: 2, after: 2 })
    );
  });

  it("rejeita payload inválido com 400", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.findConnectionForUser.mockResolvedValue({ id: "c1", provider: "MIGRATIONS" });

    const res = await summarizeMigrationRoute(
      jsonRequest("http://localhost/api/migrations/c1/p1/summary", { order: -1 }),
      summaryParams("c1", "p1")
    );

    expect(res.status).toBe(400);
  });

  it("responde 404 quando a migration não existe no package", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.findConnectionForUser.mockResolvedValue({ id: "c1", provider: "MIGRATIONS" });
    mocks.summarizeMigration.mockResolvedValue(null);

    const res = await summarizeMigrationRoute(
      jsonRequest("http://localhost/api/migrations/c1/p1/summary", { order: 999 }),
      summaryParams("c1", "p1")
    );

    expect(res.status).toBe(404);
  });

  it("responde 401 sem usuário autenticado", async () => {
    mocks.requireCurrentUserId.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const res = await summarizeMigrationRoute(
      jsonRequest("http://localhost/api/migrations/c1/p1/summary", { order: 1 }),
      summaryParams("c1", "p1")
    );

    expect(res.status).toBe(401);
  });
});

describe("POST /api/migrations/[connectionId]/[packageId]/reprocess", () => {
  it("regrava os snapshots e registra auditoria", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.findConnectionForUser.mockResolvedValue({ id: "c1", provider: "MIGRATIONS" });
    mocks.reprocessMigrationPackage.mockResolvedValue({
      package: {
        id: "p1",
        name: "migration",
        sourceProvider: "flyway",
        fileCount: 74,
        checksum: "abc",
        createdAt: "2026-01-01T00:00:00.000Z",
        parserVersion: 2,
        parserStale: false,
      },
      snapshotCount: 74,
      tables: 63,
      warnings: 0,
    });

    const res = await reprocessMigrationRoute(
      jsonRequest("http://localhost/api/migrations/c1/p1/reprocess"),
      summaryParams("c1", "p1")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tables).toBe(63);
    expect(body.package.parserStale).toBe(false);
    expect(mocks.reprocessMigrationPackage).toHaveBeenCalledWith({
      packageId: "p1",
      connectionId: "c1",
      ownerId: "user-1",
    });
    expect(mocks.logConnectionAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MIGRATION_PACKAGE_REPROCESSED", connectionId: "c1" })
    );
  });

  it("responde 404 quando o package não existe", async () => {
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.findConnectionForUser.mockResolvedValue({ id: "c1", provider: "MIGRATIONS" });
    mocks.reprocessMigrationPackage.mockResolvedValue(null);

    const res = await reprocessMigrationRoute(
      jsonRequest("http://localhost/api/migrations/c1/p9/reprocess"),
      summaryParams("c1", "p9")
    );

    expect(res.status).toBe(404);
  });

  it("responde 401 sem usuário autenticado", async () => {
    mocks.requireCurrentUserId.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const res = await reprocessMigrationRoute(
      jsonRequest("http://localhost/api/migrations/c1/p1/reprocess"),
      summaryParams("c1", "p1")
    );

    expect(res.status).toBe(401);
  });
});

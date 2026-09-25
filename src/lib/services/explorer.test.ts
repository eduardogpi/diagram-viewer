import { describe, expect, it } from "vitest";

import type { IntrospectionResult } from "@/lib/db/drivers/types";
import { buildExplorerCatalog, buildPreviewSql } from "@/lib/services/explorer";
import { lojaSchemaFixture } from "@/test/fixtures/schema";

const withExtras: IntrospectionResult = {
  ...lojaSchemaFixture,
  indexes: [
    { tableName: "pedidos", indexName: "PRIMARY", columns: ["id"], isUnique: true, isPrimary: true },
    { tableName: "pedidos", indexName: "idx_pedidos_cliente", columns: ["cliente_id"], isUnique: false, isPrimary: false },
  ],
  stats: [
    { tableName: "clientes", estimatedRows: 1200 },
    { tableName: "pedidos", estimatedRows: 5400 },
  ],
};

describe("buildExplorerCatalog", () => {
  it("monta colunas com PK/FK e referência", () => {
    const catalog = buildExplorerCatalog(withExtras, { provider: "MYSQL", database: "loja" });
    const pedidos = catalog.tables.find((t) => t.name === "pedidos");

    expect(pedidos?.columns.find((c) => c.name === "id")?.isPrimary).toBe(true);
    const fkColumn = pedidos?.columns.find((c) => c.name === "cliente_id");
    expect(fkColumn?.isForeign).toBe(true);
    expect(fkColumn?.references).toEqual({ table: "clientes", column: "id" });
  });

  it("indexa FKs de entrada e saída", () => {
    const catalog = buildExplorerCatalog(withExtras, { provider: "MYSQL", database: "loja" });
    const clientes = catalog.tables.find((t) => t.name === "clientes");
    const pedidos = catalog.tables.find((t) => t.name === "pedidos");

    expect(pedidos?.foreignKeys).toHaveLength(1);
    expect(clientes?.referencedBy).toHaveLength(1);
    expect(clientes?.referencedBy[0]).toMatchObject({ referencesTable: "pedidos" });
  });

  it("expõe índices, estatísticas e schemas", () => {
    const catalog = buildExplorerCatalog(withExtras, { provider: "MYSQL", database: "loja" });
    const pedidos = catalog.tables.find((t) => t.name === "pedidos");

    expect(pedidos?.indexes.map((i) => i.name)).toContain("idx_pedidos_cliente");
    expect(pedidos?.estimatedRows).toBe(5400);
    expect(catalog.schemas).toEqual(["loja"]);
  });
});

describe("buildPreviewSql", () => {
  it("quota identificadores por dialeto", () => {
    expect(buildPreviewSql("MYSQL", { table: "pedidos" }, 50)).toBe("SELECT * FROM `pedidos` LIMIT 50");
    expect(buildPreviewSql("POSTGRES", { table: "pedidos", schema: "public" }, 10)).toBe(
      'SELECT * FROM "public"."pedidos" LIMIT 10'
    );
  });

  it("recusa identificador inválido", () => {
    expect(() => buildPreviewSql("MYSQL", { table: "pedidos; DROP TABLE x" }, 10)).toThrow();
  });
});

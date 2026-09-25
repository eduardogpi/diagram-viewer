import { describe, expect, it } from "vitest";

import { buildExplorerCatalog } from "@/lib/services/explorer";
import { buildSchemaMarkdown } from "@/lib/services/schema-docs";
import { lojaSchemaFixture } from "@/test/fixtures/schema";

describe("buildSchemaMarkdown", () => {
  it("gera markdown agrupado por schema com colunas e relacionamentos", () => {
    const catalog = buildExplorerCatalog(
      {
        ...lojaSchemaFixture,
        indexes: [{ tableName: "pedidos", indexName: "PRIMARY", columns: ["id"], isUnique: true, isPrimary: true }],
        stats: [{ tableName: "pedidos", estimatedRows: 42 }],
      },
      { provider: "MYSQL", database: "loja" }
    );

    const markdown = buildSchemaMarkdown(catalog, new Date("2026-01-01T00:00:00.000Z"));

    expect(markdown).toContain("# Documentação do schema — loja");
    expect(markdown).toContain("## Schema `loja`");
    expect(markdown).toContain("### `pedidos`");
    expect(markdown).toContain("| Coluna | Tipo | Chaves | Referência |");
    expect(markdown).toContain("`cliente_id`");
    expect(markdown).toContain("`clientes.id`");
    expect(markdown).toContain("~42 linha(s) estimadas");
    expect(markdown).toContain("**Relacionamentos:**");
  });
});

import { describe, expect, it } from "vitest";

import { buildDiagramFromIntrospection, deriveScope } from "@/lib/db/drivers/shared";
import { lojaSchemaFixture } from "@/test/fixtures/schema";

describe("smoke: montar diagrama a partir do catálogo", () => {
  it("gera nodes, edges e scopes coerentes para o schema da loja", () => {
    const diagram = buildDiagramFromIntrospection(lojaSchemaFixture, "loja");

    expect(diagram.nodes.map((n) => n.id).sort()).toEqual(
      ["clientes", "pedido_itens", "pedidos", "produtos"].sort()
    );

    expect(diagram.edges).toHaveLength(3);
    const pedidosCliente = diagram.edges.find((e) => e.constraint === "fk_pedidos_cliente");
    expect(pedidosCliente).toMatchObject({ source: "pedidos", target: "clientes" });
    expect(pedidosCliente?.columns).toEqual([{ source: "cliente_id", target: "id" }]);
    expect(pedidosCliente?.onDelete).toBe("RESTRICT");

    expect(diagram.scopes.map((s) => s.id).sort()).toEqual(["clientes", "pedido", "pedidos", "produtos"].sort());

    const pedidos = diagram.nodes.find((n) => n.id === "pedidos");
    expect(pedidos?.columns.find((c) => c.name === "cliente_id")?.isForeign).toBe(true);
    expect(pedidos?.columns.find((c) => c.name === "id")?.isPrimary).toBe(true);
  });

  it("resolve escopo por prefixo e cai no schema quando o prefixo é curto", () => {
    expect(deriveScope("auth_users", "public")).toBe("auth");
    expect(deriveScope("id_seq", "public")).toBe("public");
  });
});

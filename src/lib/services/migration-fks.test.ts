import { describe, expect, it } from "vitest";

import {
  buildForeignKeysDelta,
  suggestHeuristicForeignKeys,
} from "./migration-fks";
import type { DiagramResponse } from "@/lib/types/diagram";

function sampleDiagram(): DiagramResponse {
  return {
    scopes: [{ id: "public", label: "public", description: "Public schema", tables: 3 }],
    nodes: [
      {
        id: "public.customers",
        label: "customers",
        schema: "public",
        scope: "public",
        columns: [
          { name: "id", type: "bigint", isPrimary: true, isForeign: false, isNullable: false },
          { name: "email", type: "varchar(255)", isPrimary: false, isForeign: false, isNullable: false },
        ],
      },
      {
        id: "public.orders",
        label: "orders",
        schema: "public",
        scope: "public",
        columns: [
          { name: "id", type: "bigint", isPrimary: true, isForeign: false, isNullable: false },
          { name: "customer_id", type: "bigint", isPrimary: false, isForeign: false, isNullable: false },
          { name: "total_cents", type: "integer", isPrimary: false, isForeign: false, isNullable: false },
        ],
      },
      {
        id: "public.order_items",
        label: "order_items",
        schema: "public",
        scope: "public",
        columns: [
          { name: "id", type: "bigint", isPrimary: true, isForeign: false, isNullable: false },
          { name: "id_order", type: "bigint", isPrimary: false, isForeign: false, isNullable: false },
        ],
      },
    ],
    edges: [],
  };
}

describe("migration-fks service", () => {
  it("suggests heuristic foreign keys for *_id and id_* columns without existing FKs", () => {
    const diagram = sampleDiagram();
    const suggestions = suggestHeuristicForeignKeys(diagram);

    expect(suggestions.length).toBe(2);
    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "public.orders",
          column: "customer_id",
          referencesTable: "public.customers",
          referencesColumn: "id",
          source: "heuristic",
        }),
        expect.objectContaining({
          table: "public.order_items",
          column: "id_order",
          referencesTable: "public.orders",
          referencesColumn: "id",
          source: "heuristic",
        }),
      ])
    );
  });

  it("does not suggest an FK that already exists in diagram.edges", () => {
    const diagram = sampleDiagram();
    diagram.edges.push({
      id: "public.orders.customer_id->public.customers.id",
      source: "public.orders",
      target: "public.customers",
      scope: "public",
      constraint: "fk_orders_customer_id",
      columns: [{ source: "customer_id", target: "id" }],
    });

    const suggestions = suggestHeuristicForeignKeys(diagram);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]?.table).toBe("public.order_items");
  });

  it("builds incremental ALTER TABLE SQL and V{N+1} filename for selected FKs", () => {
    const diagram = sampleDiagram();
    const result = buildForeignKeysDelta({
      diagram,
      fks: [
        {
          table: "public.orders",
          column: "customer_id",
          referencesTable: "public.customers",
          referencesColumn: "id",
        },
      ],
      dialect: "postgres",
      nextVersionNumber: 6,
      description: "add_foreign_keys",
    });

    expect(result.operations.length).toBe(1);
    expect(result.filename).toBe("V6__add_foreign_keys.sql");
    expect(result.sql).toContain("ALTER TABLE");
    expect(result.sql).toContain("FOREIGN KEY");
    expect(result.sql).toContain("REFERENCES");
    expect(result.updatedDiagram.edges.length).toBe(1);
  });
});

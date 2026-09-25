import { describe, expect, it } from "vitest";

import { applySchemaOps } from "@/lib/services/schema-ops";
import type { DiagramResponse } from "@/lib/types/diagram";

const EMPTY: DiagramResponse = { nodes: [], edges: [], scopes: [] };

describe("applySchemaOps / tabelas qualificadas por sistema", () => {
  it("usa o prefixo do nome qualificado como escopo e o sufixo como rótulo", () => {
    const { next } = applySchemaOps(EMPTY, [
      { op: "createTable", table: "projeto-a.pagamentos", columns: [{ name: "id", type: "INTEGER", isPrimary: true, isNullable: false }] },
    ]);

    const node = next.nodes[0];
    expect(node.id).toBe("projeto-a.pagamentos");
    expect(node.label).toBe("pagamentos");
    expect(node.scope).toBe("projeto-a");
  });

  it("um scope explícito tem precedência sobre o prefixo", () => {
    const { next } = applySchemaOps(EMPTY, [
      { op: "createTable", table: "projeto-a.pagamentos", scope: "financeiro", columns: [] },
    ]);
    expect(next.nodes[0].scope).toBe("financeiro");
  });

  it("nome simples segue com o comportamento de antes", () => {
    const { next } = applySchemaOps(EMPTY, [
      { op: "createTable", table: "clientes", columns: [{ name: "id", type: "INTEGER", isPrimary: true, isNullable: false }] },
    ]);
    expect(next.nodes[0].id).toBe("clientes");
    expect(next.nodes[0].label).toBe("clientes");
  });

  it("distingue tabelas homônimas de sistemas diferentes", () => {
    const { next, warnings } = applySchemaOps(EMPTY, [
      { op: "createTable", table: "projeto-a.users", columns: [] },
      { op: "createTable", table: "projeto-b.users", columns: [] },
      { op: "addColumn", table: "projeto-b.users", newColumn: { name: "cpf", type: "VARCHAR(11)", isPrimary: false, isNullable: true } },
    ]);

    expect(warnings).toHaveLength(0);
    expect(next.nodes).toHaveLength(2);
    expect(next.nodes.find((n) => n.id === "projeto-b.users")!.columns.map((c) => c.name)).toContain("cpf");
    expect(next.nodes.find((n) => n.id === "projeto-a.users")!.columns.map((c) => c.name)).not.toContain("cpf");
  });

  it("avisa quando a tabela referenciada é ambígua (nome sem qualificação)", () => {
    const base = applySchemaOps(EMPTY, [
      { op: "createTable", table: "projeto-a.users", columns: [] },
      { op: "createTable", table: "projeto-b.users", columns: [] },
    ]).next;

    const { warnings } = applySchemaOps(base, [
      { op: "addColumn", table: "users", newColumn: { name: "x", type: "INT", isPrimary: false, isNullable: true } },
    ]);
    expect(warnings[0].reason).toMatch(/ambígua/);
  });

  it("resolve tabela única pelo rótulo sem qualificação", () => {
    const base = applySchemaOps(EMPTY, [
      { op: "createTable", table: "projeto-a.users", columns: [] },
    ]).next;

    const { next, warnings } = applySchemaOps(base, [
      { op: "addColumn", table: "users", newColumn: { name: "email", type: "VARCHAR(255)", isPrimary: false, isNullable: true } },
    ]);

    expect(warnings).toHaveLength(0);
    expect(next.nodes[0].columns.map((c) => c.name)).toContain("email");
  });
});

describe("applySchemaOps / integridade de foreign keys", () => {
  function schemaWithFk() {
    return applySchemaOps(EMPTY, [
      {
        op: "createTable",
        table: "clientes",
        columns: [{ name: "id", type: "BIGINT", isPrimary: true, isNullable: false }],
      },
      {
        op: "createTable",
        table: "pedidos",
        columns: [
          { name: "id", type: "BIGINT", isPrimary: true, isNullable: false },
          { name: "cliente_id", type: "BIGINT", isPrimary: false, isNullable: false },
        ],
      },
      {
        op: "addForeignKey",
        table: "pedidos",
        column: "cliente_id",
        referencesTable: "clientes",
        referencesColumn: "id",
        onDelete: "cascade",
      },
    ]).next;
  }

  it("atualiza a ponta referenciada quando a coluna alvo é renomeada", () => {
    const { next, warnings } = applySchemaOps(schemaWithFk(), [
      { op: "renameColumn", table: "clientes", column: "id", newName: "cliente_pk" },
    ]);

    expect(warnings).toHaveLength(0);
    expect(next.edges[0].columns[0].target).toBe("cliente_pk");
    const fkCol = next.nodes.find((n) => n.id === "pedidos")!.columns.find((c) => c.name === "cliente_id")!;
    expect(fkCol.references).toEqual({ table: "clientes", column: "cliente_pk" });
  });

  it("remove a FK quando a tabela alvo some", () => {
    const { next } = applySchemaOps(schemaWithFk(), [{ op: "dropTable", table: "clientes" }]);
    expect(next.edges).toHaveLength(0);
    const pedidos = next.nodes.find((n) => n.id === "pedidos")!;
    const clienteId = pedidos.columns.find((c) => c.name === "cliente_id")!;
    expect(clienteId.isForeign).toBe(false);
    expect(clienteId.references).toBeUndefined();
  });

  it("atualiza referências ao renomear a tabela alvo", () => {
    const { next } = applySchemaOps(schemaWithFk(), [{ op: "renameTable", table: "clientes", newName: "pessoas" }]);
    expect(next.edges[0].target).toBe("pessoas");
    const fkCol = next.nodes.find((n) => n.id === "pedidos")!.columns.find((c) => c.name === "cliente_id")!;
    expect(fkCol.references?.table).toBe("pessoas");
  });

  it("recusa FK para coluna que não existe no alvo", () => {
    const base = applySchemaOps(EMPTY, [
      { op: "createTable", table: "a", columns: [{ name: "id", type: "INT", isPrimary: true, isNullable: false }] },
      {
        op: "createTable",
        table: "b",
        columns: [
          { name: "id", type: "INT", isPrimary: true, isNullable: false },
          { name: "a_id", type: "INT", isPrimary: false, isNullable: false },
        ],
      },
    ]).next;

    const { warnings, next } = applySchemaOps(base, [
      { op: "addForeignKey", table: "b", column: "a_id", referencesTable: "a", referencesColumn: "uuid" },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toMatch(/não encontrada/);
    expect(next.edges).toHaveLength(0);
  });

  it("altera tipo, nullability e PK sem perder a FK da coluna", () => {
    const base = schemaWithFk();
    const { next, warnings } = applySchemaOps(base, [
      { op: "alterColumn", table: "pedidos", column: "cliente_id", type: "INTEGER", isNullable: true },
    ]);
    expect(warnings).toHaveLength(0);
    const col = next.nodes.find((n) => n.id === "pedidos")!.columns.find((c) => c.name === "cliente_id")!;
    expect(col.type).toBe("INTEGER");
    expect(col.isNullable).toBe(true);
    expect(col.isForeign).toBe(true);
    expect(next.edges).toHaveLength(1);
  });

  it("anota FK cruzada de escopo sem rejeitar a operação", () => {
    const { next, warnings, notes } = applySchemaOps(EMPTY, [
      { op: "createTable", table: "projeto-a.users", columns: [{ name: "id", type: "INT", isPrimary: true, isNullable: false }] },
      {
        op: "createTable",
        table: "projeto-b.orders",
        columns: [
          { name: "id", type: "INT", isPrimary: true, isNullable: false },
          { name: "user_id", type: "INT", isPrimary: false, isNullable: true },
        ],
      },
      {
        op: "addForeignKey",
        table: "projeto-b.orders",
        column: "user_id",
        referencesTable: "projeto-a.users",
        referencesColumn: "id",
      },
    ]);

    expect(warnings).toHaveLength(0);
    expect(notes.some((n) => /escopos/.test(n))).toBe(true);
    expect(next.edges).toHaveLength(1);
  });
});

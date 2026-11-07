import { describe, expect, it } from "vitest";

import { computeDetailedDiagramDiff, computeDiagramDiff } from "@/lib/diagram-diff";
import { applySchemaOps, parseSchemaOpsResponse } from "@/lib/services/schema-ops";
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

  it("atualiza constraint e id da aresta ao renomear coluna de origem da FK", () => {
    const { next } = applySchemaOps(schemaWithFk(), [
      { op: "renameColumn", table: "pedidos", column: "cliente_id", newName: "comprador_id" },
    ]);
    const edge = next.edges[0];
    expect(edge.columns[0].source).toBe("comprador_id");
    expect(edge.constraint).toBe("fk_pedidos_comprador_id");
    expect(edge.id).toBe("pedidos-clientes-fk_pedidos_comprador_id");
    const col = next.nodes.find((n) => n.id === "pedidos")!.columns.find((c) => c.name === "comprador_id")!;
    expect(col.fkMetadata?.constraintName).toBe("fk_pedidos_comprador_id");
  });

  it("atualiza escopo e id da aresta ao renomear tabela de origem da FK", () => {
    const { next } = applySchemaOps(schemaWithFk(), [
      { op: "renameTable", table: "pedidos", newName: "financeiro.compras" },
    ]);
    const compras = next.nodes.find((n) => n.id === "financeiro.compras")!;
    expect(compras.scope).toBe("financeiro");
    expect(compras.label).toBe("compras");
    const edge = next.edges[0];
    expect(edge.source).toBe("financeiro.compras");
    expect(edge.scope).toBe("financeiro");
    expect(edge.id).toContain("financeiro.compras-clientes-");
  });

  it("computeDiagramDiff marca tabela como altered quando nullability ou FK mudam", () => {
    const base = schemaWithFk();
    const { next: nullableChanged } = applySchemaOps(base, [
      { op: "alterColumn", table: "pedidos", column: "cliente_id", isNullable: true },
    ]);
    expect(computeDiagramDiff(base, nullableChanged).get("pedidos")).toBe("altered");
  });

  it("computeDetailedDiagramDiff detalha colunas adicionadas, alteradas e removidas", () => {
    const base = applySchemaOps(schemaWithFk(), [
      {
        op: "addColumn",
        table: "clientes",
        newColumn: { name: "nome", type: "VARCHAR(120)", isPrimary: false, isNullable: false },
      },
      {
        op: "addColumn",
        table: "pedidos",
        newColumn: { name: "valor", type: "DECIMAL(10,2)", isPrimary: false, isNullable: true },
      },
    ]).next;
    const { next: modified } = applySchemaOps(base, [
      {
        op: "addColumn",
        table: "pedidos",
        newColumn: { name: "status", type: "VARCHAR(30)", isPrimary: false, isNullable: false },
      },
      {
        op: "alterColumn",
        table: "pedidos",
        column: "valor",
        type: "DECIMAL(12,2)",
        isNullable: false,
      },
      {
        op: "dropColumn",
        table: "clientes",
        column: "nome",
      },
    ]);

    const detailed = computeDetailedDiagramDiff(base, modified);

    const pedidosDiff = detailed.get("pedidos");
    expect(pedidosDiff?.status).toBe("altered");
    expect(pedidosDiff?.columns.get("status")).toMatchObject({
      status: "added",
      currentType: "VARCHAR(30)",
      changes: ["+VARCHAR(30) NOT NULL"],
    });
    expect(pedidosDiff?.columns.get("valor")).toMatchObject({
      status: "altered",
      previousType: "DECIMAL(10,2)",
      currentType: "DECIMAL(12,2)",
      changes: ["tipo: DECIMAL(10,2) → DECIMAL(12,2)", "NULL → NOT NULL"],
    });

    const clientesDiff = detailed.get("clientes");
    expect(clientesDiff?.status).toBe("altered");
    expect(clientesDiff?.removedColumns).toHaveLength(1);
    expect(clientesDiff?.removedColumns[0]).toMatchObject({
      name: "nome",
      status: "removed",
      previousType: "VARCHAR(120)",
    });
  });

  it("normaliza variações de renameColumn da LLM (from/to, oldName/newName, rename_column) e alterColumn com newName", () => {
    const rawPayload = {
      reply: "Renomeando colunas",
      operations: [
        { op: "renameColumn", table: "clientes", from: "nome", to: "nome_completo" },
        { op: "rename_column", table: "pedidos", oldName: "cliente_id", newName: "id_cliente" },
        { op: "alterColumn", table: "pedidos", oldColumn: "id_cliente", newColumn: "comprador_id", type: "BIGINT" },
      ],
    };
    const parsed = parseSchemaOpsResponse(rawPayload);
    expect(parsed.skippedCount).toBe(0);
    expect(parsed.operations).toHaveLength(3);
    expect(parsed.operations[0]).toEqual({
      op: "renameColumn",
      table: "clientes",
      column: "nome",
      newName: "nome_completo",
    });
    expect(parsed.operations[1]).toEqual({
      op: "renameColumn",
      table: "pedidos",
      column: "cliente_id",
      newName: "id_cliente",
    });
    expect(parsed.operations[2]).toMatchObject({
      op: "alterColumn",
      table: "pedidos",
      column: "id_cliente",
      newName: "comprador_id",
      type: "BIGINT",
    });
  });

  it("permite renomear coluna via alterColumn (com ou sem mudança de tipo) e faz match case-insensitive", () => {
    const base = applySchemaOps(schemaWithFk(), [
      {
        op: "addColumn",
        table: "clientes",
        newColumn: { name: "EmailCliente", type: "VARCHAR(120)", isPrimary: false, isNullable: false, isUnique: true },
      },
      {
        op: "createIndex",
        table: "clientes",
        name: "idx_clientes_email",
        columns: ["EmailCliente"],
        isUnique: true,
      },
    ]).next;

    const { next, warnings } = applySchemaOps(base, [
      {
        op: "alterColumn",
        table: "CLIENTES",
        column: "emailcliente",
        newName: "email_principal",
      },
      {
        op: "alterColumn",
        table: "pedidos",
        column: "CLIENTE_ID",
        newName: "comprador_id",
      },
    ]);

    expect(warnings).toHaveLength(0);
    const clientes = next.nodes.find((n) => n.id === "clientes")!;
    expect(clientes.columns.map((c) => c.name)).toContain("email_principal");
    expect(clientes.indexes?.[0]?.columns).toEqual(["email_principal"]);

    const pedidos = next.nodes.find((n) => n.id === "pedidos")!;
    const fkCol = pedidos.columns.find((c) => c.name === "comprador_id");
    expect(fkCol?.references?.table).toBe("clientes");
    expect(next.edges[0]?.id).toContain("comprador_id");
  });

  it("cria e remove índices (createIndex / dropIndex) e sincroniza flag isUnique em índice de 1 coluna", () => {
    const base = applySchemaOps(schemaWithFk(), [
      {
        op: "addColumn",
        table: "clientes",
        newColumn: { name: "cpf", type: "VARCHAR(14)", isPrimary: false, isNullable: false },
      },
    ]).next;

    const { next: withIdx, warnings: w1 } = applySchemaOps(base, [
      {
        op: "createIndex",
        table: "clientes",
        name: "uq_clientes_cpf",
        columns: ["cpf"],
        isUnique: true,
      },
    ]);
    expect(w1).toHaveLength(0);
    const clientes = withIdx.nodes.find((n) => n.id === "clientes")!;
    expect(clientes.indexes).toEqual([
      { name: "uq_clientes_cpf", columns: ["cpf"], isUnique: true },
    ]);
    expect(clientes.columns.find((c) => c.name === "cpf")?.isUnique).toBe(true);

    const { next: withoutIdx, warnings: w2 } = applySchemaOps(withIdx, [
      { op: "dropIndex", table: "clientes", name: "uq_clientes_cpf" },
    ]);
    expect(w2).toHaveLength(0);
    const clientesAfter = withoutIdx.nodes.find((n) => n.id === "clientes")!;
    expect(clientesAfter.indexes).toEqual([]);
    expect(clientesAfter.columns.find((c) => c.name === "cpf")?.isUnique).toBe(false);
  });
});

describe("applySchemaOps / comentários de documentação", () => {
  const base = applySchemaOps(EMPTY, [
    {
      op: "createTable",
      table: "cupons",
      comment: "  Cupons de desconto aplicáveis a pedidos  ",
      columns: [
        { name: "id", type: "BIGINT", isPrimary: true, isNullable: false },
        { name: "codigo", type: "VARCHAR(20)", isPrimary: false, isNullable: false, comment: "Código digitado no checkout" },
      ],
    },
  ]).next;

  it("guarda comentário de tabela e coluna no createTable (com trim)", () => {
    const node = base.nodes[0];
    expect(node.comment).toBe("Cupons de desconto aplicáveis a pedidos");
    expect(node.columns.find((c) => c.name === "codigo")?.comment).toBe("Código digitado no checkout");
    expect(node.columns.find((c) => c.name === "id")?.comment).toBeUndefined();
  });

  it("setComment define e remove comentário de tabela e coluna", () => {
    const { next, warnings } = applySchemaOps(base, [
      { op: "setComment", table: "cupons", comment: "" },
      { op: "setComment", table: "cupons", column: "id", comment: "Identificador interno" },
    ]);
    expect(warnings).toEqual([]);
    expect(next.nodes[0].comment).toBeUndefined();
    expect(next.nodes[0].columns.find((c) => c.name === "id")?.comment).toBe("Identificador interno");
  });

  it("setComment em coluna inexistente vira warning", () => {
    const { warnings } = applySchemaOps(base, [{ op: "setComment", table: "cupons", column: "nada", comment: "x" }]);
    expect(warnings).toHaveLength(1);
  });

  it("alterColumn só com comment é uma alteração válida", () => {
    const { next, warnings } = applySchemaOps(base, [
      { op: "alterColumn", table: "cupons", column: "codigo", comment: "Novo texto" },
    ]);
    expect(warnings).toEqual([]);
    expect(next.nodes[0].columns.find((c) => c.name === "codigo")?.comment).toBe("Novo texto");
  });

  it("normaliza 'description' e aliases de op vindos da LLM", () => {
    const parsed = parseSchemaOpsResponse({
      reply: "ok",
      operations: [
        { op: "addComment", table: "cupons", description: "Tabela de cupons" },
        { op: "createTable", table: "x", columns: [{ name: "id", type: "BIGINT", description: "pk" }] },
      ],
    });
    expect(parsed.skippedCount).toBe(0);
    expect(parsed.operations[0]).toMatchObject({ op: "setComment", comment: "Tabela de cupons" });
    expect(parsed.operations[1]).toMatchObject({ op: "createTable", columns: [{ comment: "pk" }] });
  });

  it("mudança de comentário marca a tabela como alterada no diff", () => {
    const { next } = applySchemaOps(base, [{ op: "setComment", table: "cupons", column: "codigo", comment: "Outro" }]);
    expect(computeDiagramDiff(base, next).get("cupons")).toBe("altered");
    const detailed = computeDetailedDiagramDiff(base, next).get("cupons");
    expect(detailed?.columns.get("codigo")?.changes).toContain("comentário alterado");
  });
});

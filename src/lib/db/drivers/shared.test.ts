import { describe, expect, it } from "vitest";

import { assertReadOnlyQuery, buildDiagramFromIntrospection, normalizeSql } from "@/lib/db/drivers/shared";
import type { IntrospectionResult } from "@/lib/db/drivers/types";

function introspection(overrides: Partial<IntrospectionResult> = {}): IntrospectionResult {
  return { tables: [], columns: [], foreignKeys: [], ...overrides };
}

describe("buildDiagramFromIntrospection", () => {
  it("propaga comentários do catálogo para tabela e colunas (vazio = sem comentário)", () => {
    const diagram = buildDiagramFromIntrospection(
      introspection({
        tables: [{ tableName: "clientes", tableSchema: "public", comment: " Cadastro de clientes " }],
        columns: [
          { tableName: "clientes", columnName: "id", columnType: "integer", isNullable: false, isPrimary: true, comment: "" },
          { tableName: "clientes", columnName: "cpf", columnType: "char(11)", isNullable: true, isPrimary: false, comment: "CPF sem máscara" },
        ],
      }),
      "public"
    );
    expect(diagram.nodes[0].comment).toBe("Cadastro de clientes");
    expect(diagram.nodes[0].columns[0].comment).toBeUndefined();
    expect(diagram.nodes[0].columns[1].comment).toBe("CPF sem máscara");
  });

  it("monta nós com colunas na ordem recebida e marca a PK", () => {
    const diagram = buildDiagramFromIntrospection(
      introspection({
        tables: [{ tableName: "clientes", tableSchema: "public" }],
        columns: [
          { tableName: "clientes", columnName: "id", columnType: "integer", isNullable: false, isPrimary: true },
          { tableName: "clientes", columnName: "nome", columnType: "varchar(50)", isNullable: true, isPrimary: false },
        ],
      }),
      "public"
    );

    expect(diagram.nodes).toHaveLength(1);
    expect(diagram.nodes[0].columns.map((c) => c.name)).toEqual(["id", "nome"]);
    expect(diagram.nodes[0].columns[0].isPrimary).toBe(true);
    expect(diagram.nodes[0].columns[1].type).toBe("varchar(50)");
  });

  it("agrupa FK composta em uma única aresta preservando o pareamento das colunas", () => {
    const diagram = buildDiagramFromIntrospection(
      introspection({
        tables: [
          { tableName: "itens", tableSchema: "public" },
          { tableName: "pedidos", tableSchema: "public" },
        ],
        columns: [
          { tableName: "itens", columnName: "pedido_ano", columnType: "integer", isNullable: false, isPrimary: false },
          { tableName: "itens", columnName: "pedido_num", columnType: "integer", isNullable: false, isPrimary: false },
        ],
        foreignKeys: [
          {
            constraintName: "fk_itens_pedidos",
            tableName: "itens",
            columnName: "pedido_ano",
            referencedTable: "pedidos",
            referencedColumn: "ano",
            updateRule: "CASCADE",
            deleteRule: "RESTRICT",
          },
          {
            constraintName: "fk_itens_pedidos",
            tableName: "itens",
            columnName: "pedido_num",
            referencedTable: "pedidos",
            referencedColumn: "numero",
            updateRule: "CASCADE",
            deleteRule: "RESTRICT",
          },
        ],
      }),
      "public"
    );

    expect(diagram.edges).toHaveLength(1);
    expect(diagram.edges[0].columns).toEqual([
      { source: "pedido_ano", target: "ano" },
      { source: "pedido_num", target: "numero" },
    ]);
    expect(diagram.edges[0].onDelete).toBe("RESTRICT");
    expect(diagram.edges[0].onUpdate).toBe("CASCADE");
  });

  it("não funde constraints de mesmo nome em tabelas diferentes", () => {
    const diagram = buildDiagramFromIntrospection(
      introspection({
        tables: [
          { tableName: "pedidos", tableSchema: "public" },
          { tableName: "faturas", tableSchema: "public" },
        ],
        foreignKeys: [
          {
            constraintName: "fk_cliente",
            tableName: "pedidos",
            columnName: "cliente_id",
            referencedTable: "clientes",
            referencedColumn: "id",
          },
          {
            constraintName: "fk_cliente",
            tableName: "faturas",
            columnName: "cliente_id",
            referencedTable: "clientes",
            referencedColumn: "id",
          },
        ],
      }),
      "public"
    );

    expect(diagram.edges).toHaveLength(2);
  });

  it("marca a coluna de origem como FK com a referência", () => {
    const diagram = buildDiagramFromIntrospection(
      introspection({
        tables: [{ tableName: "pedidos", tableSchema: "public" }],
        columns: [
          { tableName: "pedidos", columnName: "cliente_id", columnType: "integer", isNullable: false, isPrimary: false },
        ],
        foreignKeys: [
          {
            constraintName: "fk_cliente",
            tableName: "pedidos",
            columnName: "cliente_id",
            referencedTable: "clientes",
            referencedColumn: "id",
          },
        ],
      }),
      "public"
    );

    const coluna = diagram.nodes[0].columns[0];
    expect(coluna.isForeign).toBe(true);
    expect(coluna.references).toEqual({ table: "clientes", column: "id" });
  });

  it("agrupa escopos por prefixo e conta as tabelas", () => {
    const diagram = buildDiagramFromIntrospection(
      introspection({
        tables: [
          { tableName: "auth_users", tableSchema: "public" },
          { tableName: "auth_roles", tableSchema: "public" },
          { tableName: "faturas", tableSchema: "public" },
        ],
      }),
      "public"
    );

    const auth = diagram.scopes.find((s) => s.id === "auth");
    expect(auth?.tables).toBe(2);
    // Prefixo "faturas" tem mais de 3 chars, então vira escopo próprio.
    expect(diagram.scopes.map((s) => s.id)).toContain("faturas");
  });
});

describe("guard de consulta read-only", () => {
  it("aceita as formas de leitura de ambos os dialetos", () => {
    for (const sql of ["SELECT 1", "with x as (select 1) select * from x", "SHOW TABLES", "EXPLAIN SELECT 1"]) {
      expect(() => assertReadOnlyQuery(normalizeSql(sql))).not.toThrow();
    }
  });

  it("recusa escrita e comandos administrativos", () => {
    for (const sql of ["DELETE FROM users", "UPDATE users SET a = 1", "VACUUM", "COPY t FROM '/tmp/x'"]) {
      expect(() => assertReadOnlyQuery(normalizeSql(sql))).toThrow();
    }
  });

  it("recusa múltiplos statements mas tolera ponto e vírgula final", () => {
    expect(() => normalizeSql("SELECT 1; DROP TABLE users")).toThrow();
    expect(normalizeSql("SELECT 1;")).toBe("SELECT 1");
  });

  it("permite palavras como 'delete' e ponto-e-vírgula dentro de literais de string", () => {
    expect(() => assertReadOnlyQuery(normalizeSql("SELECT * FROM audit WHERE action = 'delete'"))).not.toThrow();
    expect(() => assertReadOnlyQuery(normalizeSql("SELECT * FROM logs WHERE message = 'step 1; step 2'"))).not.toThrow();
    expect(() => assertReadOnlyQuery(normalizeSql("SELECT REPLACE(name, 'a', 'b') FROM users"))).not.toThrow();
  });
});

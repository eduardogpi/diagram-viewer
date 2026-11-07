import { describe, expect, it } from "vitest";

import {
  generateDdl,
  generateDeltaDdl,
  inferMigrationSlug,
  mapType,
  sortTablesByDependency,
} from "@/lib/services/ddl-generator";
import { parseMigrations } from "@/lib/services/migration-parser";
import { applySchemaOps, type SchemaOp } from "@/lib/services/schema-ops";
import type { DiagramEdgeDTO, DiagramNodeDTO, DiagramResponse } from "@/lib/types/diagram";

function node(id: string, columns: Array<Partial<DiagramNodeDTO["columns"][number]> & { name: string }>): DiagramNodeDTO {
  return {
    id,
    label: id,
    schema: "public",
    scope: "app",
    columns: columns.map((c) => ({
      name: c.name,
      type: c.type ?? "BIGINT",
      isNullable: c.isNullable ?? false,
      isPrimary: c.isPrimary ?? false,
      isForeign: c.isForeign ?? false,
    })),
  };
}

function edge(source: string, target: string, column: string, extra: Partial<DiagramEdgeDTO> = {}): DiagramEdgeDTO {
  return {
    id: `${source}-${target}-${column}`,
    source,
    target,
    scope: "app",
    constraint: `fk_${source}_${column}`,
    columns: [{ source: column, target: "id" }],
    ...extra,
  };
}

const CLIENTES_PEDIDOS: DiagramResponse = {
  nodes: [
    node("pedidos", [
      { name: "id", isPrimary: true },
      { name: "cliente_id", isForeign: true },
      { name: "valor", type: "DECIMAL(10,2)", isNullable: true },
    ]),
    node("clientes", [
      { name: "id", isPrimary: true },
      { name: "email", type: "VARCHAR(255)" },
    ]),
  ],
  edges: [edge("pedidos", "clientes", "cliente_id", { onDelete: "CASCADE" })],
  scopes: [],
};

describe("mapType", () => {
  it("traduz tipos que divergem entre os bancos", () => {
    expect(mapType("JSONB", "mysql")).toBe("JSON");
    expect(mapType("BLOB", "postgres")).toBe("BYTEA");
    expect(mapType("DATETIME", "postgres")).toBe("TIMESTAMP");
    expect(mapType("TINYINT(1)", "postgres")).toBe("BOOLEAN");
  });

  it("preserva precisão de tipos comuns", () => {
    expect(mapType("VARCHAR(30)", "mysql")).toBe("VARCHAR(30)");
    expect(mapType("DECIMAL(10,2)", "postgres")).toBe("DECIMAL(10,2)");
  });

  it("deixa passar tipos que já são portáveis", () => {
    expect(mapType("BIGINT", "mysql")).toBe("BIGINT");
    expect(mapType("TIMESTAMP", "postgres")).toBe("TIMESTAMP");
  });
});

describe("sortTablesByDependency", () => {
  it("cria a tabela referenciada antes de quem aponta para ela", () => {
    const { ordered, deferred } = sortTablesByDependency(CLIENTES_PEDIDOS.nodes, CLIENTES_PEDIDOS.edges);
    expect(ordered.map((n) => n.id)).toEqual(["clientes", "pedidos"]);
    expect(deferred).toEqual([]);
  });

  it("adia as FKs que fecham um ciclo", () => {
    const nodes = [node("a", [{ name: "id", isPrimary: true }, { name: "b_id" }]), node("b", [{ name: "id", isPrimary: true }, { name: "a_id" }])];
    const edges = [edge("a", "b", "b_id"), edge("b", "a", "a_id")];

    const { ordered, deferred } = sortTablesByDependency(nodes, edges);

    expect(ordered).toHaveLength(2);
    expect(deferred.length).toBeGreaterThan(0);
  });

  it("não trava com auto-referência", () => {
    const nodes = [node("funcionarios", [{ name: "id", isPrimary: true }, { name: "chefe_id", isNullable: true }])];
    const { ordered, deferred } = sortTablesByDependency(nodes, [edge("funcionarios", "funcionarios", "chefe_id")]);
    expect(ordered).toHaveLength(1);
    expect(deferred).toEqual([]);
  });
});

describe("generateDdl", () => {
  it("gera MySQL com backticks, ordem de dependência e FK inline", () => {
    const sql = generateDdl(CLIENTES_PEDIDOS, { dialect: "mysql", databaseName: "loja" });

    expect(sql).toContain("CREATE DATABASE IF NOT EXISTS `loja`;");
    expect(sql).toContain("USE `loja`;");
    expect(sql.indexOf("CREATE TABLE `clientes`")).toBeLessThan(sql.indexOf("CREATE TABLE `pedidos`"));
    expect(sql).toContain("`valor` DECIMAL(10,2)");
    expect(sql).toContain("PRIMARY KEY (`id`)");
    expect(sql).toContain("FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON DELETE CASCADE");
  });

  it("gera Postgres com aspas duplas e schema em vez de USE", () => {
    const sql = generateDdl(CLIENTES_PEDIDOS, { dialect: "postgres", databaseName: "loja" });

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "loja";');
    expect(sql).toContain('SET search_path TO "loja";');
    expect(sql).not.toContain("USE ");
    expect(sql).toContain('CREATE TABLE "clientes"');
  });

  it("marca NOT NULL só onde o modelo pede", () => {
    const sql = generateDdl(CLIENTES_PEDIDOS, { dialect: "mysql" });
    expect(sql).toMatch(/`email` VARCHAR\(255\) NOT NULL/);
    expect(sql).toMatch(/`valor` DECIMAL\(10,2\)(?!.*NOT NULL)/);
  });

  it("suporta chave primária composta", () => {
    const diagram: DiagramResponse = {
      nodes: [node("pedido_itens", [{ name: "pedido_id", isPrimary: true }, { name: "produto_id", isPrimary: true }])],
      edges: [],
      scopes: [],
    };
    expect(generateDdl(diagram, { dialect: "mysql" })).toContain("PRIMARY KEY (`pedido_id`, `produto_id`)");
  });

  it("desqualifica tabelas homônimas de escopos diferentes", () => {
    const diagram: DiagramResponse = {
      nodes: [
        { ...node("projeto-a.users", [{ name: "id", isPrimary: true }]), label: "users", scope: "projeto-a" },
        { ...node("projeto-b.users", [{ name: "id", isPrimary: true }]), label: "users", scope: "projeto-b" },
      ],
      edges: [],
      scopes: [],
    };

    const sql = generateDdl(diagram, { dialect: "mysql" });
    expect(sql).toContain("CREATE TABLE `projeto-a_users`");
    expect(sql).toContain("CREATE TABLE `projeto-b_users`");
  });

  it("emite ALTER TABLE para FKs cíclicas", () => {
    const diagram: DiagramResponse = {
      nodes: [node("a", [{ name: "id", isPrimary: true }, { name: "b_id" }]), node("b", [{ name: "id", isPrimary: true }, { name: "a_id" }])],
      edges: [edge("a", "b", "b_id"), edge("b", "a", "a_id")],
      scopes: [],
    };

    const sql = generateDdl(diagram, { dialect: "postgres" });
    expect(sql).toContain("ALTER TABLE");
    expect(sql).toContain("ADD CONSTRAINT");
  });

  it("avisa quando o modelo está vazio", () => {
    expect(generateDdl({ nodes: [], edges: [], scopes: [] }, { dialect: "mysql" })).toContain("Modelo vazio");
  });

  it("roundtrip: o SQL gerado é relido pelo parser com as mesmas tabelas e FKs", () => {
    const sql = generateDdl(CLIENTES_PEDIDOS, { dialect: "mysql" });
    const parsed = parseMigrations([{ name: "V1__export.sql", content: sql }]);

    expect(parsed.finalDiagram.nodes.map((n) => n.label).sort()).toEqual(["clientes", "pedidos"]);
    expect(parsed.finalDiagram.edges).toHaveLength(1);
    expect(parsed.finalDiagram.edges[0].source).toContain("pedidos");
    expect(parsed.finalDiagram.edges[0].target).toContain("clientes");
  });
});

describe("generateDeltaDdl & inferMigrationSlug", () => {
  const deltaOps: SchemaOp[] = [
    {
      op: "addColumn",
      table: "clientes",
      newColumn: { name: "cpf", type: "VARCHAR(11)", isPrimary: false, isNullable: false },
    },
    {
      op: "alterColumn",
      table: "pedidos",
      column: "valor",
      type: "DECIMAL(12,2)",
      isNullable: false,
    },
    {
      op: "createTable",
      table: "pagamentos",
      columns: [
        { name: "id", type: "BIGINT", isPrimary: true, isNullable: false },
        { name: "pedido_id", type: "BIGINT", isPrimary: false, isNullable: false },
      ],
    },
    {
      op: "addForeignKey",
      table: "pagamentos",
      column: "pedido_id",
      referencesTable: "pedidos",
      referencesColumn: "id",
      onDelete: "CASCADE",
    },
  ];

  it("gera ALTER TABLE e CREATE TABLE incrementais para MySQL e faz roundtrip com o parser", () => {
    const v1 = generateDdl(CLIENTES_PEDIDOS, { dialect: "mysql" });
    const v2 = generateDeltaDdl(deltaOps, { dialect: "mysql", baseDiagram: CLIENTES_PEDIDOS });

    expect(v2).toContain("ALTER TABLE `clientes` ADD COLUMN `cpf` VARCHAR(11) NOT NULL;");
    expect(v2).toContain("ALTER TABLE `pedidos` MODIFY COLUMN `valor` DECIMAL(12,2) NOT NULL;");
    expect(v2).toContain("CREATE TABLE `pagamentos`");
    expect(v2).toContain("ALTER TABLE `pagamentos` ADD CONSTRAINT `fk_pagamentos_pedido_id`");

    const parsed = parseMigrations([
      { name: "V1__base.sql", content: v1 },
      { name: "V2__delta.sql", content: v2 },
    ]);
    const expected = applySchemaOps(CLIENTES_PEDIDOS, deltaOps).next;

    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.finalDiagram.nodes.map((n) => n.label).sort()).toEqual(
      expected.nodes.map((n) => n.label).sort()
    );
    expect(parsed.finalDiagram.edges).toHaveLength(expected.edges.length);
    const pedidos = parsed.finalDiagram.nodes.find((n) => n.label === "pedidos")!;
    expect(pedidos.columns.find((c) => c.name === "valor")).toMatchObject({
      type: "DECIMAL(12,2)",
      isNullable: false,
    });
  });

  it("gera ALTER COLUMN (TYPE + SET NOT NULL) para PostgreSQL e faz roundtrip com o parser", () => {
    const v1 = generateDdl(CLIENTES_PEDIDOS, { dialect: "postgres" });
    const v2 = generateDeltaDdl(deltaOps, { dialect: "postgres", baseDiagram: CLIENTES_PEDIDOS });

    expect(v2).toContain('ALTER TABLE "pedidos" ALTER COLUMN "valor" TYPE DECIMAL(12,2);');
    expect(v2).toContain('ALTER TABLE "pedidos" ALTER COLUMN "valor" SET NOT NULL;');

    const parsed = parseMigrations([
      { name: "V1__base.sql", content: v1 },
      { name: "V2__delta.sql", content: v2 },
    ]);
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.finalDiagram.nodes.map((n) => n.label).sort()).toEqual([
      "clientes",
      "pagamentos",
      "pedidos",
    ]);
    expect(parsed.finalDiagram.edges).toHaveLength(2);
  });

  it("gera slugs descritivos para nomes de arquivos Flyway", () => {
    expect(
      inferMigrationSlug([
        {
          op: "addColumn",
          table: "clientes",
          newColumn: { name: "cpf", type: "VARCHAR(11)", isPrimary: false, isNullable: true },
        },
      ])
    ).toBe("add_cpf_to_clientes");
    expect(inferMigrationSlug(deltaOps)).toBe("update_clientes_pedidos_pagamentos");
  });
});

describe("comentários no DDL", () => {
  const documented: DiagramResponse = {
    nodes: [
      {
        id: "cupons",
        label: "cupons",
        schema: "public",
        scope: "app",
        comment: "Cupons d'o checkout",
        columns: [
          { name: "id", type: "BIGINT", isNullable: false, isPrimary: true, isForeign: false },
          { name: "codigo", type: "VARCHAR(20)", isNullable: false, isPrimary: false, isForeign: false, comment: "Código \\ digitado" },
        ],
      },
    ],
    edges: [],
    scopes: [],
  };

  it("MySQL: COMMENT inline na coluna e COMMENT= na tabela, com escape", () => {
    const sql = generateDdl(documented, { dialect: "mysql" });
    expect(sql).toContain("`codigo` VARCHAR(20) NOT NULL COMMENT 'Código \\\\ digitado'");
    expect(sql).toContain(") COMMENT='Cupons d''o checkout';");
  });

  it("Postgres: COMMENT ON TABLE/COLUMN após o CREATE TABLE", () => {
    const sql = generateDdl(documented, { dialect: "postgres" });
    expect(sql).toContain(`COMMENT ON TABLE "cupons" IS 'Cupons d''o checkout';`);
    expect(sql).toContain(`COMMENT ON COLUMN "cupons"."codigo" IS 'Código \\ digitado';`);
    expect(sql).not.toContain("COMMENT=");
  });

  it("delta: setComment e alterColumn preservam/emitem comentário por dialeto", () => {
    const ops: SchemaOp[] = [
      { op: "setComment", table: "cupons", comment: "" },
      { op: "setComment", table: "cupons", column: "id", comment: "PK" },
      { op: "alterColumn", table: "cupons", column: "codigo", type: "VARCHAR(40)" },
    ];
    const pg = generateDeltaDdl(ops, { dialect: "postgres", baseDiagram: documented });
    expect(pg).toContain(`COMMENT ON TABLE "cupons" IS NULL;`);
    expect(pg).toContain(`COMMENT ON COLUMN "cupons"."id" IS 'PK';`);

    const my = generateDeltaDdl(ops, { dialect: "mysql", baseDiagram: documented });
    expect(my).toContain("ALTER TABLE `cupons` COMMENT = '';");
    expect(my).toContain("MODIFY COLUMN `id` BIGINT NOT NULL COMMENT 'PK';");
    // MODIFY COLUMN sem COMMENT apagaria a documentação existente no MySQL.
    expect(my).toContain("MODIFY COLUMN `codigo` VARCHAR(40) NOT NULL COMMENT 'Código \\\\ digitado';");
  });
});

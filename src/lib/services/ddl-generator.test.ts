import { describe, expect, it } from "vitest";

import { generateDdl, mapType, sortTablesByDependency } from "@/lib/services/ddl-generator";
import { parseMigrations } from "@/lib/services/migration-parser";
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

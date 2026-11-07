import { describe, expect, it } from "vitest";

import {
  buildCytoscapeElements,
  findShortestJoinPath,
  scopeParentId,
  type CyRelationshipInput,
  type CyTableNodeInput,
} from "@/lib/cytoscape-graph";

const SAMPLE_NODES: CyTableNodeInput[] = [
  {
    id: "core.clientes",
    label: "clientes",
    schema: "core",
    scope: "core",
    columns: [
      { name: "id", type: "BIGINT", isPrimary: true, isForeign: false },
      { name: "cpf", type: "VARCHAR(14)", isPrimary: false, isForeign: false, isUnique: true },
      { name: "nome", type: "VARCHAR(120)", isPrimary: false, isForeign: false },
    ],
  },
  {
    id: "vendas.pedidos",
    label: "pedidos",
    schema: "vendas",
    scope: "vendas",
    columns: [
      { name: "id", type: "BIGINT", isPrimary: true, isForeign: false },
      { name: "cliente_id", type: "BIGINT", isPrimary: false, isForeign: true },
    ],
  },
  {
    id: "vendas.itens_pedido",
    label: "itens_pedido",
    schema: "vendas",
    scope: "vendas",
    columns: [
      { name: "id", type: "BIGINT", isPrimary: true, isForeign: false },
      { name: "pedido_id", type: "BIGINT", isPrimary: false, isForeign: true },
      { name: "produto_id", type: "BIGINT", isPrimary: false, isForeign: true },
    ],
  },
  {
    id: "catalogo.produtos",
    label: "produtos",
    schema: "catalogo",
    scope: "catalogo",
    columns: [
      { name: "id", type: "BIGINT", isPrimary: true, isForeign: false },
      { name: "sku", type: "VARCHAR(40)", isPrimary: false, isForeign: false, isUnique: true },
    ],
  },
];

const SAMPLE_EDGES: CyRelationshipInput[] = [
  {
    id: "fk_pedidos_cliente",
    source: "vendas.pedidos",
    target: "core.clientes",
    scope: "vendas",
    constraint: "fk_pedidos_cliente",
    columns: [{ source: "cliente_id", target: "id" }],
    cardinality: "N:1",
  },
  {
    id: "fk_itens_pedido",
    source: "vendas.itens_pedido",
    target: "vendas.pedidos",
    scope: "vendas",
    constraint: "fk_itens_pedido",
    columns: [{ source: "pedido_id", target: "id" }],
    cardinality: "N:1",
  },
  {
    id: "fk_itens_produto",
    source: "vendas.itens_pedido",
    target: "catalogo.produtos",
    scope: "vendas",
    constraint: "fk_itens_produto",
    columns: [{ source: "produto_id", target: "id" }],
    cardinality: "N:1",
  },
];

describe("cytoscape-graph / buildCytoscapeElements", () => {
  it("gera nós compostos por escopo, calcula grau de conexão e destaca status de diff", () => {
    const diffMap = new Map<string, "added" | "altered" | "removed">([
      ["vendas.pedidos", "altered"],
      ["catalogo.produtos", "added"],
    ]);

    const elements = buildCytoscapeElements({
      nodes: SAMPLE_NODES,
      edges: SAMPLE_EDGES,
      diffMap,
      sizingMode: "degree",
    });

    const scopeNodes = elements.filter((el) => el.group === "nodes" && el.data.isScope);
    expect(scopeNodes.map((s) => s.data.id)).toEqual([
      scopeParentId("core"),
      scopeParentId("vendas"),
      scopeParentId("catalogo"),
    ]);

    const pedidosNode = elements.find((el) => el.data.id === "vendas.pedidos")!;
    expect(pedidosNode.data.parent).toBe(scopeParentId("vendas"));
    expect(pedidosNode.data.degree).toBe(2);
    expect(pedidosNode.data.inDegree).toBe(1);
    expect(pedidosNode.data.outDegree).toBe(1);
    expect(pedidosNode.data.diffStatus).toBe("altered");
    expect(pedidosNode.classes).toContain("diff-altered");

    const crossEdge = elements.find((el) => el.data.id === "fk_pedidos_cliente")!;
    expect(crossEdge.data.crossScope).toBe(true);
    expect(crossEdge.classes).toContain("cy-edge-cross");

    const internalEdge = elements.find((el) => el.data.id === "fk_itens_pedido")!;
    expect(internalEdge.data.crossScope).toBe(false);
  });
});

describe("cytoscape-graph / findShortestJoinPath", () => {
  it("encontra o menor caminho de JOIN entre duas tabelas distantes e gera o SQL", () => {
    const path = findShortestJoinPath(
      SAMPLE_NODES,
      SAMPLE_EDGES,
      "core.clientes",
      "catalogo.produtos"
    );

    expect(path.found).toBe(true);
    expect(path.nodeIds).toEqual([
      "core.clientes",
      "vendas.pedidos",
      "vendas.itens_pedido",
      "catalogo.produtos",
    ]);
    expect(path.edgeIds).toEqual(["fk_pedidos_cliente", "fk_itens_pedido", "fk_itens_produto"]);
    expect(path.steps).toHaveLength(3);
    expect(path.sql).toContain("FROM clientes t0");
    expect(path.sql).toContain("JOIN pedidos t1 ON t1.cliente_id = t0.id");
    expect(path.sql).toContain("JOIN itens_pedido t2 ON t2.pedido_id = t1.id");
    expect(path.sql).toContain("JOIN produtos t3 ON t2.produto_id = t3.id");
  });
});

describe("buildCytoscapeElements / comentários", () => {
  it("marca a tabela documentada com um ícone e guarda o texto completo para o tooltip", () => {
    const long = "Cadastro central de clientes pessoa física e jurídica usado por vendas e cobrança";
    const elements = buildCytoscapeElements({
      nodes: [
        {
          ...SAMPLE_NODES[0],
          comment: long,
          columns: SAMPLE_NODES[0].columns.map((c) => (c.name === "cpf" ? { ...c, comment: "CPF sem máscara" } : c)),
        },
      ],
      edges: [],
    });
    const node = elements.find((e) => e.data.id === "core.clientes")!;
    const lines = node.data.label.split("\n");
    expect(lines[0]).toBe("clientes  ⓘ");
    expect(lines[1]).toMatch(/^\d+ col/);
    expect(node.data.label).not.toContain("Cadastro");
    expect(node.data.comment).toBe(long);
    expect(node.data.documentedColumns).toBe(1);
  });

  it("só colunas documentadas também mostram o ícone", () => {
    const elements = buildCytoscapeElements({
      nodes: [{ ...SAMPLE_NODES[0], columns: [{ ...SAMPLE_NODES[0].columns[0], comment: "PK" }] }],
      edges: [],
    });
    expect(elements.find((e) => e.data.id === "core.clientes")!.data.label.split("\n")[0]).toBe("clientes  ⓘ");
  });

  it("sem comentário, o rótulo fica como antes", () => {
    const elements = buildCytoscapeElements({ nodes: [SAMPLE_NODES[0]], edges: [] });
    const node = elements.find((e) => e.data.id === "core.clientes")!;
    expect(node.data.label.split("\n")[0]).toBe("clientes");
    expect(node.data.comment).toBeUndefined();
  });
});

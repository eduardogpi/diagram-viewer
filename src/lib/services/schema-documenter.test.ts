import { describe, expect, it } from "vitest";

import { documentationCoverage } from "@/lib/schema-documentation";
import {
  buildDocumentationPrompt,
  parseDocumentationReply,
  planDocumentationBatches,
} from "@/lib/services/schema-documenter";
import type { DiagramResponse } from "@/lib/types/diagram";

function table(id: string, opts: { comment?: string; columns?: Array<{ name: string; comment?: string }> } = {}) {
  return {
    id,
    label: id,
    schema: "public",
    scope: "app",
    ...(opts.comment ? { comment: opts.comment } : {}),
    columns: (opts.columns ?? [{ name: "id" }, { name: "status" }]).map((c) => ({
      name: c.name,
      type: "VARCHAR(20)",
      isNullable: true,
      isPrimary: c.name === "id",
      isForeign: false,
      ...(c.comment ? { comment: c.comment } : {}),
    })),
  };
}

const diagram: DiagramResponse = {
  nodes: [
    table("pedidos"),
    table("clientes", { comment: "Cadastro", columns: [{ name: "id" }, { name: "cpf", comment: "CPF" }] }),
    table("cupons", { comment: "Cupons" }),
  ],
  edges: [],
  scopes: [],
};

describe("cobertura de documentação", () => {
  it("ignora tabelas totalmente documentadas e colunas autoexplicativas", () => {
    const coverage = documentationCoverage(diagram);
    expect(coverage.documentedTables).toBe(2);
    expect(coverage.gaps).toEqual([
      { table: "pedidos", missingTableComment: true, missingColumns: ["status"] },
      { table: "cupons", missingTableComment: false, missingColumns: ["status"] },
    ]);
  });

  it("divide em lotes, respeita o teto e o filtro de tabelas", () => {
    const plan = planDocumentationBatches(diagram, { batchSize: 1, maxTables: 1 });
    expect(plan.batches).toHaveLength(1);
    expect(plan.remaining).toBe(1);
    expect(planDocumentationBatches(diagram, { tables: ["CUPONS"] }).batches[0].gaps.map((g) => g.table)).toEqual([
      "cupons",
    ]);
  });

  it("o prompt só pede o que falta", () => {
    const { batches } = planDocumentationBatches(diagram);
    const prompt = buildDocumentationPrompt(diagram, batches[0]);
    expect(prompt).toContain("- tabela pedidos");
    expect(prompt).toContain("- coluna cupons.status");
    expect(prompt).not.toContain("- tabela cupons");
    expect(prompt).toContain("clientes — Cadastro");
  });
});

describe("parseDocumentationReply", () => {
  const { batches } = planDocumentationBatches(diagram);

  it("converte em setComment e descarta alvos não pedidos, duplicados e vazios", () => {
    const reply = "```json\n" + JSON.stringify({
      comments: [
        { table: "pedidos", comment: "Pedidos de compra" },
        { table: "pedidos", comment: "duplicado" },
        { table: "PEDIDOS", column: "STATUS", comment: "Situação do pedido" },
        { table: "cupons", comment: "não pedido (já tem)" },
        { table: "cupons", column: "status", comment: "  " },
        { table: "clientes", column: "cpf", comment: "não pedido" },
        { table: "inexistente", comment: "x" },
      ],
    }) + "\n```";
    expect(parseDocumentationReply(reply, batches[0])).toEqual([
      { op: "setComment", table: "pedidos", comment: "Pedidos de compra" },
      { op: "setComment", table: "pedidos", column: "status", comment: "Situação do pedido" },
    ]);
  });

  it("aproveita resposta truncada e ignora lixo", () => {
    const truncated = '{"comments": [{"table": "pedidos", "comment": "Pedidos"}, {"table": "cupons", "col';
    expect(parseDocumentationReply(truncated, batches[0])).toEqual([
      { op: "setComment", table: "pedidos", comment: "Pedidos" },
    ]);
    expect(parseDocumentationReply("desculpe, não sei", batches[0])).toEqual([]);
  });
});

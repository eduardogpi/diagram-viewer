import { describe, expect, it } from "vitest";

import { memoriesBlock } from "@/lib/services/llm/shared";
import { isMemoryConfigured, memoryNamespace, summarizeOperations } from "@/lib/services/memory";
import type { SchemaOp } from "@/lib/services/schema-ops";

describe("isolamento dos testes", () => {
  it("nunca considera a memória configurada dentro do vitest", () => {
    // Regressão: o .env chega aos testes pelo Prisma, e sem este guard os testes de turno
    // gravavam memória real no MCP do usuário. Vale mesmo com a URL configurada no ambiente.
    expect(isMemoryConfigured()).toBe(false);
  });
});

describe("memoryNamespace", () => {
  it("deriva o projeto da conexão quando não há override", () => {
    expect(memoryNamespace({ connectionId: "conn-1", ownerId: "user-1" })).toEqual({
      projectId: "workbench:conn-1",
      userId: "user-1",
    });
  });

  it("usa o projeto do CodeGraph quando a sessão aponta para um", () => {
    const ns = memoryNamespace({ connectionId: "conn-1", ownerId: "user-1", memoryProjectId: "meu-repo" });
    expect(ns.projectId).toBe("meu-repo");
  });

  it("trata projeto em branco como ausente", () => {
    const ns = memoryNamespace({ connectionId: "conn-1", ownerId: "user-1", memoryProjectId: "   " });
    expect(ns.projectId).toBe("workbench:conn-1");
  });
});

describe("summarizeOperations", () => {
  it("descreve criação de tabela com colunas", () => {
    const ops: SchemaOp[] = [
      {
        op: "createTable",
        table: "clientes",
        columns: [
          { name: "id", type: "INTEGER", isPrimary: true, isNullable: false },
          { name: "email", type: "VARCHAR(255)", isPrimary: false, isNullable: true },
        ],
      },
    ];
    expect(summarizeOperations(ops)).toBe(
      "criou a tabela clientes com as colunas id INTEGER, email VARCHAR(255)"
    );
  });

  it("junta várias operações em uma frase", () => {
    const ops: SchemaOp[] = [
      {
        op: "addColumn",
        table: "pedidos",
        newColumn: { name: "valor", type: "DECIMAL(10,2)", isPrimary: false, isNullable: true },
      },
      {
        op: "addForeignKey",
        table: "pedidos",
        column: "cliente_id",
        referencesTable: "clientes",
        referencesColumn: "id",
      },
    ];
    expect(summarizeOperations(ops)).toBe(
      "adicionou a coluna valor (DECIMAL(10,2)) em pedidos; ligou pedidos.cliente_id a clientes.id por foreign key"
    );
  });

  it("devolve vazio quando não há operações", () => {
    expect(summarizeOperations([])).toBe("");
  });
});

describe("memoriesBlock", () => {
  it("some do prompt quando não há memórias", () => {
    expect(memoriesBlock([])).toBeNull();
    expect(memoriesBlock(undefined)).toBeNull();
  });

  it("lista as memórias e mantém o modelo atual como fonte da verdade", () => {
    const block = memoriesBlock(["decidiu usar UUID como PK"]);
    expect(block).toContain("- decidiu usar UUID como PK");
    expect(block).toContain("fonte da verdade");
  });
});

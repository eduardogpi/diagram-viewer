import { describe, expect, it } from "vitest";

import { lintDiagram } from "@/lib/schema-linter";
import { generateDdl } from "@/lib/services/ddl-generator";
import { parseMigrations } from "@/lib/services/migration-parser";
import { computeSchemaDrift, normalizeSqlTypeForDrift } from "@/lib/services/schema-drift";
import type { DiagramResponse } from "@/lib/types/diagram";

describe("schema-linter / lintDiagram", () => {
  it("detecta tabela sem PK, FK com tipo incompatível, FK implícita e nomenclatura mista", () => {
    const diagram: DiagramResponse = {
      nodes: [
        {
          id: "clientes",
          label: "clientes",
          schema: "public",
          scope: "public",
          columns: [
            { name: "id", type: "BIGINT", isPrimary: true, isForeign: false, isNullable: false },
            { name: "nome_completo", type: "VARCHAR(120)", isPrimary: false, isForeign: false, isNullable: false },
            { name: "dataCadastro", type: "TIMESTAMP", isPrimary: false, isForeign: false, isNullable: true },
          ],
        },
        {
          id: "pedidos",
          label: "pedidos",
          schema: "public",
          scope: "public",
          columns: [
            {
              name: "cliente_id",
              type: "INT",
              isPrimary: false,
              isForeign: true,
              isNullable: false,
              references: { table: "clientes", column: "id" },
            },
          ],
        },
        {
          id: "auditoria_clientes",
          label: "auditoria_clientes",
          schema: "public",
          scope: "public",
          columns: [
            { name: "id", type: "BIGINT", isPrimary: true, isForeign: false, isNullable: false },
            { name: "cliente_id", type: "BIGINT", isPrimary: false, isForeign: false, isNullable: false },
          ],
        },
      ],
      edges: [],
      scopes: [],
    };

    const issues = lintDiagram(diagram);
    const codes = issues.map((i) => i.code);

    expect(codes).toContain("missing-pk");
    expect(codes).toContain("fk-type-mismatch");
    expect(codes).toContain("implicit-fk");
    expect(codes).toContain("mixed-naming");

    const mismatch = issues.find((i) => i.code === "fk-type-mismatch");
    expect(mismatch?.tableId).toBe("pedidos");
    expect(mismatch?.columnName).toBe("cliente_id");
    expect(mismatch?.suggestedPrompt).toContain("BIGINT");
  });
});

describe("schema-drift / computeSchemaDrift", () => {
  it("considera em sincronia quando tipos equivalentes de dialeto batem", () => {
    expect(normalizeSqlTypeForDrift("INTEGER")).toBe(normalizeSqlTypeForDrift("INT(11)"));
    expect(normalizeSqlTypeForDrift("CHARACTER VARYING(100)")).toBe(normalizeSqlTypeForDrift("VARCHAR(100)"));

    const expected: DiagramResponse = {
      nodes: [
        {
          id: "public.usuarios",
          label: "usuarios",
          schema: "public",
          scope: "public",
          columns: [
            { name: "id", type: "BIGSERIAL", isPrimary: true, isForeign: false, isNullable: false },
            { name: "email", type: "VARCHAR(150)", isPrimary: false, isForeign: false, isNullable: false },
          ],
        },
      ],
      edges: [],
      scopes: [],
    };

    const actual: DiagramResponse = {
      nodes: [
        {
          id: "usuarios",
          label: "usuarios",
          schema: "public",
          scope: "public",
          columns: [
            { name: "id", type: "bigint(20)", isPrimary: true, isForeign: false, isNullable: false },
            { name: "email", type: "character varying(150)", isPrimary: false, isForeign: false, isNullable: false },
          ],
        },
      ],
      edges: [],
      scopes: [],
    };

    const report = computeSchemaDrift(expected, actual);
    expect(report.inSync).toBe(true);
    expect(report.missingInActual).toEqual([]);
    expect(report.extraInActual).toEqual([]);
    expect(report.driftedTables).toEqual([]);
  });

  it("identifica tabelas ausentes, extras e colunas com drift no banco", () => {
    const expected: DiagramResponse = {
      nodes: [
        {
          id: "clientes",
          label: "clientes",
          schema: "public",
          scope: "public",
          columns: [
            { name: "id", type: "BIGINT", isPrimary: true, isForeign: false, isNullable: false },
            { name: "cpf", type: "VARCHAR(14)", isPrimary: false, isForeign: false, isNullable: false },
          ],
        },
        {
          id: "faturas",
          label: "faturas",
          schema: "public",
          scope: "public",
          columns: [{ name: "id", type: "BIGINT", isPrimary: true, isForeign: false, isNullable: false }],
        },
      ],
      edges: [],
      scopes: [],
    };

    const actual: DiagramResponse = {
      nodes: [
        {
          id: "clientes",
          label: "clientes",
          schema: "public",
          scope: "public",
          columns: [
            { name: "id", type: "BIGINT", isPrimary: true, isForeign: false, isNullable: false },
            { name: "cpf", type: "VARCHAR(11)", isPrimary: false, isForeign: false, isNullable: true },
            { name: "legacy_flag", type: "INT", isPrimary: false, isForeign: false, isNullable: true },
          ],
        },
        {
          id: "tabela_manual_dba",
          label: "tabela_manual_dba",
          schema: "public",
          scope: "public",
          columns: [{ name: "id", type: "INT", isPrimary: true, isForeign: false, isNullable: false }],
        },
      ],
      edges: [],
      scopes: [],
    };

    const report = computeSchemaDrift(expected, actual, "postgres");
    expect(report.inSync).toBe(false);
    expect(report.missingInActual).toEqual(["faturas"]);
    expect(report.extraInActual).toEqual(["tabela_manual_dba"]);
    expect(report.driftedTables).toHaveLength(1);
    expect(report.driftedTables[0].tableId).toBe("clientes");
    expect(report.driftedTables[0].columns.map((c) => c.name)).toEqual(["cpf", "legacy_flag"]);
    expect(report.reconcileSql).toContain('CREATE TABLE "faturas"');
    expect(report.reconcileSql).toContain('ALTER TABLE "clientes" ALTER COLUMN "cpf" TYPE VARCHAR(14);');
    expect(report.reconcileSql).toContain('ALTER TABLE "clientes" ALTER COLUMN "cpf" SET NOT NULL;');
    expect(report.reconcileSql).toContain('DROP TABLE "tabela_manual_dba";');
  });

  it("interpreta e exporta UNIQUE e CREATE/DROP INDEX no parser e no gerador DDL", () => {
    const parsed = parseMigrations([
      {
        name: "V1__init.sql",
        content: `
          CREATE TABLE usuarios (
            id BIGINT PRIMARY KEY,
            email VARCHAR(150) NOT NULL UNIQUE,
            documento VARCHAR(20) NOT NULL,
            UNIQUE KEY uq_usuarios_doc (documento)
          );
          CREATE INDEX idx_usuarios_email_doc ON usuarios (email, documento);
        `,
      },
      {
        name: "V2__drop_idx.sql",
        content: `
          DROP INDEX idx_usuarios_email_doc ON usuarios;
          CREATE UNIQUE INDEX uq_usuarios_email_doc ON usuarios (email, documento);
        `,
      },
    ]);

    const finalNode = parsed.finalDiagram.nodes.find((n) => n.label === "usuarios")!;
    expect(finalNode.columns.find((c) => c.name === "email")?.isUnique).toBe(true);
    expect(finalNode.columns.find((c) => c.name === "documento")?.isUnique).toBe(true);
    expect(finalNode.indexes?.map((i) => i.name)).toContain("uq_usuarios_doc");
    expect(finalNode.indexes?.map((i) => i.name)).toContain("uq_usuarios_email_doc");
    expect(finalNode.indexes?.map((i) => i.name)).not.toContain("idx_usuarios_email_doc");

    const ddl = generateDdl(parsed.finalDiagram, { dialect: "postgres" });
    expect(ddl).toContain('"email" VARCHAR(150) NOT NULL UNIQUE');
    expect(ddl).toContain('CREATE UNIQUE INDEX "uq_usuarios_email_doc" ON "usuarios" ("email", "documento");');
  });
});

import { describe, expect, it } from "vitest";

import { formatSql, toCsv } from "@/lib/sql/editor-utils";

describe("toCsv", () => {
  it("escapa vírgulas, aspas e nulos", () => {
    const csv = toCsv(["id", "nome"], [
      { id: 1, nome: 'Silva, "Jr"' },
      { id: 2, nome: null },
    ]);
    expect(csv.split("\n")).toEqual(["id,nome", '1,"Silva, ""Jr"""', "2,"]);
  });
});

describe("formatSql", () => {
  it("coloca cláusulas em linhas e mantém keywords em maiúsculas", () => {
    const formatted = formatSql("select id from clientes where id = 1");
    expect(formatted).toBe("SELECT id\nFROM clientes\nWHERE id = 1");
  });

  it("trata joins compostos como uma cláusula", () => {
    const formatted = formatSql("select * from a inner join b on a.id = b.id");
    expect(formatted).toContain("\nINNER JOIN b");
  });
});

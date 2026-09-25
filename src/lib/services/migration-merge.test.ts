import { describe, expect, it } from "vitest";

import {
  buildMigrationFiles,
  mergeMigrationFiles,
  migrationContentChecksum,
} from "@/lib/services/migration-parser";
import type { MigrationFileInput } from "@/lib/types/migrations";

/** Simula o que está gravado em `MigrationFile` (nome já canônico + checksum). */
function asStored(files: MigrationFileInput[]) {
  return buildMigrationFiles(files).map((file) => ({
    name: file.name,
    content: file.content,
    checksum: file.checksum,
  }));
}

const V1: MigrationFileInput = { name: "V1__init.sql", content: "CREATE TABLE a (id INT);" };
const V2: MigrationFileInput = { name: "V2__pets.sql", content: "CREATE TABLE b (id INT);" };
const V3: MigrationFileInput = { name: "V3__visits.sql", content: "CREATE TABLE c (id INT);" };

describe("mergeMigrationFiles", () => {
  it("reenviar o pacote inteiro anexa só o que falta", () => {
    const existing = asStored([V1, V2]);

    const result = mergeMigrationFiles(existing, [V1, V2, V3]);

    expect(result.added).toEqual(["V3__visits.sql"]);
    expect(result.skipped).toEqual(["V1__init.sql", "V2__pets.sql"]);
    expect(result.changed).toEqual([]);
    expect(result.files).toHaveLength(3);
  });

  it("reenviar exatamente o mesmo pacote não muda nada", () => {
    const existing = asStored([V1, V2]);

    const result = mergeMigrationFiles(existing, [V1, V2]);

    expect(result.added).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.files).toHaveLength(2);
  });

  it("ignora diferenças de espaçamento ao comparar conteúdo", () => {
    const existing = asStored([V1]);
    const reformatted: MigrationFileInput = {
      name: "V1__init.sql",
      content: "CREATE TABLE a (id INT);\n\n",
    };

    const result = mergeMigrationFiles(existing, [reformatted]);

    expect(result.skipped).toEqual(["V1__init.sql"]);
    expect(result.changed).toEqual([]);
  });

  it("sobrescreve e reporta migration já importada cujo conteúdo mudou", () => {
    const existing = asStored([V1, V2]);
    const editedV2: MigrationFileInput = {
      name: "V2__pets.sql",
      content: "CREATE TABLE b (id INT, nome VARCHAR(10));",
    };

    const result = mergeMigrationFiles(existing, [editedV2]);

    expect(result.changed).toEqual(["V2__pets.sql"]);
    expect(result.added).toEqual([]);
    expect(result.files).toHaveLength(2);
    expect(result.files.find((f) => f.name === "V2__pets.sql")?.content).toBe(editedV2.content);
  });

  it("distingue migrations de mesmo nome em módulos diferentes", () => {
    const coreV1: MigrationFileInput = {
      name: "V1__init.sql",
      path: "db/migration/core/V1__init.sql",
      content: "CREATE TABLE core_a (id INT);",
    };
    const billingV1: MigrationFileInput = {
      name: "V1__init.sql",
      path: "db/migration/billing/V1__init.sql",
      content: "CREATE TABLE billing_a (id INT);",
    };

    const existing = asStored([coreV1]);
    const result = mergeMigrationFiles(existing, [coreV1, billingV1]);

    expect(result.skipped).toEqual(["db/migration/core/V1__init.sql"]);
    expect(result.added).toEqual(["db/migration/billing/V1__init.sql"]);
    expect(result.files).toHaveLength(2);
  });

  it("mantém o nome canônico no roundtrip banco -> merge -> banco", () => {
    const withModule: MigrationFileInput = {
      name: "V1__init.sql",
      path: "db/migration/core/V1__init.sql",
      content: "CREATE TABLE a (id INT);",
    };

    const first = mergeMigrationFiles([], [withModule]);
    const stored = asStored(first.files);
    const second = mergeMigrationFiles(stored, [withModule]);

    expect(stored[0].name).toBe("db/migration/core/V1__init.sql");
    expect(second.added).toEqual([]);
    expect(second.skipped).toEqual(["db/migration/core/V1__init.sql"]);
  });

  it("deduplica arquivos repetidos dentro do mesmo envio", () => {
    const result = mergeMigrationFiles([], [V1, V1]);

    expect(result.added).toEqual(["V1__init.sql"]);
    expect(result.skipped).toEqual(["V1__init.sql"]);
    expect(result.files).toHaveLength(1);
  });

  it("checksum do conteúdo bate com o gravado por buildMigrationFiles", () => {
    const [stored] = asStored([V1]);
    expect(migrationContentChecksum(V1.content)).toBe(stored.checksum);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildChunkSummaryPrompt,
  buildMigrationSummaryPrompt,
  buildPackageOverviewPrompt,
  CHUNK_DIGEST_HEADING,
  computePackageFacts,
  describeStats,
  extractChunkDigest,
  planSummaryChunks,
} from "@/lib/services/migration-summary";
import type { MigrationSnapshotStats, MigrationSummaryInput, MigrationSummaryItem } from "@/lib/types/migrations";

function stats(overrides: Partial<MigrationSnapshotStats> = {}): MigrationSnapshotStats {
  return {
    tables: 1,
    columns: 2,
    edges: 0,
    addedTables: [],
    removedTables: [],
    alteredTables: [],
    addedEdges: 0,
    removedEdges: 0,
    schemaWarnings: 0,
    ignoredStatements: 0,
    ...overrides,
  };
}

function item(order: number, content = "SELECT 1;"): MigrationSummaryItem {
  return { order, name: `V${order}__x.sql`, content, stats: stats() };
}

function input(overrides: Partial<MigrationSummaryInput> = {}): MigrationSummaryInput {
  return {
    packageName: "Projeto SICAD",
    sourceProvider: "flyway",
    totalFiles: 10,
    target: { order: 4, name: "V4__add_email.sql", content: "ALTER TABLE users ADD COLUMN email VARCHAR(120);", stats: stats({ alteredTables: ["users"] }) },
    before: [],
    after: [],
    tablesBefore: 3,
    tablesAfter: 4,
    ...overrides,
  };
}

describe("migration-summary / describeStats", () => {
  it("descreve adicionadas, alteradas, removidas e FKs", () => {
    const text = describeStats(
      stats({ addedTables: ["a"], alteredTables: ["b"], removedTables: ["c"], addedEdges: 2, removedEdges: 1, tables: 9 })
    );
    expect(text).toContain("+1 tabela(s): a");
    expect(text).toContain("~1 alterada(s): b");
    expect(text).toContain("-1 removida(s): c");
    expect(text).toContain("2 FK(s) adicionada(s)");
    expect(text).toContain("total acumulado 9 tabela(s)");
  });

  it("sinaliza ausência de estatística", () => {
    expect(describeStats(null)).toBe("sem estatística de schema");
  });
});

describe("migration-summary / buildMigrationSummaryPrompt", () => {
  it("inclui a migration alvo com SQL completo e estado do schema", () => {
    const prompt = buildMigrationSummaryPrompt(input());
    expect(prompt).toContain("MIGRATION ALVO: #4 V4__add_email.sql");
    expect(prompt).toContain("ALTER TABLE users ADD COLUMN email VARCHAR(120);");
    expect(prompt).toContain("3 tabela(s) antes desta migration, 4 depois");
    expect(prompt).toContain("Pacote de migrations: \"Projeto SICAD\"");
  });

  it("omite as seções de vizinhas quando não há contexto", () => {
    const prompt = buildMigrationSummaryPrompt(input());
    expect(prompt).not.toContain("Migrations ANTERIORES");
    expect(prompt).not.toContain("Migrations POSTERIORES");
  });

  it("inclui as vizinhas quando fornecidas", () => {
    const prompt = buildMigrationSummaryPrompt(
      input({ before: [item(2), item(3)], after: [item(5)] })
    );
    expect(prompt).toContain("Migrations ANTERIORES");
    expect(prompt).toContain("#2 V2__x.sql");
    expect(prompt).toContain("#3 V3__x.sql");
    expect(prompt).toContain("Migrations POSTERIORES");
    expect(prompt).toContain("#5 V5__x.sql");
  });

  it("trunca SQL muito longo da migration alvo", () => {
    const huge = `CREATE TABLE t (${"c INT,".repeat(4000)});`;
    const prompt = buildMigrationSummaryPrompt(input({ target: { order: 1, name: "V1.sql", content: huge, stats: null } }));
    expect(prompt).toContain("caracteres omitidos");
    expect(prompt.length).toBeLessThan(huge.length);
  });

  it("mantém no máximo 5 vizinhas de cada lado (as mais próximas)", () => {
    const before = [item(1), item(2), item(3), item(4), item(5), item(6), item(7)];
    const after = [item(9), item(10), item(11), item(12), item(13), item(14)];
    const prompt = buildMigrationSummaryPrompt(input({ before, after }));
    // As mais distantes (mais antigas) ficam de fora.
    expect(prompt).not.toContain("#1 V1__x.sql");
    expect(prompt).not.toContain("#2 V2__x.sql");
    expect(prompt).toContain("#7 V7__x.sql");
    // Posteriores: mantém as 5 primeiras, descarta a 6ª.
    expect(prompt).toContain("#13 V13__x.sql");
    expect(prompt).not.toContain("#14 V14__x.sql");
  });

  it("avisa quando a alvo tem statements não reconhecidos", () => {
    const prompt = buildMigrationSummaryPrompt(
      input({ target: { order: 4, name: "V4.sql", content: "SELECT 1;", stats: stats({ schemaWarnings: 3 }) } })
    );
    expect(prompt).toContain("não reconheceu 3 statement(s)");
  });
});

describe("migration-summary / resumo do package inteiro", () => {
  it("planSummaryChunks cobre todas as migrations, em ordem, sem lacunas nem sobreposição", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ order: i + 1, chars: 1_500 }));
    const chunks = planSummaryChunks(items, 10_000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].fromOrder).toBe(1);
    expect(chunks[chunks.length - 1].toOrder).toBe(50);
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
      if (i > 0) expect(chunk.fromOrder).toBe(chunks[i - 1].toOrder + 1);
    });
    expect(chunks.reduce((sum, chunk) => sum + chunk.count, 0)).toBe(50);
  });

  it("planSummaryChunks trunca migrations gigantes no custo, então uma não monopoliza o lote", () => {
    const chunks = planSummaryChunks(
      [
        { order: 1, chars: 5_000_000 },
        { order: 2, chars: 100 },
      ],
      10_000
    );
    expect(chunks).toHaveLength(1);
  });

  it("planSummaryChunks devolve [] sem migrations e 1 lote com uma só", () => {
    expect(planSummaryChunks([])).toEqual([]);
    expect(planSummaryChunks([{ order: 1, chars: 10 }])).toEqual([{ index: 0, fromOrder: 1, toOrder: 1, count: 1 }]);
  });

  it("buildChunkSummaryPrompt lista cada migration com SQL truncado e pede o resumo do bloco", () => {
    const prompt = buildChunkSummaryPrompt({
      packageName: "SICAD",
      sourceProvider: "flyway",
      totalFiles: 40,
      chunk: { index: 1, fromOrder: 11, toOrder: 12, count: 2 },
      chunkCount: 4,
      items: [item(11, "CREATE TABLE a (id INT);"), item(12, "X".repeat(10_000))],
    });

    expect(prompt).toContain("bloco 2 de 4");
    expect(prompt).toContain("#11 V11__x.sql");
    expect(prompt).toContain("#12 V12__x.sql");
    expect(prompt).toContain("caracteres omitidos");
    expect(prompt).toContain(CHUNK_DIGEST_HEADING);
  });

  it("extractChunkDigest pega só a seção final e cai no texto inteiro sem ela", () => {
    expect(extractChunkDigest(`## Migrations\n- a\n\n${CHUNK_DIGEST_HEADING}\n- tema 1\n- tema 2`)).toBe("- tema 1\n- tema 2");
    expect(extractChunkDigest("sem seção")).toBe("sem seção");
    expect(extractChunkDigest(`${CHUNK_DIGEST_HEADING}\n${"x".repeat(5_000)}`).length).toBeLessThanOrEqual(1_800);
  });

  it("computePackageFacts usa o último schema e ranqueia as maiores criações de tabelas", () => {
    const facts = computePackageFacts("P", "flyway", [
      { order: 1, name: "V1", stats: stats({ tables: 3, addedTables: ["a", "b", "c"] }) },
      { order: 2, name: "V2", stats: stats({ tables: 4, columns: 20, edges: 2, addedTables: ["d"], schemaWarnings: 1 }) },
      { order: 3, name: "V3", stats: null },
    ]);
    expect(facts).toMatchObject({ totalFiles: 3, finalTables: 4, finalColumns: 20, finalEdges: 2, migrationsWithWarnings: 1 });
    expect(facts.biggestSchemaSteps.map((s) => s.order)).toEqual([1, 2]);
  });

  it("buildPackageOverviewPrompt usa só o digest de cada lote e ordena cronologicamente", () => {
    const facts = computePackageFacts("P", "flyway", [{ order: 1, name: "V1", stats: stats() }]);
    const prompt = buildPackageOverviewPrompt(facts, [
      { index: 1, fromOrder: 5, toOrder: 8, summary: `## Migrations\n- detalhe longo\n${CHUNK_DIGEST_HEADING}\n- tema B` },
      { index: 0, fromOrder: 1, toOrder: 4, summary: `## Migrations\n- outro detalhe\n${CHUNK_DIGEST_HEADING}\n- tema A` },
    ]);
    expect(prompt.indexOf("tema A")).toBeLessThan(prompt.indexOf("tema B"));
    expect(prompt).not.toContain("detalhe longo");
    expect(prompt).toContain("Schema final");
  });
});


import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";

import { extractZipToMigrationInputs } from "@/lib/services/zip-migrations";

function createZipBuffer(entries: Array<{ path: string; content: string; isDirectory?: boolean }>): Buffer {
  const zip = new AdmZip();
  for (const entry of entries) {
    if (entry.isDirectory) {
      zip.addFile(entry.path, Buffer.alloc(0), "", 0);
    } else {
      zip.addFile(entry.path, Buffer.from(entry.content, "utf8"), "", 0);
    }
  }
  return zip.toBuffer();
}

describe("zip-migrations / extractZipToMigrationInputs", () => {
  it("extrai arquivos .sql preservando o caminho relativo", async () => {
    const zip = createZipBuffer([
      { path: "resources/db/migration/core/V1__init.sql", content: "CREATE TABLE a (id INT NOT NULL PRIMARY KEY);" },
      { path: "resources/db/migration/billing/V1__init.sql", content: "CREATE TABLE b (id INT NOT NULL PRIMARY KEY);" },
    ]);

    const files = await extractZipToMigrationInputs(zip);
    expect(files).toHaveLength(2);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      "resources/db/migration/billing/V1__init.sql",
      "resources/db/migration/core/V1__init.sql",
    ]);
    expect(files.every((f) => f.name === "V1__init.sql")).toBe(true);
  });

  it("ignora arquivos não-.sql", async () => {
    const zip = createZipBuffer([
      { path: "V1__init.sql", content: "CREATE TABLE a (id INT);" },
      { path: "README.md", content: "# readme" },
      { path: "config.json", content: "{}" },
    ]);

    const files = await extractZipToMigrationInputs(zip);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("V1__init.sql");
  });

  it("ignora diretórios", async () => {
    const zip = createZipBuffer([
      { path: "resources/", content: "", isDirectory: true },
      { path: "resources/db/", content: "", isDirectory: true },
      { path: "resources/db/V1__init.sql", content: "CREATE TABLE a (id INT);" },
    ]);

    const files = await extractZipToMigrationInputs(zip);
    expect(files).toHaveLength(1);
  });

  it("respeita limite de tamanho por arquivo", async () => {
    const big = "x".repeat(600 * 1024);
    const zip = createZipBuffer([
      { path: "big.sql", content: big },
    ]);

    await expect(extractZipToMigrationInputs(zip, { maxFileSize: 1024 })).rejects.toThrow();
  });

  it("respeita limite de número de arquivos", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      path: `V${i + 1}__a.sql`,
      content: "SELECT 1;",
    }));
    const zip = createZipBuffer(entries);

    await expect(extractZipToMigrationInputs(zip, { maxFiles: 2 })).rejects.toThrow();
  });
});

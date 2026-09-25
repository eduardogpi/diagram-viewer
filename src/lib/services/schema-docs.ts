import type { ExplorerCatalog, ExplorerTable } from "@/lib/types/explorer";

function tableSection(table: ExplorerTable): string {
  const lines: string[] = [];
  lines.push(`### \`${table.name}\``);
  lines.push("");
  const rows =
    table.estimatedRows === null ? "linhas estimadas indisponíveis" : `~${table.estimatedRows} linha(s) estimadas`;
  lines.push(`${table.columns.length} coluna(s), ${table.indexes.length} índice(s) · ${rows}`);
  lines.push("");
  lines.push("| Coluna | Tipo | Chaves | Referência |");
  lines.push("| --- | --- | --- | --- |");
  for (const column of table.columns) {
    const keys = [column.isPrimary ? "PK" : "", column.isForeign ? "FK" : ""].filter(Boolean).join(", ");
    const reference = column.references ? `\`${column.references.table}.${column.references.column}\`` : "";
    lines.push(`| \`${column.name}\` | \`${column.type}\` | ${keys || "—"} | ${reference || "—"} |`);
  }

  if (table.indexes.length > 0) {
    lines.push("");
    lines.push("**Índices:** " + table.indexes.map((index) => `\`${index.name}\` (${index.columns.join(", ")})`).join("; "));
  }

  const relations = [
    ...table.foreignKeys.map((rel) => `→ \`${rel.referencesTable}.${rel.referencesColumn}\``),
    ...table.referencedBy.map((rel) => `← \`${rel.referencesTable}.${rel.referencesColumn}\``),
  ];
  if (relations.length > 0) {
    lines.push("");
    lines.push("**Relacionamentos:** " + relations.join(" · "));
  }

  lines.push("");
  return lines.join("\n");
}

/** Gera documentação Markdown do schema, agrupada por schema/domínio. */
export function buildSchemaMarkdown(catalog: ExplorerCatalog, generatedAt = new Date()): string {
  const lines: string[] = [];
  lines.push(`# Documentação do schema — ${catalog.database}`);
  lines.push("");
  lines.push(`Provider: \`${catalog.provider}\` · ${catalog.tables.length} tabela(s) · gerado em ${generatedAt.toISOString()}`);
  lines.push("");

  for (const schema of catalog.schemas) {
    const tables = catalog.tables.filter((table) => table.schema === schema);
    if (tables.length === 0) continue;
    lines.push(`## Schema \`${schema}\``);
    lines.push("");
    for (const table of tables) {
      lines.push(tableSection(table));
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

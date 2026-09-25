import type { DiagramEdgeDTO, DiagramNodeDTO, DiagramResponse } from "@/lib/types/diagram";

/**
 * Gera DDL a partir do modelo canônico (`DiagramResponse`) — o caminho inverso do
 * `migration-parser`, que lê SQL e produz o diagrama.
 *
 * O modelo já é dialeto-agnóstico por construção (o prompt da IA proíbe sintaxe específica de
 * um banco), então aqui só resta traduzir os tipos que divergem, aplicar o quoting certo e
 * ordenar as tabelas para que nenhuma FK aponte para algo que ainda não existe.
 */

export const ddlDialects = ["mysql", "postgres"] as const;
export type DdlDialect = (typeof ddlDialects)[number];

export function isDdlDialect(value: string): value is DdlDialect {
  return (ddlDialects as readonly string[]).includes(value);
}

export type GenerateDdlOptions = {
  dialect: DdlDialect;
  /** Nome do banco/schema a criar antes das tabelas. Omitido = só as tabelas. */
  databaseName?: string;
  /** Cabeçalho de comentário (ex: nome da modelagem de origem). */
  title?: string;
};

/** Tipos que mudam de nome entre os bancos. O que não estiver aqui passa direto. */
const TYPE_MAP: Record<DdlDialect, Record<string, string>> = {
  mysql: {
    BYTEA: "BLOB",
    JSONB: "JSON",
    "DOUBLE PRECISION": "DOUBLE",
    TIMESTAMPTZ: "TIMESTAMP",
    SERIAL: "BIGINT",
    BIGSERIAL: "BIGINT",
    UUID: "CHAR(36)",
  },
  postgres: {
    DATETIME: "TIMESTAMP",
    BLOB: "BYTEA",
    JSON: "JSONB",
    DOUBLE: "DOUBLE PRECISION",
    "TINYINT(1)": "BOOLEAN",
    TINYINT: "SMALLINT",
    MEDIUMINT: "INTEGER",
    "MEDIUMTEXT": "TEXT",
    "LONGTEXT": "TEXT",
    DATETIME2: "TIMESTAMP",
  },
};

function quote(identifier: string, dialect: DdlDialect): string {
  return dialect === "mysql" ? `\`${identifier}\`` : `"${identifier}"`;
}

/** Normaliza o tipo declarado no modelo para o dialeto alvo, preservando precisão (ex: VARCHAR(30)). */
export function mapType(rawType: string, dialect: DdlDialect): string {
  const type = rawType.trim();
  const upper = type.toUpperCase();
  const map = TYPE_MAP[dialect];

  if (map[upper]) return map[upper];

  // Tipos com precisão: mapeia só a base e devolve os parênteses originais.
  const match = /^([A-Z_ ]+?)\s*(\([^)]*\))$/.exec(upper);
  if (match) {
    const base = match[1].trim();
    if (map[base]) {
      // Bases que viram tipo sem precisão (TEXT, BOOLEAN) descartam os parênteses.
      const mapped = map[base];
      return /TEXT|BOOLEAN|BYTEA|JSONB?/.test(mapped) ? mapped : `${mapped}${match[2]}`;
    }
    return `${base}${match[2]}`;
  }

  return upper;
}

/**
 * Nome de tabela a usar no DDL. Normalmente é o `label` (nome real). Quando o modelo reúne
 * sistemas diferentes e dois escopos têm tabelas homônimas, cai para o id qualificado
 * ("projeto-a.users" -> "projeto_a_users") para não colidir no mesmo banco.
 */
function tableNames(nodes: DiagramNodeDTO[]): Map<string, string> {
  const labelCount = new Map<string, number>();
  for (const node of nodes) {
    labelCount.set(node.label, (labelCount.get(node.label) ?? 0) + 1);
  }

  return new Map(
    nodes.map((node) => [
      node.id,
      (labelCount.get(node.label) ?? 0) > 1 ? node.id.replace(/[.\s]+/g, "_") : node.label,
    ])
  );
}

/**
 * Ordena as tabelas para que cada FK aponte para uma tabela já criada. Ciclos (A -> B -> A) não
 * têm ordem válida: as tabelas envolvidas saem na ordem original e as FKs que fecham o ciclo
 * são devolvidas em `deferred`, para virarem ALTER TABLE no fim do script.
 */
export function sortTablesByDependency(
  nodes: DiagramNodeDTO[],
  edges: DiagramEdgeDTO[]
): { ordered: DiagramNodeDTO[]; deferred: DiagramEdgeDTO[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dependencies = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));

  for (const edge of edges) {
    // Auto-referência não impede a criação da tabela.
    if (edge.source === edge.target) continue;
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    dependencies.get(edge.source)?.add(edge.target);
  }

  const ordered: DiagramNodeDTO[] = [];
  const placed = new Set<string>();

  // Kahn simplificado: a cada passada emite quem já tem todas as dependências resolvidas.
  let progress = true;
  while (progress && placed.size < nodes.length) {
    progress = false;
    for (const node of nodes) {
      if (placed.has(node.id)) continue;
      const deps = dependencies.get(node.id) ?? new Set();
      if (Array.from(deps).every((dep) => placed.has(dep))) {
        ordered.push(node);
        placed.add(node.id);
        progress = true;
      }
    }
  }

  // Sobrou algo = ciclo. Emite na ordem original e adia as FKs que apontam para o restante.
  const deferred: DiagramEdgeDTO[] = [];
  if (placed.size < nodes.length) {
    for (const node of nodes) {
      if (placed.has(node.id)) continue;
      ordered.push(node);
      placed.add(node.id);
    }
    for (const edge of edges) {
      if (edge.source === edge.target) continue;
      if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
      const sourceIndex = ordered.findIndex((n) => n.id === edge.source);
      const targetIndex = ordered.findIndex((n) => n.id === edge.target);
      if (targetIndex > sourceIndex) deferred.push(edge);
    }
  }

  return { ordered, deferred };
}

function referentialAction(action: string | undefined): string {
  if (!action) return "";
  const normalized = action.trim().toUpperCase();
  return ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION"].includes(normalized)
    ? normalized
    : "";
}

function foreignKeyClause(
  edge: DiagramEdgeDTO,
  names: Map<string, string>,
  dialect: DdlDialect
): string {
  const sourceColumns = edge.columns.map((c) => quote(c.source, dialect)).join(", ");
  const targetColumns = edge.columns.map((c) => quote(c.target, dialect)).join(", ");
  const onDelete = referentialAction(edge.onDelete);
  const onUpdate = referentialAction(edge.onUpdate);

  return [
    `CONSTRAINT ${quote(edge.constraint, dialect)} FOREIGN KEY (${sourceColumns})`,
    `REFERENCES ${quote(names.get(edge.target) ?? edge.target, dialect)} (${targetColumns})`,
    onDelete ? `ON DELETE ${onDelete}` : "",
    onUpdate ? `ON UPDATE ${onUpdate}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function generateDdl(diagram: DiagramResponse, options: GenerateDdlOptions): string {
  const { dialect, databaseName, title } = options;
  const nodes = diagram.nodes;

  if (nodes.length === 0) {
    return "-- Modelo vazio: nada para exportar.\n";
  }

  const names = tableNames(nodes);
  const { ordered, deferred } = sortTablesByDependency(nodes, diagram.edges);
  const deferredIds = new Set(deferred.map((e) => e.id));

  const lines: string[] = [];
  lines.push(`-- ${title ? `${title} — ` : ""}gerado pelo workbench (${dialect})`);
  lines.push(`-- ${ordered.length} tabela(s), ${diagram.edges.length} foreign key(s)`);
  lines.push("");

  if (databaseName) {
    if (dialect === "mysql") {
      lines.push(`CREATE DATABASE IF NOT EXISTS ${quote(databaseName, dialect)};`);
      lines.push(`USE ${quote(databaseName, dialect)};`);
    } else {
      // CREATE DATABASE no Postgres não roda dentro de transação nem aceita "USE": o
      // equivalente prático dentro de uma conexão é um schema com search_path.
      lines.push(`-- No Postgres, "CREATE DATABASE ${databaseName}" precisa rodar fora deste script.`);
      lines.push(`CREATE SCHEMA IF NOT EXISTS ${quote(databaseName, dialect)};`);
      lines.push(`SET search_path TO ${quote(databaseName, dialect)};`);
    }
    lines.push("");
  }

  for (const node of ordered) {
    const tableName = names.get(node.id) ?? node.label;
    const body: string[] = [];

    for (const column of node.columns) {
      const parts = [
        `  ${quote(column.name, dialect)} ${mapType(column.type, dialect)}`,
        column.isNullable ? "" : "NOT NULL",
      ].filter(Boolean);
      body.push(parts.join(" "));
    }

    const primaryKeys = node.columns.filter((c) => c.isPrimary);
    if (primaryKeys.length > 0) {
      body.push(`  PRIMARY KEY (${primaryKeys.map((c) => quote(c.name, dialect)).join(", ")})`);
    }

    for (const edge of diagram.edges) {
      if (edge.source !== node.id || deferredIds.has(edge.id)) continue;
      body.push(`  ${foreignKeyClause(edge, names, dialect)}`);
    }

    lines.push(`CREATE TABLE ${quote(tableName, dialect)} (`);
    lines.push(body.join(",\n"));
    lines.push(");");
    lines.push("");
  }

  if (deferred.length > 0) {
    lines.push("-- Foreign keys que fecham ciclos entre tabelas, adicionadas depois da criação.");
    for (const edge of deferred) {
      const tableName = names.get(edge.source) ?? edge.source;
      lines.push(`ALTER TABLE ${quote(tableName, dialect)} ADD ${foreignKeyClause(edge, names, dialect)};`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

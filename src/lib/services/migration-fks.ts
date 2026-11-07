import { generateDeltaDdl, inferMigrationSlug, type DdlDialect } from "@/lib/services/ddl-generator";
import { generateSchemaOps, resolveLlmTarget } from "@/lib/services/llm";
import { applySchemaOps, type SchemaOp } from "@/lib/services/schema-ops";
import type { DiagramNodeDTO, DiagramResponse } from "@/lib/types/diagram";

export type ForeignKeySuggestion = {
  id: string;
  table: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
  source: "heuristic" | "ai";
  reason: string;
  crossScope: boolean;
};

function candidateStemsForColumn(colName: string): string[] {
  const lower = colName.toLowerCase();
  const stems: string[] = [];

  if (lower.endsWith("_id") && lower.length > 3) {
    stems.push(lower.slice(0, -3));
  } else if (lower.startsWith("id_") && lower.length > 3) {
    stems.push(lower.slice(3));
  } else if (lower.startsWith("fk_") && lower.length > 3) {
    stems.push(lower.slice(3));
  } else if (lower.startsWith("cod_") && lower.length > 4) {
    stems.push(lower.slice(4));
  }

  return stems;
}

function expandTableNames(stem: string): string[] {
  const s = stem.toLowerCase();
  const variants = new Set<string>([s, `${s}s`, `${s}es`]);
  if (s.endsWith("ao")) {
    variants.add(`${s.slice(0, -2)}oes`);
  }
  if (s.endsWith("m")) {
    variants.add(`${s.slice(0, -1)}ns`);
  }
  if (s.endsWith("r") || s.endsWith("z")) {
    variants.add(`${s}es`);
  }
  if (s.endsWith("y") && s.length > 2) {
    variants.add(`${s.slice(0, -1)}ies`);
  }
  return Array.from(variants);
}

/**
 * Sugere chaves estrangeiras determinísticas com base nos nomes das colunas e tabelas do diagrama.
 */
export function suggestHeuristicForeignKeys(diagram: DiagramResponse): ForeignKeySuggestion[] {
  const suggestions: ForeignKeySuggestion[] = [];
  const seenKey = new Set<string>();

  for (const edge of diagram.edges) {
    for (const pair of edge.columns) {
      seenKey.add(`${edge.source.toLowerCase()}.${pair.source.toLowerCase()}`);
    }
  }

  const byLabel = new Map<string, DiagramNodeDTO[]>();
  for (const node of diagram.nodes) {
    if (node.columns.length === 0) continue;
    const key = node.label.toLowerCase();
    if (
      key === "flyway_schema_history" ||
      key === "schema_version" ||
      key.endsWith("_dadossys") ||
      key === "dadossys"
    ) {
      continue;
    }
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key)!.push(node);
  }

  for (const node of diagram.nodes) {
    if (node.columns.length === 0) continue;
    const nodePrefixMatch = /^([a-z0-9]+_)/i.exec(node.label);
    const nodePrefix = nodePrefixMatch ? nodePrefixMatch[1].toLowerCase() : "";

    for (const col of node.columns) {
      if (col.isPrimary || col.isForeign) continue;
      const colKey = `${node.id.toLowerCase()}.${col.name.toLowerCase()}`;
      if (seenKey.has(colKey)) continue;

      const stems = candidateStemsForColumn(col.name);
      if (stems.length === 0) continue;

      const searchStems = [...stems];
      if (nodePrefix) {
        for (const st of stems) {
          if (!st.startsWith(nodePrefix)) {
            searchStems.push(`${nodePrefix}${st}`);
          }
        }
      }

      let matchedTarget: DiagramNodeDTO | undefined;
      for (const stem of searchStems) {
        const candidates = expandTableNames(stem).flatMap((name) => byLabel.get(name) ?? []);
        if (candidates.length === 0) continue;
        // Prefere tabela do mesmo escopo, senão aceita de outro escopo
        matchedTarget =
          candidates.find((c) => c.scope === node.scope && c.id !== node.id) ??
          candidates.find((c) => c.id !== node.id);
        if (matchedTarget) break;
      }

      if (!matchedTarget) continue;

      const targetPk =
        matchedTarget.columns.find((c) => c.isPrimary && c.name.toLowerCase() === "id") ??
        matchedTarget.columns.find((c) => c.isPrimary);

      if (!targetPk) continue;

      const crossScope = matchedTarget.scope !== node.scope;
      seenKey.add(colKey);
      suggestions.push({
        id: `heur:${node.id}.${col.name}->${matchedTarget.id}.${targetPk.name}`,
        table: node.id,
        column: col.name,
        referencesTable: matchedTarget.id,
        referencesColumn: targetPk.name,
        source: "heuristic",
        crossScope,
        reason: crossScope
          ? `Padrão de nomenclatura "${col.name}" referencia "${matchedTarget.id}.${targetPk.name}" (entre escopos "${node.scope}" → "${matchedTarget.scope}")`
          : `Padrão de nomenclatura "${col.name}" corresponde à PK "${matchedTarget.label}.${targetPk.name}"`,
      });
    }
  }

  return suggestions;
}

/**
 * Usa a LLM configurada para inferir chaves estrangeiras ausentes (inclusive nomes não óbvios)
 * combinadas com as sugestões determinísticas.
 */
export async function suggestForeignKeysWithAi(params: {
  diagram: DiagramResponse;
  provider?: string;
  model?: string;
  promptHint?: string;
}): Promise<{ reply: string; suggestions: ForeignKeySuggestion[] }> {
  const heuristic = suggestHeuristicForeignKeys(params.diagram);
  const target = await resolveLlmTarget(params.provider, params.model);

  const userPrompt = [
    "Analise todas as tabelas e colunas deste schema de migration e identifique TODAS as chaves estrangeiras (foreign keys) que estão faltando.",
    "Retorne APENAS operações do tipo 'addForeignKey' no array 'operations' para ligar colunas de referência às chaves primárias correspondentes.",
    "Não crie nem remova tabelas ou colunas — apenas sugira as ligações de foreign key (inclusive quando o nome da coluna usa abreviações ou termos de negócio equivalentes).",
    params.promptHint?.trim() ? `Instrução adicional do usuário: ${params.promptHint.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const llmResponse = await generateSchemaOps(target.provider, {
    currentDiagram: params.diagram,
    history: [],
    userMessage: userPrompt,
    model: target.model,
    discussOnly: false,
  });

  const combined: ForeignKeySuggestion[] = [...heuristic];
  const existingKeys = new Set<string>(
    heuristic.map((s) => `${s.table.toLowerCase()}.${s.column.toLowerCase()}`)
  );
  for (const edge of params.diagram.edges) {
    for (const pair of edge.columns) {
      existingKeys.add(`${edge.source.toLowerCase()}.${pair.source.toLowerCase()}`);
    }
  }

  const nodeMap = new Map(params.diagram.nodes.map((n) => [n.id.toLowerCase(), n]));
  const findNodeLoose = (name: string) =>
    nodeMap.get(name.toLowerCase()) ??
    params.diagram.nodes.find((n) => n.label.toLowerCase() === name.toLowerCase());

  for (const op of llmResponse.operations) {
    if (op.op !== "addForeignKey") continue;
    const srcNode = findNodeLoose(op.table);
    const tgtNode = findNodeLoose(op.referencesTable);
    if (!srcNode || !tgtNode) continue;

    const srcCol = srcNode.columns.find((c) => c.name.toLowerCase() === op.column.toLowerCase());
    const tgtCol = tgtNode.columns.find((c) => c.name.toLowerCase() === op.referencesColumn.toLowerCase());
    if (!srcCol || !tgtCol) continue;

    const key = `${srcNode.id.toLowerCase()}.${srcCol.name.toLowerCase()}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);

    const crossScope = srcNode.scope !== tgtNode.scope;
    combined.push({
      id: `ai:${srcNode.id}.${srcCol.name}->${tgtNode.id}.${tgtCol.name}`,
      table: srcNode.id,
      column: srcCol.name,
      referencesTable: tgtNode.id,
      referencesColumn: tgtCol.name,
      source: "ai",
      crossScope,
      reason: crossScope
        ? `Sugerida pela IA (${target.model}) — relação entre escopos "${srcNode.scope}" → "${tgtNode.scope}"`
        : `Sugerida pela IA (${target.model}) pela semântica de domínio`,
    });
  }

  return {
    reply: llmResponse.reply,
    suggestions: combined,
  };
}

export type AddFkInput = {
  table: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
  onDelete?: string;
  onUpdate?: string;
};

/**
 * Converte uma lista de FKs em operações SchemaOp, aplica sobre o diagrama e gera o SQL incremental.
 */
export function buildForeignKeysDelta(params: {
  diagram: DiagramResponse;
  fks: AddFkInput[];
  dialect: DdlDialect;
  nextVersionNumber: number;
  description?: string;
}): {
  updatedDiagram: DiagramResponse;
  sql: string;
  filename: string;
  operations: SchemaOp[];
} {
  const operations: SchemaOp[] = params.fks.map((fk) => ({
    op: "addForeignKey",
    table: fk.table,
    column: fk.column,
    referencesTable: fk.referencesTable,
    referencesColumn: fk.referencesColumn,
    ...(fk.onDelete ? { onDelete: fk.onDelete } : {}),
    ...(fk.onUpdate ? { onUpdate: fk.onUpdate } : {}),
  }));

  const { next: updatedDiagram } = applySchemaOps(params.diagram, operations);
  const sql = generateDeltaDdl(operations, {
    dialect: params.dialect,
    baseDiagram: params.diagram,
  });
  const customDesc = params.description?.trim()
    ? params.description
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
    : "";
  const slug = customDesc || inferMigrationSlug(operations, "add_foreign_keys");
  const filename = `V${params.nextVersionNumber}__${slug}.sql`;

  return {
    updatedDiagram,
    sql,
    filename,
    operations,
  };
}

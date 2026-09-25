import { z } from "zod";

import type { DiagramColumnDTO, DiagramNodeDTO, DiagramResponse } from "@/lib/types/diagram";

const columnSpecSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  isPrimary: z.boolean().optional().default(false),
  isNullable: z.boolean().optional().default(true),
});

/**
 * Operações estruturadas que a LLM pode propor sobre o modelo canônico (DiagramResponse).
 * Deliberadamente NÃO é SQL: fica independente de dialeto (MySQL/Postgres/...) e é validável
 * e revisável (renderiza como diff no diagrama) antes de qualquer exportação.
 */
export const schemaOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("createTable"),
    table: z.string().min(1),
    scope: z.string().optional(),
    columns: z.array(columnSpecSchema).default([]),
  }),
  z.object({ op: z.literal("addColumn"), table: z.string().min(1), newColumn: columnSpecSchema }),
  z.object({ op: z.literal("dropColumn"), table: z.string().min(1), column: z.string().min(1) }),
  z.object({
    op: z.literal("renameColumn"),
    table: z.string().min(1),
    column: z.string().min(1),
    newName: z.string().min(1),
  }),
  z.object({
    op: z.literal("alterColumn"),
    table: z.string().min(1),
    column: z.string().min(1),
    type: z.string().min(1).optional(),
    isNullable: z.boolean().optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("addForeignKey"),
    table: z.string().min(1),
    column: z.string().min(1),
    referencesTable: z.string().min(1),
    referencesColumn: z.string().min(1),
    onDelete: z.string().optional(),
    onUpdate: z.string().optional(),
  }),
  z.object({ op: z.literal("dropForeignKey"), table: z.string().min(1), column: z.string().min(1) }),
  z.object({ op: z.literal("dropTable"), table: z.string().min(1) }),
  z.object({ op: z.literal("renameTable"), table: z.string().min(1), newName: z.string().min(1) }),
]);

export const schemaOpsResponseSchema = z.object({
  reply: z.string(),
  operations: z.array(schemaOpSchema).default([]),
});

/** Forma solta da resposta da LLM: só valida o essencial (reply + array bruto de operações). */
const looseSchemaOpsResponseSchema = z.object({
  reply: z.string(),
  operations: z.array(z.unknown()).default([]),
});

export type SchemaOp = z.infer<typeof schemaOpSchema>;
export type SchemaOpsResponse = { reply: string; operations: SchemaOp[] };
export type ApplyOpsWarning = { op: SchemaOp; reason: string };

const FK_ACTIONS = ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION"] as const;
type FkAction = (typeof FK_ACTIONS)[number];

function isFkAction(value: string): value is FkAction {
  return (FK_ACTIONS as readonly string[]).includes(value);
}

/**
 * Faz um parse tolerante da resposta da LLM: valida a forma essencial (reply + array de
 * operações) e depois valida CADA operação individualmente, descartando só as malformadas
 * em vez de derrubar a resposta inteira — modelos menores às vezes esquecem um campo aninhado
 * (ex: "addColumn" sem o objeto da nova coluna) numa operação só, e isso não deveria invalidar
 * as outras operações corretas do mesmo turno.
 */
export function parseSchemaOpsResponse(raw: unknown): SchemaOpsResponse & { skippedCount: number } {
  const loose = looseSchemaOpsResponseSchema.parse(raw);
  const operations: SchemaOp[] = [];
  let skippedCount = 0;

  for (const item of loose.operations) {
    const parsedOp = schemaOpSchema.safeParse(item);
    if (parsedOp.success) {
      operations.push(parsedOp.data);
    } else {
      skippedCount += 1;
    }
  }

  return { reply: loose.reply, operations, skippedCount };
}

function humanize(value: string): string {
  const normalized = value.replace(/_/g, " ");
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveScope(tableName: string): string {
  const [prefix] = tableName.split("_");
  return prefix && prefix.length >= 3 ? prefix : "geral";
}

function cloneNode(node: DiagramNodeDTO): DiagramNodeDTO {
  return {
    ...node,
    columns: node.columns.map((c) => ({
      ...c,
      references: c.references ? { ...c.references } : undefined,
      fkMetadata: c.fkMetadata ? { ...c.fkMetadata } : undefined,
    })),
  };
}

function tableSuffix(id: string): string {
  const dot = id.lastIndexOf(".");
  return dot > 0 ? id.slice(dot + 1) : id;
}

function nodeMatches(node: DiagramNodeDTO, table: string): boolean {
  return node.id === table || node.label === table || tableSuffix(node.id) === table;
}

/** Resolve tabela por id, rótulo único ou sufixo após o último ponto. */
function findNode(
  nodes: Map<string, DiagramNodeDTO>,
  table: string
): { node: DiagramNodeDTO } | { error: string } {
  const exact = nodes.get(table);
  if (exact) return { node: exact };

  const matches = Array.from(nodes.values()).filter((node) => nodeMatches(node, table));
  if (matches.length === 1) return { node: matches[0] };
  if (matches.length > 1) {
    return {
      error: `Tabela "${table}" é ambígua (${matches.map((n) => n.id).join(", ")}). Use o id qualificado.`,
    };
  }
  return { error: `Tabela "${table}" não encontrada` };
}

function displayLabel(tableId: string): string {
  return tableSuffix(tableId);
}

function normalizeAction(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toUpperCase().replace(/_/g, " ");
  return isFkAction(normalized) ? normalized : value.trim();
}

/** Aplica uma lista de operações estruturadas sobre o modelo atual, produzindo o próximo estado. */
export function applySchemaOps(
  current: DiagramResponse,
  operations: SchemaOp[]
): { next: DiagramResponse; warnings: ApplyOpsWarning[]; notes: string[] } {
  const nodes = new Map<string, DiagramNodeDTO>(current.nodes.map((n) => [n.id, cloneNode(n)]));
  const edges = new Map<string, DiagramResponse["edges"][number]>(current.edges.map((e) => [e.id, { ...e, columns: e.columns.map((c) => ({ ...c })) }]));
  const warnings: ApplyOpsWarning[] = [];
  const notes: string[] = [];

  function clearForeignOnColumn(tableId: string, columnName: string) {
    const node = nodes.get(tableId);
    const column = node?.columns.find((c) => c.name === columnName);
    if (!column) return;
    const stillReferenced = Array.from(edges.values()).some(
      (e) => e.source === tableId && e.columns.some((pair) => pair.source === columnName)
    );
    if (!stillReferenced) {
      column.isForeign = false;
      column.references = undefined;
      column.fkMetadata = undefined;
    }
  }

  function dropEdgesFrom(tableId: string, column: string) {
    Array.from(edges.values())
      .filter((e) => e.source === tableId && e.columns.some((pair) => pair.source === column))
      .forEach((e) => edges.delete(e.id));
    clearForeignOnColumn(tableId, column);
  }

  /** Remove FKs que apontam para a coluna (ex: drop/rename de PK referenciada). */
  function dropEdgesTo(tableId: string, column: string) {
    for (const edge of Array.from(edges.values())) {
      if (edge.target !== tableId || !edge.columns.some((pair) => pair.target === column)) continue;
      edges.delete(edge.id);
      for (const pair of edge.columns) {
        if (pair.target === column) clearForeignOnColumn(edge.source, pair.source);
      }
    }
    for (const node of nodes.values()) {
      for (const col of node.columns) {
        if (col.references?.table === tableId && col.references.column === column) {
          col.isForeign = false;
          col.references = undefined;
          col.fkMetadata = undefined;
        }
      }
    }
  }

  for (const op of operations) {
    switch (op.op) {
      case "createTable": {
        if (nodes.has(op.table)) {
          warnings.push({ op, reason: `Tabela "${op.table}" já existe` });
          continue;
        }
        // Nome qualificado ("projeto-a.pagamentos") indica em qual sistema a tabela entra: o
        // prefixo vira o escopo e o rótulo exibido fica só com o nome da tabela.
        const dotIndex = op.table.lastIndexOf(".");
        const qualified = dotIndex > 0 ? { scope: op.table.slice(0, dotIndex), label: op.table.slice(dotIndex + 1) } : null;
        const scope = op.scope ?? qualified?.scope ?? deriveScope(op.table);
        const columns: DiagramColumnDTO[] = op.columns.map((c) => ({
          name: c.name,
          type: c.type,
          isNullable: c.isNullable,
          isPrimary: c.isPrimary,
          isForeign: false,
        }));
        // Salvaguarda: garante uma PK mínima mesmo se a LLM esquecer de incluir colunas.
        if (columns.length === 0) {
          columns.push({ name: "id", type: "BIGINT", isNullable: false, isPrimary: true, isForeign: false });
        }
        nodes.set(op.table, { id: op.table, label: qualified?.label ?? op.table, schema: "public", scope, columns });
        break;
      }
      case "addColumn": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        if (found.node.columns.some((c) => c.name === op.newColumn.name)) {
          warnings.push({ op, reason: `Coluna "${op.newColumn.name}" já existe em "${found.node.id}"` });
          continue;
        }
        found.node.columns.push({
          name: op.newColumn.name,
          type: op.newColumn.type,
          isNullable: op.newColumn.isNullable,
          isPrimary: op.newColumn.isPrimary,
          isForeign: false,
        });
        break;
      }
      case "alterColumn": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        const column = found.node.columns.find((c) => c.name === op.column);
        if (!column) {
          warnings.push({ op, reason: `Coluna "${op.column}" não encontrada em "${found.node.id}"` });
          continue;
        }
        if (op.type === undefined && op.isNullable === undefined && op.isPrimary === undefined) {
          warnings.push({ op, reason: `Nada para alterar em "${found.node.id}.${op.column}"` });
          continue;
        }
        if (op.type !== undefined) column.type = op.type;
        if (op.isNullable !== undefined) column.isNullable = op.isNullable;
        if (op.isPrimary !== undefined) column.isPrimary = op.isPrimary;
        break;
      }
      case "dropColumn": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        const before = found.node.columns.length;
        found.node.columns = found.node.columns.filter((c) => c.name !== op.column);
        if (found.node.columns.length === before) {
          warnings.push({ op, reason: `Coluna "${op.column}" não encontrada em "${found.node.id}"` });
          continue;
        }
        dropEdgesFrom(found.node.id, op.column);
        dropEdgesTo(found.node.id, op.column);
        break;
      }
      case "renameColumn": {
        const found = findNode(nodes, op.table);
        const column = found && "node" in found ? found.node.columns.find((c) => c.name === op.column) : undefined;
        if ("error" in found || !column) {
          warnings.push({
            op,
            reason: "error" in found ? found.error : `Coluna "${op.column}" não encontrada em "${op.table}"`,
          });
          continue;
        }
        if (found.node.columns.some((c) => c.name === op.newName)) {
          warnings.push({ op, reason: `Coluna "${op.newName}" já existe em "${found.node.id}"` });
          continue;
        }
        const tableId = found.node.id;
        column.name = op.newName;
        edges.forEach((e) => {
          if (e.source === tableId) {
            e.columns = e.columns.map((pair) => (pair.source === op.column ? { ...pair, source: op.newName } : pair));
          }
          if (e.target === tableId) {
            e.columns = e.columns.map((pair) => (pair.target === op.column ? { ...pair, target: op.newName } : pair));
          }
        });
        nodes.forEach((node) => {
          node.columns.forEach((col) => {
            if (col.references?.table === tableId && col.references.column === op.column) {
              col.references = { table: tableId, column: op.newName };
            }
          });
        });
        break;
      }
      case "addForeignKey": {
        const sourceFound = findNode(nodes, op.table);
        if ("error" in sourceFound) {
          warnings.push({ op, reason: sourceFound.error });
          continue;
        }
        const targetFound = findNode(nodes, op.referencesTable);
        if ("error" in targetFound) {
          warnings.push({ op, reason: targetFound.error });
          continue;
        }
        const sourceNode = sourceFound.node;
        const targetNode = targetFound.node;
        const column = sourceNode.columns.find((c) => c.name === op.column);
        if (!column) {
          warnings.push({ op, reason: `Coluna "${op.column}" não encontrada em "${sourceNode.id}"` });
          continue;
        }
        const targetColumn = targetNode.columns.find((c) => c.name === op.referencesColumn);
        if (!targetColumn) {
          warnings.push({
            op,
            reason: `Coluna referenciada "${op.referencesColumn}" não encontrada em "${targetNode.id}"`,
          });
          continue;
        }
        if (!targetColumn.isPrimary) {
          notes.push(
            `Coluna "${targetNode.id}.${op.referencesColumn}" não é chave primária — a FK pode não ser aplicável no banco`
          );
        }
        if (sourceNode.scope !== targetNode.scope) {
          notes.push(
            `FK cruzada entre escopos "${sourceNode.scope}" e "${targetNode.scope}" — o banco não garante essa constraint`
          );
        }
        column.isForeign = true;
        column.references = { table: targetNode.id, column: op.referencesColumn };
        const onDelete = normalizeAction(op.onDelete);
        const onUpdate = normalizeAction(op.onUpdate);
        const constraintName = `fk_${sourceNode.id}_${op.column}`.replace(/[^A-Za-z0-9_]+/g, "_");
        if (onDelete || onUpdate) {
          column.fkMetadata = {
            constraintName,
            onDelete: onDelete && isFkAction(onDelete) ? onDelete : "NO ACTION",
            onUpdate: onUpdate && isFkAction(onUpdate) ? onUpdate : "NO ACTION",
          };
        }
        const edgeId = `${sourceNode.id}-${targetNode.id}-fk_${sourceNode.id}_${op.column}`;
        edges.set(edgeId, {
          id: edgeId,
          source: sourceNode.id,
          target: targetNode.id,
          scope: sourceNode.scope,
          constraint: `fk_${sourceNode.id}_${op.column}`.replace(/[^A-Za-z0-9_]+/g, "_"),
          columns: [{ source: op.column, target: op.referencesColumn }],
          onDelete,
          onUpdate,
        });
        break;
      }
      case "dropForeignKey": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        dropEdgesFrom(found.node.id, op.column);
        break;
      }
      case "dropTable": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        const tableId = found.node.id;
        nodes.delete(tableId);
        Array.from(edges.values())
          .filter((e) => e.source === tableId || e.target === tableId)
          .forEach((e) => {
            if (e.target === tableId) {
              for (const pair of e.columns) clearForeignOnColumn(e.source, pair.source);
            }
            edges.delete(e.id);
          });
        nodes.forEach((node) => {
          node.columns.forEach((col) => {
            if (col.references?.table === tableId) {
              col.isForeign = false;
              col.references = undefined;
              col.fkMetadata = undefined;
            }
          });
        });
        break;
      }
      case "renameTable": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        if (nodes.has(op.newName) && found.node.id !== op.newName) {
          warnings.push({ op, reason: `Tabela "${op.newName}" já existe` });
          continue;
        }
        const oldId = found.node.id;
        nodes.delete(oldId);
        found.node.id = op.newName;
        found.node.label = displayLabel(op.newName);
        nodes.set(op.newName, found.node);
        edges.forEach((e) => {
          if (e.source === oldId) e.source = op.newName;
          if (e.target === oldId) e.target = op.newName;
        });
        nodes.forEach((node) => {
          node.columns.forEach((col) => {
            if (col.references?.table === oldId) {
              col.references = { ...col.references, table: op.newName };
            }
          });
        });
        break;
      }
    }
  }

  const scopeMap = new Map<string, { id: string; label: string; description: string; tables: number }>();
  nodes.forEach((node) => {
    if (!scopeMap.has(node.scope)) {
      scopeMap.set(node.scope, {
        id: node.scope,
        label: humanize(node.scope),
        description: `Entidades relacionadas a ${humanize(node.scope)}`,
        tables: 0,
      });
    }
    scopeMap.get(node.scope)!.tables += 1;
  });

  return {
    next: {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
      scopes: Array.from(scopeMap.values()),
    },
    warnings,
    notes,
  };
}

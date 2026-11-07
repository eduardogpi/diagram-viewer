import { z } from "zod";

import type { DiagramColumnDTO, DiagramNodeDTO, DiagramResponse } from "@/lib/types/diagram";

const columnSpecSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  isPrimary: z.boolean().optional().default(false),
  isNullable: z.boolean().optional().default(true),
  isUnique: z.boolean().optional(),
  /** Documentação da coluna (vira COMMENT no DDL exportado). */
  comment: z.string().max(1000).optional(),
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
    /** Documentação do propósito da tabela (vira COMMENT no DDL exportado). */
    comment: z.string().max(1000).optional(),
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
    newName: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    isNullable: z.boolean().optional(),
    isPrimary: z.boolean().optional(),
    isUnique: z.boolean().optional(),
    /** String vazia remove o comentário. */
    comment: z.string().max(1000).optional(),
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
  z.object({
    op: z.literal("createIndex"),
    table: z.string().min(1),
    name: z.string().min(1).optional(),
    columns: z.array(z.string().min(1)).min(1),
    isUnique: z.boolean().optional().default(false),
  }),
  z.object({
    op: z.literal("dropIndex"),
    table: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    /** Define/atualiza o comentário da tabela (sem `column`) ou de uma coluna. String vazia remove. */
    op: z.literal("setComment"),
    table: z.string().min(1),
    column: z.string().min(1).optional(),
    comment: z.string().max(1000),
  }),
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
 * Normaliza variações comuns de chaves geradas por diferentes LLMs (ex: `oldName`/`from` em vez de
 * `column`, `to`/`newColumn` em vez de `newName`, ou `addColumn` com `name`+`type` achatados).
 */
function normalizeRawOp(rawItem: unknown): unknown {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return rawItem;
  const obj = { ...(rawItem as Record<string, unknown>) };

  if (typeof obj.op === "string") {
    const opLower = obj.op.trim();
    if (opLower === "rename_column" || opLower === "renameField") obj.op = "renameColumn";
    else if (opLower === "rename_table") obj.op = "renameTable";
    else if (opLower === "alter_column" || opLower === "modifyColumn" || opLower === "changeColumn") {
      obj.op = "alterColumn";
    } else if (opLower === "add_column") obj.op = "addColumn";
    else if (opLower === "drop_column") obj.op = "dropColumn";
    else if (opLower === "create_index" || opLower === "addIndex") obj.op = "createIndex";
    else if (opLower === "drop_index" || opLower === "removeIndex") obj.op = "dropIndex";
    else if (
      opLower === "set_comment" ||
      opLower === "addComment" ||
      opLower === "comment" ||
      opLower === "commentTable" ||
      opLower === "commentColumn"
    ) {
      obj.op = "setComment";
    }
  }

  // Sinônimo comum para "comment" gerado por algumas LLMs.
  if (obj.comment === undefined && typeof obj.description === "string") obj.comment = obj.description;
  if (Array.isArray(obj.columns)) {
    obj.columns = obj.columns.map((c) =>
      c && typeof c === "object" && !Array.isArray(c) && (c as Record<string, unknown>).comment === undefined &&
      typeof (c as Record<string, unknown>).description === "string"
        ? { ...(c as Record<string, unknown>), comment: (c as Record<string, unknown>).description }
        : c
    );
  }

  if (obj.op === "createIndex") {
    const rawCols = obj.columns ?? obj.indexColumns ?? (typeof obj.column === "string" ? [obj.column] : undefined);
    if (Array.isArray(rawCols)) {
      obj.columns = rawCols
        .map((c) => (typeof c === "string" ? c : c && typeof c === "object" && "name" in c ? String((c as { name: unknown }).name) : ""))
        .filter(Boolean);
    }
  }

  if (obj.op === "renameColumn") {
    if (!obj.column) {
      obj.column = obj.oldName ?? obj.oldColumn ?? obj.old_name ?? obj.from;
    }
    if (!obj.newName) {
      obj.newName = obj.to ?? obj.newColumn ?? obj.new_name ?? obj.name;
    }
  } else if (obj.op === "renameTable") {
    if (!obj.table) {
      obj.table = obj.oldName ?? obj.oldTable ?? obj.old_name ?? obj.from;
    }
    if (!obj.newName) {
      obj.newName = obj.to ?? obj.newTable ?? obj.new_name ?? obj.name;
    }
  } else if (obj.op === "alterColumn") {
    if (!obj.column) {
      obj.column = obj.oldName ?? obj.oldColumn ?? obj.from ?? obj.name;
    }
    if (!obj.newName && typeof (obj.to ?? obj.newColumn ?? obj.new_name) === "string") {
      obj.newName = obj.to ?? obj.newColumn ?? obj.new_name;
    }
  } else if (obj.op === "addColumn" && !obj.newColumn) {
    const colName = obj.name ?? obj.column;
    if (typeof colName === "string" && typeof obj.type === "string") {
      obj.newColumn = {
        name: colName,
        type: obj.type,
        isPrimary: typeof obj.isPrimary === "boolean" ? obj.isPrimary : false,
        isNullable: typeof obj.isNullable === "boolean" ? obj.isNullable : true,
        isUnique: typeof obj.isUnique === "boolean" ? obj.isUnique : undefined,
        comment: typeof obj.comment === "string" ? obj.comment : undefined,
      };
    }
  }

  return obj;
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
    const parsedOp = schemaOpSchema.safeParse(normalizeRawOp(item));
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
    indexes: node.indexes ? node.indexes.map((idx) => ({ ...idx, columns: [...idx.columns] })) : undefined,
  };
}

function tableSuffix(id: string): string {
  const dot = id.lastIndexOf(".");
  return dot > 0 ? id.slice(dot + 1) : id;
}

function nodeMatches(node: DiagramNodeDTO, table: string): boolean {
  const t = table.toLowerCase();
  return (
    node.id.toLowerCase() === t ||
    node.label.toLowerCase() === t ||
    tableSuffix(node.id).toLowerCase() === t
  );
}

function findColumn(node: DiagramNodeDTO, columnName: string): DiagramColumnDTO | undefined {
  return (
    node.columns.find((c) => c.name === columnName) ??
    node.columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase())
  );
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
        if (nodes.has(op.table) || Array.from(nodes.keys()).some((k) => k.toLowerCase() === op.table.toLowerCase())) {
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
          ...(c.isUnique ? { isUnique: true } : {}),
          ...(c.comment?.trim() ? { comment: c.comment.trim() } : {}),
        }));
        // Salvaguarda: garante uma PK mínima mesmo se a LLM esquecer de incluir colunas.
        if (columns.length === 0) {
          columns.push({ name: "id", type: "BIGINT", isNullable: false, isPrimary: true, isForeign: false });
        }
        nodes.set(op.table, {
          id: op.table,
          label: qualified?.label ?? op.table,
          schema: "public",
          scope,
          ...(op.comment?.trim() ? { comment: op.comment.trim() } : {}),
          columns,
        });
        break;
      }
      case "addColumn": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        if (findColumn(found.node, op.newColumn.name)) {
          warnings.push({ op, reason: `Coluna "${op.newColumn.name}" já existe em "${found.node.id}"` });
          continue;
        }
        found.node.columns.push({
          name: op.newColumn.name,
          type: op.newColumn.type,
          isNullable: op.newColumn.isNullable,
          isPrimary: op.newColumn.isPrimary,
          isForeign: false,
          ...(op.newColumn.isUnique ? { isUnique: true } : {}),
          ...(op.newColumn.comment?.trim() ? { comment: op.newColumn.comment.trim() } : {}),
        });
        break;
      }
      case "alterColumn": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        const column = findColumn(found.node, op.column);
        if (!column) {
          warnings.push({ op, reason: `Coluna "${op.column}" não encontrada em "${found.node.id}"` });
          continue;
        }
        const wantsRename = op.newName !== undefined && op.newName !== column.name;
        if (
          !wantsRename &&
          op.type === undefined &&
          op.isNullable === undefined &&
          op.isPrimary === undefined &&
          op.isUnique === undefined &&
          op.comment === undefined
        ) {
          warnings.push({ op, reason: `Nada para alterar em "${found.node.id}.${op.column}"` });
          continue;
        }
        if (wantsRename && op.newName) {
          const conflict = found.node.columns.find(
            (c) => c !== column && c.name.toLowerCase() === op.newName!.toLowerCase()
          );
          if (conflict) {
            warnings.push({ op, reason: `Coluna "${op.newName}" já existe em "${found.node.id}"` });
            continue;
          }
          const oldColName = column.name;
          const tableId = found.node.id;
          const oldAutoConstraint = `fk_${tableId}_${oldColName}`.replace(/[^A-Za-z0-9_]+/g, "_");
          const newAutoConstraint = `fk_${tableId}_${op.newName}`.replace(/[^A-Za-z0-9_]+/g, "_");
          column.name = op.newName;
          if (column.fkMetadata?.constraintName === oldAutoConstraint) {
            column.fkMetadata = { ...column.fkMetadata, constraintName: newAutoConstraint };
          }
          if (found.node.indexes) {
            found.node.indexes.forEach((idx) => {
              idx.columns = idx.columns.map((c) => (c.toLowerCase() === oldColName.toLowerCase() ? op.newName! : c));
            });
          }
          for (const [edgeKey, e] of Array.from(edges.entries())) {
            let rekeyed = false;
            if (e.source === tableId) {
              const hadSource = e.columns.some((pair) => pair.source === oldColName);
              e.columns = e.columns.map((pair) => (pair.source === oldColName ? { ...pair, source: op.newName! } : pair));
              if (hadSource && e.constraint === oldAutoConstraint) {
                e.constraint = newAutoConstraint;
                e.id = `${e.source}-${e.target}-fk_${e.source}_${op.newName}`;
                rekeyed = true;
              }
            }
            if (e.target === tableId) {
              e.columns = e.columns.map((pair) => (pair.target === oldColName ? { ...pair, target: op.newName! } : pair));
            }
            if (rekeyed && edgeKey !== e.id) {
              edges.delete(edgeKey);
              edges.set(e.id, e);
            }
          }
          nodes.forEach((node) => {
            node.columns.forEach((col) => {
              if (col.references?.table === tableId && col.references.column === oldColName) {
                col.references = { table: tableId, column: op.newName! };
              }
            });
          });
        }
        if (op.type !== undefined) column.type = op.type;
        if (op.isNullable !== undefined) column.isNullable = op.isNullable;
        if (op.isPrimary !== undefined) column.isPrimary = op.isPrimary;
        if (op.isUnique !== undefined) column.isUnique = op.isUnique || undefined;
        if (op.comment !== undefined) column.comment = op.comment.trim() || undefined;
        break;
      }
      case "dropColumn": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        const targetCol = findColumn(found.node, op.column);
        if (!targetCol) {
          warnings.push({ op, reason: `Coluna "${op.column}" não encontrada em "${found.node.id}"` });
          continue;
        }
        const canonicalColName = targetCol.name;
        found.node.columns = found.node.columns.filter((c) => c !== targetCol);
        if (found.node.indexes) {
          found.node.indexes = found.node.indexes
            .map((idx) => ({
              ...idx,
              columns: idx.columns.filter((c) => c.toLowerCase() !== canonicalColName.toLowerCase()),
            }))
            .filter((idx) => idx.columns.length > 0);
        }
        dropEdgesFrom(found.node.id, canonicalColName);
        dropEdgesTo(found.node.id, canonicalColName);
        break;
      }
      case "renameColumn": {
        const found = findNode(nodes, op.table);
        const column = found && "node" in found ? findColumn(found.node, op.column) : undefined;
        if ("error" in found || !column) {
          warnings.push({
            op,
            reason: "error" in found ? found.error : `Coluna "${op.column}" não encontrada em "${op.table}"`,
          });
          continue;
        }
        const conflict = found.node.columns.find(
          (c) => c !== column && c.name.toLowerCase() === op.newName.toLowerCase()
        );
        if (conflict) {
          warnings.push({ op, reason: `Coluna "${op.newName}" já existe em "${found.node.id}"` });
          continue;
        }
        const oldColName = column.name;
        const tableId = found.node.id;
        const oldAutoConstraint = `fk_${tableId}_${oldColName}`.replace(/[^A-Za-z0-9_]+/g, "_");
        const newAutoConstraint = `fk_${tableId}_${op.newName}`.replace(/[^A-Za-z0-9_]+/g, "_");
        column.name = op.newName;
        if (column.fkMetadata?.constraintName === oldAutoConstraint) {
          column.fkMetadata = { ...column.fkMetadata, constraintName: newAutoConstraint };
        }
        if (found.node.indexes) {
          found.node.indexes.forEach((idx) => {
            idx.columns = idx.columns.map((c) => (c.toLowerCase() === oldColName.toLowerCase() ? op.newName : c));
          });
        }
        for (const [edgeKey, e] of Array.from(edges.entries())) {
          let rekeyed = false;
          if (e.source === tableId) {
            const hadSource = e.columns.some((pair) => pair.source === oldColName);
            e.columns = e.columns.map((pair) => (pair.source === oldColName ? { ...pair, source: op.newName } : pair));
            if (hadSource && e.constraint === oldAutoConstraint) {
              e.constraint = newAutoConstraint;
              e.id = `${e.source}-${e.target}-fk_${e.source}_${op.newName}`;
              rekeyed = true;
            }
          }
          if (e.target === tableId) {
            e.columns = e.columns.map((pair) => (pair.target === oldColName ? { ...pair, target: op.newName } : pair));
          }
          if (rekeyed && edgeKey !== e.id) {
            edges.delete(edgeKey);
            edges.set(e.id, e);
          }
        }
        nodes.forEach((node) => {
          node.columns.forEach((col) => {
            if (col.references?.table === tableId && col.references.column === oldColName) {
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
        const column = findColumn(sourceNode, op.column);
        if (!column) {
          warnings.push({ op, reason: `Coluna "${op.column}" não encontrada em "${sourceNode.id}"` });
          continue;
        }
        const targetColumn = findColumn(targetNode, op.referencesColumn);
        if (!targetColumn) {
          warnings.push({
            op,
            reason: `Coluna referenciada "${op.referencesColumn}" não encontrada em "${targetNode.id}"`,
          });
          continue;
        }
        if (!targetColumn.isPrimary) {
          notes.push(
            `Coluna "${targetNode.id}.${targetColumn.name}" não é chave primária — a FK pode não ser aplicável no banco`
          );
        }
        if (sourceNode.scope !== targetNode.scope) {
          notes.push(
            `FK cruzada entre escopos "${sourceNode.scope}" e "${targetNode.scope}" — o banco não garante essa constraint`
          );
        }
        column.isForeign = true;
        column.references = { table: targetNode.id, column: targetColumn.name };
        const onDelete = normalizeAction(op.onDelete);
        const onUpdate = normalizeAction(op.onUpdate);
        const constraintName = `fk_${sourceNode.id}_${column.name}`.replace(/[^A-Za-z0-9_]+/g, "_");
        if (onDelete || onUpdate) {
          column.fkMetadata = {
            constraintName,
            onDelete: onDelete && isFkAction(onDelete) ? onDelete : "NO ACTION",
            onUpdate: onUpdate && isFkAction(onUpdate) ? onUpdate : "NO ACTION",
          };
        }
        const edgeId = `${sourceNode.id}-${targetNode.id}-fk_${sourceNode.id}_${column.name}`;
        edges.set(edgeId, {
          id: edgeId,
          source: sourceNode.id,
          target: targetNode.id,
          scope: sourceNode.scope,
          constraint: `fk_${sourceNode.id}_${column.name}`.replace(/[^A-Za-z0-9_]+/g, "_"),
          columns: [{ source: column.name, target: targetColumn.name }],
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
        const col = findColumn(found.node, op.column);
        dropEdgesFrom(found.node.id, col ? col.name : op.column);
        break;
      }
      case "createIndex": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        const resolvedCols: string[] = [];
        let missingCol: string | null = null;
        for (const colName of op.columns) {
          const c = findColumn(found.node, colName);
          if (!c) {
            missingCol = colName;
            break;
          }
          resolvedCols.push(c.name);
        }
        if (missingCol) {
          warnings.push({ op, reason: `Coluna "${missingCol}" não encontrada em "${found.node.id}"` });
          continue;
        }
        const idxName =
          op.name?.trim() ||
          `${op.isUnique ? "uq" : "idx"}_${found.node.label}_${resolvedCols.join("_")}`.replace(
            /[^A-Za-z0-9_]+/g,
            "_"
          );
        const list = found.node.indexes ?? [];
        const existingIdx = list.findIndex((idx) => idx.name.toLowerCase() === idxName.toLowerCase());
        const entry = { name: idxName, columns: resolvedCols, ...(op.isUnique ? { isUnique: true } : {}) };
        if (existingIdx >= 0) {
          list[existingIdx] = entry;
        } else {
          list.push(entry);
        }
        found.node.indexes = list;
        if (op.isUnique && resolvedCols.length === 1) {
          const singleCol = findColumn(found.node, resolvedCols[0]);
          if (singleCol) singleCol.isUnique = true;
        }
        break;
      }
      case "dropIndex": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        const list = found.node.indexes ?? [];
        const removed = list.filter((idx) => idx.name.toLowerCase() === op.name.toLowerCase());
        const remaining = list.filter((idx) => idx.name.toLowerCase() !== op.name.toLowerCase());
        found.node.indexes = remaining;
        if (removed.length === 0) {
          warnings.push({ op, reason: `Índice "${op.name}" não encontrado em "${found.node.id}"` });
        } else {
          for (const rem of removed) {
            if (rem.isUnique && rem.columns.length === 1) {
              const colName = rem.columns[0];
              const stillUnique = remaining.some(
                (idx) => idx.isUnique && idx.columns.length === 1 && idx.columns[0].toLowerCase() === colName.toLowerCase()
              );
              if (!stillUnique) {
                const col = findColumn(found.node, colName);
                if (col) col.isUnique = false;
              }
            }
          }
        }
        break;
      }
      case "setComment": {
        const found = findNode(nodes, op.table);
        if ("error" in found) {
          warnings.push({ op, reason: found.error });
          continue;
        }
        const text = op.comment.trim() || undefined;
        if (op.column) {
          const column = findColumn(found.node, op.column);
          if (!column) {
            warnings.push({ op, reason: `Coluna "${op.column}" não encontrada em "${found.node.id}"` });
            continue;
          }
          column.comment = text;
        } else {
          found.node.comment = text;
        }
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
        const dotIndex = op.newName.lastIndexOf(".");
        if (dotIndex > 0) {
          found.node.scope = op.newName.slice(0, dotIndex);
        } else if (!oldId.includes(".")) {
          found.node.scope = deriveScope(op.newName);
        }
        found.node.columns.forEach((col) => {
          const oldAuto = `fk_${oldId}_${col.name}`.replace(/[^A-Za-z0-9_]+/g, "_");
          if (col.fkMetadata?.constraintName === oldAuto) {
            col.fkMetadata = {
              ...col.fkMetadata,
              constraintName: `fk_${op.newName}_${col.name}`.replace(/[^A-Za-z0-9_]+/g, "_"),
            };
          }
        });
        nodes.set(op.newName, found.node);
        for (const [edgeKey, e] of Array.from(edges.entries())) {
          const wasSource = e.source === oldId;
          const wasTarget = e.target === oldId;
          if (wasSource) {
            const firstCol = e.columns[0]?.source;
            const oldAuto = firstCol ? `fk_${oldId}_${firstCol}`.replace(/[^A-Za-z0-9_]+/g, "_") : "";
            e.source = op.newName;
            e.scope = found.node.scope;
            if (firstCol && e.constraint === oldAuto) {
              e.constraint = `fk_${op.newName}_${firstCol}`.replace(/[^A-Za-z0-9_]+/g, "_");
            }
          }
          if (wasTarget) e.target = op.newName;
          if (wasSource || wasTarget) {
            const firstCol = e.columns[0]?.source;
            e.id = firstCol ? `${e.source}-${e.target}-fk_${e.source}_${firstCol}` : `${e.source}-${e.target}-${e.constraint}`;
            if (edgeKey !== e.id) {
              edges.delete(edgeKey);
              edges.set(e.id, e);
            }
          }
        }
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

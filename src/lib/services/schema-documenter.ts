import { documentationCoverage, type DocumentationGap } from "@/lib/schema-documentation";
import type { SchemaOp } from "@/lib/services/schema-ops";
import type { DiagramResponse } from "@/lib/types/diagram";

/**
 * Documentação em lote: pede à LLM comentários só para o que ainda não tem, em lotes pequenos de
 * tabelas (um schema legado inteiro numa resposta só estoura o limite de tokens), e converte a
 * resposta em operações `setComment` — que passam pelo mesmo caminho revisável/desfazível das
 * outras operações do chat.
 */

export const DOCUMENT_BATCH_SIZE = 8;
/** Teto de tabelas por execução, para limitar custo/tempo; o resto fica para a próxima rodada. */
export const DOCUMENT_MAX_TABLES_PER_RUN = 40;
const MAX_COMMENT_LENGTH = 300;
const MAX_CONTEXT_TABLE_NAMES = 200;

export const DOCUMENTER_SYSTEM_INSTRUCTION = `Você documenta schemas de banco de dados relacionais, em português do Brasil.
Para cada tabela e coluna pedida, escreva um comentário curto (uma frase, até ~120 caracteres) explicando o PROPÓSITO dela no negócio, deduzido do nome, do tipo, das chaves e dos relacionamentos.
Regras:
- Documente SOMENTE os alvos listados em "Pedidos". Não comente nada fora da lista.
- Não invente regras de negócio específicas (valores, prazos, políticas). Se o significado for incerto, descreva o que o nome indica de forma neutra.
- Não repita o nome da coluna nem o tipo como comentário ("Coluna status" é inútil). Para FKs, diga o que é referenciado ("Cliente dono do pedido").
- Responda SOMENTE com JSON válido, sem markdown, no formato:
{"comments": [{"table": "<id da tabela>", "comment": "..."}, {"table": "<id da tabela>", "column": "<coluna>", "comment": "..."}]}`;

export type DocumentBatch = { gaps: DocumentationGap[] };

/** Divide as lacunas em lotes, respeitando o teto por execução. */
export function planDocumentationBatches(
  diagram: DiagramResponse,
  options: { tables?: string[]; batchSize?: number; maxTables?: number } = {}
): { batches: DocumentBatch[]; selected: number; remaining: number } {
  const wanted = options.tables?.length ? new Set(options.tables.map((t) => t.toLowerCase())) : null;
  const gaps = documentationCoverage(diagram).gaps.filter((gap) => {
    if (!wanted) return true;
    const node = diagram.nodes.find((n) => n.id === gap.table);
    return wanted.has(gap.table.toLowerCase()) || (node ? wanted.has(node.label.toLowerCase()) : false);
  });
  const maxTables = options.maxTables ?? DOCUMENT_MAX_TABLES_PER_RUN;
  const batchSize = Math.max(1, options.batchSize ?? DOCUMENT_BATCH_SIZE);
  const selectedGaps = gaps.slice(0, maxTables);

  const batches: DocumentBatch[] = [];
  for (let i = 0; i < selectedGaps.length; i += batchSize) {
    batches.push({ gaps: selectedGaps.slice(i, i + batchSize) });
  }
  return { batches, selected: selectedGaps.length, remaining: gaps.length - selectedGaps.length };
}

/** Prompt de um lote: estrutura das tabelas do lote + nomes das demais para contexto. */
export function buildDocumentationPrompt(diagram: DiagramResponse, batch: DocumentBatch): string {
  const inBatch = new Set(batch.gaps.map((g) => g.table));
  const tables = batch.gaps
    .map((gap) => diagram.nodes.find((n) => n.id === gap.table))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((node) => ({
      id: node.id,
      scope: node.scope,
      ...(node.comment ? { comment: node.comment } : {}),
      columns: node.columns.map((c) => ({
        name: c.name,
        type: c.type,
        ...(c.isPrimary ? { pk: true } : {}),
        ...(c.isNullable ? {} : { notNull: true }),
        ...(c.isUnique ? { unique: true } : {}),
        ...(c.references ? { references: `${c.references.table}.${c.references.column}` } : {}),
        ...(c.comment ? { comment: c.comment } : {}),
      })),
    }));

  const others = diagram.nodes
    .filter((n) => !inBatch.has(n.id))
    .slice(0, MAX_CONTEXT_TABLE_NAMES)
    .map((n) => (n.comment ? `${n.id} — ${n.comment}` : n.id));

  const requests = batch.gaps.flatMap((gap) => [
    ...(gap.missingTableComment ? [`- tabela ${gap.table}`] : []),
    ...gap.missingColumns.map((col) => `- coluna ${gap.table}.${col}`),
  ]);

  return [
    `Tabelas deste lote (JSON):\n${JSON.stringify(tables)}`,
    others.length > 0 ? `Outras tabelas do modelo (só contexto):\n${others.join("\n")}` : null,
    `Pedidos:\n${requests.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Lê a lista de comentários da resposta. Se o JSON vier cortado (limite de tokens), resgata os
 * objetos `{...}` completos que já chegaram — cada item é independente, então perder só a cauda
 * não deveria descartar o lote inteiro.
 */
function extractComments(text: string): unknown[] | null {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = unfenced.indexOf("{");
  if (start < 0) return null;
  const end = unfenced.lastIndexOf("}");
  try {
    const parsed = JSON.parse(end > start ? unfenced.slice(start, end + 1) : unfenced.slice(start)) as {
      comments?: unknown;
    };
    if (Array.isArray(parsed?.comments)) return parsed.comments;
  } catch {
    // segue para o resgate abaixo
  }

  const salvaged: unknown[] = [];
  for (const match of unfenced.matchAll(/\{(?:[^{}"]|"(?:[^"\\]|\\.)*")*\}/g)) {
    try {
      salvaged.push(JSON.parse(match[0]));
    } catch {
      // objeto malformado: ignora
    }
  }
  return salvaged.length > 0 ? salvaged : null;
}

/**
 * Converte a resposta da LLM em `setComment`, aceitando só alvos que estavam no lote — a LLM
 * nunca sobrescreve um comentário existente nem documenta algo que não foi pedido.
 */
export function parseDocumentationReply(text: string, batch: DocumentBatch): SchemaOp[] {
  const raw = extractComments(text);
  if (!raw) return [];

  const tables = new Map(batch.gaps.map((g) => [g.table.toLowerCase(), g]));
  const seen = new Set<string>();
  const ops: SchemaOp[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { table, column, comment } = item as { table?: unknown; column?: unknown; comment?: unknown };
    if (typeof table !== "string" || typeof comment !== "string") continue;
    const value = comment.trim().slice(0, MAX_COMMENT_LENGTH);
    if (!value) continue;
    const gap = tables.get(table.toLowerCase());
    if (!gap) continue;

    if (typeof column === "string" && column.trim()) {
      const target = gap.missingColumns.find((c) => c.toLowerCase() === column.trim().toLowerCase());
      if (!target) continue;
      const key = `${gap.table}.${target}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ops.push({ op: "setComment", table: gap.table, column: target, comment: value });
    } else {
      if (!gap.missingTableComment || seen.has(gap.table.toLowerCase())) continue;
      seen.add(gap.table.toLowerCase());
      ops.push({ op: "setComment", table: gap.table, comment: value });
    }
  }
  return ops;
}

import { generateText, resolveLlmTarget } from "@/lib/services/llm";
import { loadMigrationRange, loadMigrationSummaryInput, loadPackageSummaryIndex } from "@/lib/services/migrations";
import type {
  MigrationChunkSummaryResult,
  MigrationPackageOverviewResult,
  MigrationPackageSummaryPlan,
  MigrationSnapshotStats,
  MigrationSummaryChunkPlan,
  MigrationSummaryInput,
  MigrationSummaryItem,
  MigrationSummaryResult,
} from "@/lib/types/migrations";

/** Máximo de SQL da migration alvo embutido no prompt. */
const MAX_TARGET_SQL = 12_000;
/** Máximo de SQL de cada migration vizinha (elas são só contexto). */
const MAX_NEIGHBOR_SQL = 2_500;
/** Vizinhas de cada lado que entram no prompt — as mais próximas são as mais relevantes. */
const MAX_NEIGHBORS_PER_SIDE = 5;

export const MIGRATION_SUMMARY_SYSTEM_INSTRUCTION = `Você é um engenheiro de dados sênior analisando migrations de banco de dados.
Responda em português do Brasil, de forma técnica, direta e organizada.
Baseie-se exclusivamente no SQL e nas estatísticas fornecidos — nunca invente tabelas, colunas ou intenções que não estejam no material.
Quando o SQL não deixar claro o propósito, diga o que está ambíguo em vez de supor.`;

function truncateSql(sql: string, max: number): string {
  const trimmed = sql.trim();
  if (trimmed.length <= max) return trimmed;
  const omitted = trimmed.length - max;
  return `${trimmed.slice(0, max)}\n-- … (${omitted} caracteres omitidos)`;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

/** Descreve o efeito de uma migration no schema a partir da estatística do parser. */
export function describeStats(stats: MigrationSnapshotStats | null): string {
  if (!stats) return "sem estatística de schema";

  const parts: string[] = [];
  if (stats.addedTables.length > 0) parts.push(`+${stats.addedTables.length} tabela(s): ${stats.addedTables.join(", ")}`);
  if (stats.alteredTables.length > 0) parts.push(`~${stats.alteredTables.length} alterada(s): ${stats.alteredTables.join(", ")}`);
  if (stats.removedTables.length > 0) parts.push(`-${stats.removedTables.length} removida(s): ${stats.removedTables.join(", ")}`);
  if (stats.addedEdges > 0) parts.push(`${stats.addedEdges} FK(s) adicionada(s)`);
  if (stats.removedEdges > 0) parts.push(`${stats.removedEdges} FK(s) removida(s)`);
  if (parts.length === 0) parts.push("nenhuma mudança de tabela/FK detectada");

  return `${parts.join("; ")} · total acumulado ${stats.tables} tabela(s), ${stats.columns} coluna(s), ${stats.edges} FK(s)`;
}

function neighborSection(title: string, items: MigrationSummaryItem[]): string {
  return [
    `### ${title}`,
    ...items.map(
      (item) =>
        `- #${item.order} ${item.name}\n  efeito: ${describeStats(item.stats)}\n  SQL (trecho):\n${indent(
          truncateSql(item.content, MAX_NEIGHBOR_SQL)
        )}`
    ),
  ].join("\n");
}

/**
 * Monta o prompt do resumo. Função pura (sem banco/LLM) para poder ser testada isoladamente.
 * As vizinhas são cortadas em `MAX_NEIGHBORS_PER_SIDE` de cada lado — as mais próximas da alvo.
 */
export function buildMigrationSummaryPrompt(input: MigrationSummaryInput): string {
  const before = input.before.slice(-MAX_NEIGHBORS_PER_SIDE);
  const after = input.after.slice(0, MAX_NEIGHBORS_PER_SIDE);

  const sections: string[] = [
    `Pacote de migrations: "${input.packageName}" (${input.totalFiles} migrations, formato ${input.sourceProvider}).`,
    `Estado do schema: ${input.tablesBefore} tabela(s) antes desta migration, ${input.tablesAfter} depois.`,
  ];

  if (before.length > 0) {
    sections.push(neighborSection("Migrations ANTERIORES (contexto — já aplicadas antes da alvo)", before));
  }

  sections.push(
    [
      `### MIGRATION ALVO: #${input.target.order} ${input.target.name}`,
      `Efeito no schema: ${describeStats(input.target.stats)}`,
      input.target.stats && input.target.stats.schemaWarnings > 0
        ? `Atenção: o parser não reconheceu ${input.target.stats.schemaWarnings} statement(s) desta migration — pode haver mudança não capturada.`
        : null,
      "SQL completo:",
      truncateSql(input.target.content, MAX_TARGET_SQL),
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n")
  );

  if (after.length > 0) {
    sections.push(neighborSection("Migrations POSTERIORES (contexto — aplicadas depois da alvo)", after));
  }

  sections.push(
    [
      "### Tarefa",
      "Explique esta migration em português, sem inventar nada que não esteja no SQL:",
      "1. Resumo em 1-2 frases do que ela faz e qual problema parece resolver.",
      "2. Mudanças concretas no schema (tabelas, colunas e chaves estrangeiras criadas, alteradas ou removidas), citando os nomes reais.",
      "3. Riscos e observações (ex.: perda de dados, coluna NOT NULL sem default, tabela sem FK, dependência das migrations vizinhas).",
      "Use as migrations anteriores/posteriores apenas como contexto para entender a intenção — o foco é a migration alvo.",
    ].join("\n")
  );

  return sections.join("\n\n");
}

/**
 * Gera o resumo de uma migration via LLM. Devolve null quando o package/migration não existe.
 */
export async function summarizeMigration({
  packageId,
  connectionId,
  ownerId,
  order,
  before,
  after,
  provider,
  model,
}: {
  packageId: string;
  connectionId: string;
  ownerId: string;
  order: number;
  before: number;
  after: number;
  provider?: string;
  model?: string;
}): Promise<MigrationSummaryResult | null> {
  const input = await loadMigrationSummaryInput({ packageId, connectionId, ownerId, order, before, after });
  if (!input) return null;

  const target = await resolveLlmTarget(provider, model);
  const result = await generateText(target.provider, {
    model: target.model,
    systemInstruction: MIGRATION_SUMMARY_SYSTEM_INSTRUCTION,
    prompt: buildMigrationSummaryPrompt(input),
  });

  return {
    summary: result.text,
    truncated: result.truncated,
    provider: target.provider,
    model: target.model,
    context: {
      before: Math.min(input.before.length, MAX_NEIGHBORS_PER_SIDE),
      after: Math.min(input.after.length, MAX_NEIGHBORS_PER_SIDE),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Resumo de TODAS as migrations do package (map-reduce)
//
// Um package real tem centenas de arquivos e vários MB de SQL — não cabe num prompt. Então:
//   1. plano: agrupa migrations consecutivas em lotes que cabem no contexto;
//   2. cada lote vira um resumo detalhado, por migration (chamadas independentes e retentáveis);
//   3. a visão geral é gerada só a partir do trecho "Resumo do bloco" de cada lote.
// O documento final = visão geral + o detalhamento de cada lote, sem perder nenhuma migration.
// ---------------------------------------------------------------------------------------------

/** Orçamento de texto de um lote (SQL + cabeçalhos). */
const CHUNK_CHAR_BUDGET = 36_000;
/** Teto de SQL por migration dentro de um lote — migrations enormes (carga de dados) são truncadas. */
const CHUNK_SQL_PER_MIGRATION = 3_000;
/** Custo fixo de cada migration no prompt (nome, efeito, moldura). */
const CHUNK_ITEM_OVERHEAD = 400;
/** Seção que cada lote deve terminar — é o que alimenta a visão geral. */
export const CHUNK_DIGEST_HEADING = "## Resumo do bloco";
const MAX_DIGEST_CHARS = 1_800;

export const PACKAGE_SUMMARY_SYSTEM_INSTRUCTION = `${MIGRATION_SUMMARY_SYSTEM_INSTRUCTION}
Siga exatamente o formato pedido. Seja específico: cite nomes reais de tabelas e colunas, nunca generalidades.`;

/** Custo estimado (em caracteres do prompt) de uma migration dentro de um lote. */
function itemCost(chars: number): number {
  return Math.min(chars, CHUNK_SQL_PER_MIGRATION) + CHUNK_ITEM_OVERHEAD;
}

/**
 * Agrupa migrations consecutivas em lotes que cabem em `CHUNK_CHAR_BUDGET`. Determinístico: o
 * mesmo package gera sempre o mesmo plano, então o cliente pode pedir os lotes por índice.
 */
export function planSummaryChunks(
  items: Array<{ order: number; chars: number }>,
  budget = CHUNK_CHAR_BUDGET
): MigrationSummaryChunkPlan[] {
  const chunks: MigrationSummaryChunkPlan[] = [];
  let start = 0;
  let used = 0;

  items.forEach((item, position) => {
    const cost = itemCost(item.chars);
    // Lote vazio sempre aceita (uma migration sozinha pode estourar o orçamento — já vem truncada).
    if (position > start && used + cost > budget) {
      chunks.push({ index: chunks.length, fromOrder: items[start].order, toOrder: items[position - 1].order, count: position - start });
      start = position;
      used = 0;
    }
    used += cost;
  });

  if (items.length > 0) {
    chunks.push({ index: chunks.length, fromOrder: items[start].order, toOrder: items[items.length - 1].order, count: items.length - start });
  }
  return chunks;
}

export function buildChunkSummaryPrompt({
  packageName,
  sourceProvider,
  totalFiles,
  chunk,
  chunkCount,
  items,
}: {
  packageName: string;
  sourceProvider: string;
  totalFiles: number;
  chunk: MigrationSummaryChunkPlan;
  chunkCount: number;
  items: MigrationSummaryItem[];
}): string {
  const body = items
    .map(
      (item) =>
        `### #${item.order} ${item.name}\nEfeito: ${describeStats(item.stats)}\n${
          item.stats && item.stats.schemaWarnings > 0
            ? `Atenção: o parser não reconheceu ${item.stats.schemaWarnings} statement(s).\n`
            : ""
        }SQL:\n${truncateSql(item.content, CHUNK_SQL_PER_MIGRATION)}`
    )
    .join("\n\n");

  return [
    `Pacote de migrations "${packageName}" (${totalFiles} migrations, formato ${sourceProvider}).`,
    `Você está analisando o bloco ${chunk.index + 1} de ${chunkCount}: migrations #${chunk.fromOrder} a #${chunk.toOrder} (${items.length} arquivos).`,
    body,
    [
      "### Tarefa",
      "Gere o resumo detalhado deste bloco em português, neste formato exato:",
      "",
      "## Migrations",
      "Uma entrada para CADA migration acima, na ordem, sem pular nenhuma:",
      "- **#<ordem> <nome>** — o que faz, em 1-2 frases, citando tabelas/colunas/FKs reais (criadas, alteradas, removidas). Se for só carga de dados, índice, trigger ou sequence, diga isso.",
      "",
      CHUNK_DIGEST_HEADING,
      "3 a 5 tópicos curtos com os temas do bloco: quais módulos/tabelas nasceram ou mudaram, mudanças arriscadas (perda de dados, NOT NULL sem default, DROP) e padrões repetidos.",
      "",
      "Use só o SQL acima. Quando uma migration vier truncada, diga que o resumo dela é parcial.",
    ].join("\n"),
  ].join("\n\n");
}

/** Extrai a seção "Resumo do bloco" do texto do lote (ou o início do texto, se o modelo não a gerou). */
export function extractChunkDigest(summary: string): string {
  const at = summary.indexOf(CHUNK_DIGEST_HEADING);
  const digest = at >= 0 ? summary.slice(at + CHUNK_DIGEST_HEADING.length) : summary;
  return digest.trim().slice(0, MAX_DIGEST_CHARS);
}

export type PackageFacts = {
  packageName: string;
  sourceProvider: string;
  totalFiles: number;
  finalTables: number;
  finalColumns: number;
  finalEdges: number;
  migrationsWithWarnings: number;
  /** Migrations que mais criaram tabelas, para o modelo ancorar a narrativa em fatos. */
  biggestSchemaSteps: Array<{ order: number; name: string; addedTables: number }>;
};

/** Fatos objetivos do package, calculados a partir das estatísticas do parser (não do modelo). */
export function computePackageFacts(
  packageName: string,
  sourceProvider: string,
  items: Array<{ order: number; name: string; stats: MigrationSnapshotStats | null }>
): PackageFacts {
  const last = [...items].reverse().find((item) => item.stats)?.stats ?? null;
  return {
    packageName,
    sourceProvider,
    totalFiles: items.length,
    finalTables: last?.tables ?? 0,
    finalColumns: last?.columns ?? 0,
    finalEdges: last?.edges ?? 0,
    migrationsWithWarnings: items.filter((item) => (item.stats?.schemaWarnings ?? 0) > 0).length,
    biggestSchemaSteps: items
      .map((item) => ({ order: item.order, name: item.name, addedTables: item.stats?.addedTables.length ?? 0 }))
      .filter((step) => step.addedTables > 0)
      .sort((a, b) => b.addedTables - a.addedTables)
      .slice(0, 8),
  };
}

export function buildPackageOverviewPrompt(
  facts: PackageFacts,
  parts: Array<{ index: number; fromOrder: number; toOrder: number; summary: string }>
): string {
  const ordered = [...parts].sort((a, b) => a.index - b.index);
  return [
    `Pacote de migrations "${facts.packageName}" (${facts.totalFiles} migrations, formato ${facts.sourceProvider}).`,
    [
      "### Fatos do parser (confiáveis)",
      `- Schema final: ${facts.finalTables} tabelas, ${facts.finalColumns} colunas, ${facts.finalEdges} chaves estrangeiras.`,
      `- Migrations com statements não reconhecidos pelo parser: ${facts.migrationsWithWarnings}.`,
      facts.biggestSchemaSteps.length > 0
        ? `- Maiores criações de tabelas: ${facts.biggestSchemaSteps.map((s) => `#${s.order} (${s.addedTables})`).join(", ")}.`
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    "### Resumos dos blocos, em ordem cronológica",
    ordered
      .map((part) => `#### Migrations #${part.fromOrder} a #${part.toOrder}\n${extractChunkDigest(part.summary)}`)
      .join("\n\n"),
    [
      "### Tarefa",
      "Escreva a visão geral deste pacote em português, em markdown, com estas seções:",
      "## Visão geral — 1 parágrafo: o que é o sistema e como o schema evoluiu.",
      "## Domínios e módulos — os grupos de tabelas por assunto, com nomes reais.",
      "## Evolução cronológica — as fases do projeto, citando faixas de migrations (#a–#b).",
      "## Riscos e pontos de atenção — mudanças destrutivas, dívidas e inconsistências observadas.",
      "Baseie-se só nos resumos e fatos acima; não invente tabelas nem intenções.",
    ].join("\n"),
  ].join("\n\n");
}

export async function planPackageSummary(args: {
  packageId: string;
  connectionId: string;
  ownerId: string;
}): Promise<MigrationPackageSummaryPlan | null> {
  const index = await loadPackageSummaryIndex(args);
  if (!index) return null;
  return {
    packageName: index.packageName,
    checksum: index.checksum,
    totalFiles: index.items.length,
    chunks: planSummaryChunks(index.items),
  };
}

export async function summarizePackageChunk({
  packageId,
  connectionId,
  ownerId,
  index: chunkIndex,
  provider,
  model,
}: {
  packageId: string;
  connectionId: string;
  ownerId: string;
  index: number;
  provider?: string;
  model?: string;
}): Promise<MigrationChunkSummaryResult | null> {
  const index = await loadPackageSummaryIndex({ packageId, connectionId, ownerId });
  if (!index) return null;

  const chunks = planSummaryChunks(index.items);
  const chunk = chunks[chunkIndex];
  if (!chunk) return null;

  const items = await loadMigrationRange({ packageId, connectionId, ownerId, fromOrder: chunk.fromOrder, toOrder: chunk.toOrder });
  if (!items || items.length === 0) return null;

  const target = await resolveLlmTarget(provider, model);
  const result = await generateText(target.provider, {
    model: target.model,
    systemInstruction: PACKAGE_SUMMARY_SYSTEM_INSTRUCTION,
    prompt: buildChunkSummaryPrompt({
      packageName: index.packageName,
      sourceProvider: index.sourceProvider,
      totalFiles: index.items.length,
      chunk,
      chunkCount: chunks.length,
      items,
    }),
  });

  return {
    index: chunk.index,
    fromOrder: chunk.fromOrder,
    toOrder: chunk.toOrder,
    summary: result.text,
    truncated: result.truncated,
    provider: target.provider,
    model: target.model,
  };
}

export async function summarizePackageOverview({
  packageId,
  connectionId,
  ownerId,
  parts,
  provider,
  model,
}: {
  packageId: string;
  connectionId: string;
  ownerId: string;
  parts: Array<{ index: number; fromOrder: number; toOrder: number; summary: string }>;
  provider?: string;
  model?: string;
}): Promise<MigrationPackageOverviewResult | null> {
  const index = await loadPackageSummaryIndex({ packageId, connectionId, ownerId });
  if (!index) return null;

  const facts = computePackageFacts(index.packageName, index.sourceProvider, index.items);
  const target = await resolveLlmTarget(provider, model);
  const result = await generateText(target.provider, {
    model: target.model,
    systemInstruction: PACKAGE_SUMMARY_SYSTEM_INSTRUCTION,
    prompt: buildPackageOverviewPrompt(facts, parts),
  });

  return { overview: result.text, truncated: result.truncated, provider: target.provider, model: target.model };
}

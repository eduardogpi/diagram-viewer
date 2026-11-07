/**
 * Lacunas de documentação do modelo: tabelas sem `comment` e colunas sem `comment`.
 * Módulo puro (sem dependência de servidor) — usado pela UI, pelo MCP e pelo serviço que pede
 * à LLM para documentar em lote.
 */
export type DocumentationGap = {
  table: string;
  /** true = a própria tabela não tem comentário. */
  missingTableComment: boolean;
  /** Colunas sem comentário (PK "id" e colunas de auditoria triviais ficam de fora). */
  missingColumns: string[];
};

export type DocumentationCoverage = {
  tables: number;
  documentedTables: number;
  columns: number;
  documentedColumns: number;
  gaps: DocumentationGap[];
};

/**
 * Colunas cujo significado é óbvio pelo nome — não contam como lacuna para não forçar a LLM a
 * escrever "Identificador" e "Data de criação" centenas de vezes.
 */
const SELF_EXPLANATORY_COLUMNS = new Set([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "createdat",
  "updatedat",
  "deletedat",
  "data_criacao",
  "data_atualizacao",
  "dt_criacao",
  "dt_atualizacao",
]);

export function isSelfExplanatoryColumn(name: string): boolean {
  return SELF_EXPLANATORY_COLUMNS.has(name.toLowerCase());
}

/** Forma mínima aceita — compatível com `DiagramResponse` e com os payloads mais soltos da UI. */
export type DocumentableDiagram = {
  nodes: Array<{ id: string; comment?: string; columns: Array<{ name: string; comment?: string }> }>;
};

export function documentationCoverage(diagram: DocumentableDiagram): DocumentationCoverage {
  let columns = 0;
  let documentedColumns = 0;
  const gaps: DocumentationGap[] = [];

  for (const node of diagram.nodes) {
    const missingColumns: string[] = [];
    for (const column of node.columns) {
      columns += 1;
      if (column.comment?.trim()) documentedColumns += 1;
      else if (!isSelfExplanatoryColumn(column.name)) missingColumns.push(column.name);
    }
    const missingTableComment = !node.comment?.trim();
    if (missingTableComment || missingColumns.length > 0) {
      gaps.push({ table: node.id, missingTableComment, missingColumns });
    }
  }

  return {
    tables: diagram.nodes.length,
    documentedTables: diagram.nodes.filter((n) => n.comment?.trim()).length,
    columns,
    documentedColumns,
    gaps,
  };
}

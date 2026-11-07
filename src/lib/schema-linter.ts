import type { DiffableColumn, DiffableNode } from "@/lib/diagram-diff";

export type SchemaLintSeverity = "error" | "warning" | "info";

export type SchemaLintCode =
  | "missing-pk"
  | "fk-type-mismatch"
  | "dangling-fk"
  | "implicit-fk"
  | "mixed-naming";

export type SchemaLintIssue = {
  id: string;
  code: SchemaLintCode;
  severity: SchemaLintSeverity;
  tableId: string;
  tableLabel: string;
  columnName?: string;
  title: string;
  description: string;
  /** Prompt pronto para enviar ao assistente de Modelagem com IA para corrigir o problema. */
  suggestedPrompt: string;
};

type LintableDiagram = {
  nodes: Array<
    DiffableNode & {
      schema?: string;
      scope?: string;
    }
  >;
};

function normalizeBaseType(rawType: string): string {
  const upper = rawType.trim().toUpperCase().replace(/\s+/g, " ");
  const base = upper.replace(/\([^)]*\)/g, "").trim();
  if (base === "INT" || base === "INTEGER" || base === " INT4" || base === "SERIAL") return "INT";
  if (base === "BIGINT" || base === "INT8" || base === "BIGSERIAL") return "BIGINT";
  if (base === "SMALLINT" || base === "INT2" || base === "SMALLSERIAL") return "SMALLINT";
  if (base === "CHARACTER VARYING" || base === "VARCHAR") return "VARCHAR";
  if (base === "CHARACTER" || base === "CHAR") return "CHAR";
  if (base === "NUMERIC" || base === "DECIMAL") return "DECIMAL";
  return base;
}

function isSnakeCase(name: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name);
}

function isCamelCase(name: string): boolean {
  return /^[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*$/.test(name);
}

function candidateTableNames(fkColumnName: string): string[] {
  const base = fkColumnName.replace(/_id$/i, "").toLowerCase();
  if (!base) return [];
  return [
    base,
    `${base}s`,
    `${base}es`,
    base.endsWith("ao") ? `${base.slice(0, -2)}oes` : "",
  ].filter(Boolean);
}

/**
 * Analisa deterministicamente um diagrama de schema e retorna alertas de qualidade estrutural:
 * - Tabelas sem chave primária (`missing-pk`)
 * - Incompatibilidade de tipo entre coluna FK e PK referenciada (`fk-type-mismatch`)
 * - Referência de FK apontando para tabela/coluna inexistente (`dangling-fk`)
 * - Colunas `*_id` sem constraint de Foreign Key (`implicit-fk`)
 * - Mistura de `snake_case` e `camelCase` na mesma tabela (`mixed-naming`)
 */
export function lintDiagram(diagram: LintableDiagram): SchemaLintIssue[] {
  const issues: SchemaLintIssue[] = [];
  if (!diagram.nodes || diagram.nodes.length === 0) return issues;

  const nodeById = new Map<string, DiffableNode>();
  const nodeByLowerLabel = new Map<string, DiffableNode>();

  for (const node of diagram.nodes) {
    nodeById.set(node.id.toLowerCase(), node);
    nodeByLowerLabel.set(node.label.toLowerCase(), node);
  }

  for (const node of diagram.nodes) {
    const hasPk = node.columns.some((col) => col.isPrimary);
    if (!hasPk) {
      issues.push({
        id: `missing-pk:${node.id}`,
        code: "missing-pk",
        severity: "warning",
        tableId: node.id,
        tableLabel: node.label,
        title: `Tabela "${node.label}" sem chave primária`,
        description:
          "Tabelas sem PRIMARY KEY dificultam indexação por chave, replicação lógica e integridade referencial.",
        suggestedPrompt: `Adicione uma chave primária apropriada na tabela ${node.id}.`,
      });
    }

    let snakeCount = 0;
    let camelCount = 0;

    for (const col of node.columns) {
      if (isSnakeCase(col.name)) snakeCount += 1;
      if (isCamelCase(col.name)) camelCount += 1;

      if (col.isForeign && col.references) {
        const targetNode =
          nodeById.get(col.references.table.toLowerCase()) ??
          nodeByLowerLabel.get(col.references.table.toLowerCase());

        if (!targetNode) {
          issues.push({
            id: `dangling-fk:${node.id}.${col.name}`,
            code: "dangling-fk",
            severity: "error",
            tableId: node.id,
            tableLabel: node.label,
            columnName: col.name,
            title: `FK "${node.label}.${col.name}" aponta para tabela inexistente`,
            description: `A coluna referencia "${col.references.table}.${col.references.column}", mas a tabela "${col.references.table}" não existe no diagrama.`,
            suggestedPrompt: `Corrija a foreign key da coluna ${col.name} na tabela ${node.id} ou crie a tabela referenciada ${col.references.table}.`,
          });
        } else {
          const targetCol: DiffableColumn | undefined = targetNode.columns.find(
            (c) => c.name.toLowerCase() === col.references!.column.toLowerCase()
          );
          if (!targetCol) {
            issues.push({
              id: `dangling-fk:${node.id}.${col.name}`,
              code: "dangling-fk",
              severity: "error",
              tableId: node.id,
              tableLabel: node.label,
              columnName: col.name,
              title: `FK "${node.label}.${col.name}" aponta para coluna inexistente`,
              description: `A coluna referencia "${targetNode.label}.${col.references.column}", que não existe em "${targetNode.label}".`,
              suggestedPrompt: `Corrija a foreign key de ${node.id}.${col.name} para apontar para a chave primária correta de ${targetNode.id}.`,
            });
          } else if (normalizeBaseType(col.type) !== normalizeBaseType(targetCol.type)) {
            issues.push({
              id: `fk-type-mismatch:${node.id}.${col.name}`,
              code: "fk-type-mismatch",
              severity: "error",
              tableId: node.id,
              tableLabel: node.label,
              columnName: col.name,
              title: `Tipo incompatível na FK "${node.label}.${col.name}"`,
              description: `"${node.label}.${col.name}" é ${col.type}, mas "${targetNode.label}.${targetCol.name}" é ${targetCol.type}.`,
              suggestedPrompt: `Altere o tipo da coluna ${col.name} na tabela ${node.id} para ${targetCol.type} para ficar compatível com ${targetNode.id}.${targetCol.name}.`,
            });
          }
        }
      } else if (!col.isPrimary && !col.isForeign && /_id$/i.test(col.name)) {
        const candidates = candidateTableNames(col.name);
        const matchedTarget = candidates
          .map((cand) => nodeByLowerLabel.get(cand) ?? nodeById.get(cand))
          .find((n): n is DiffableNode => n !== undefined && n.id !== node.id);

        if (matchedTarget) {
          const targetPk = matchedTarget.columns.find((c) => c.isPrimary);
          const targetColName = targetPk?.name ?? "id";
          issues.push({
            id: `implicit-fk:${node.id}.${col.name}`,
            code: "implicit-fk",
            severity: "info",
            tableId: node.id,
            tableLabel: node.label,
            columnName: col.name,
            title: `Possível FK ausente em "${node.label}.${col.name}"`,
            description: `A coluna "${col.name}" parece referenciar a tabela "${matchedTarget.label}", mas não possui constraint de Foreign Key.`,
            suggestedPrompt: `Adicione uma foreign key na coluna ${col.name} da tabela ${node.id} referenciando ${matchedTarget.id}.${targetColName}.`,
          });
        }
      }
    }

    if (snakeCount > 0 && camelCount > 0) {
      issues.push({
        id: `mixed-naming:${node.id}`,
        code: "mixed-naming",
        severity: "info",
        tableId: node.id,
        tableLabel: node.label,
        title: `Convenção de nomes mista em "${node.label}"`,
        description: `A tabela mistura colunas em snake_case (${snakeCount}) e camelCase (${camelCount}).`,
        suggestedPrompt: `Padronize os nomes das colunas da tabela ${node.id} em snake_case.`,
      });
    }
  }

  const severityOrder: Record<SchemaLintSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

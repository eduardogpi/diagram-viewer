import type { DiagramResponse } from "@/lib/types/diagram";

export type DiagramDiffStatus = "added" | "altered" | "removed";

export type DiffableColumn = {
  name: string;
  type: string;
  isNullable?: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  isUnique?: boolean;
  comment?: string;
  references?: { table: string; column: string };
};

export type DiffableIndex = {
  name: string;
  columns: string[];
  isUnique?: boolean;
};

export type DiffableNode = {
  id: string;
  label: string;
  comment?: string;
  columns: DiffableColumn[];
  indexes?: DiffableIndex[];
};

export type DiffableDiagram = {
  nodes: DiffableNode[];
};

export type ColumnChangeDetail = {
  name: string;
  status: DiagramDiffStatus;
  /** Lista legível de mudanças (ex: ["tipo: VARCHAR(50) → VARCHAR(120)", "NOT NULL → NULL", "+PK"]). */
  changes: string[];
  previousType?: string;
  currentType?: string;
};

export type TableDetailedDiff = {
  tableId: string;
  status: DiagramDiffStatus;
  columns: Map<string, ColumnChangeDetail>;
  removedColumns: ColumnChangeDetail[];
};

function signatureOf(node: DiffableNode): string {
  return [
    node.label,
    node.columns
      .map(
        (c) =>
          `${c.name}:${c.type}:${c.isNullable === false ? "0" : "1"}:${c.isPrimary ? "1" : "0"}:${c.isUnique ? "1" : "0"}:${c.isForeign ? "1" : "0"}:${c.references ? `${c.references.table}.${c.references.column}` : ""}`
      )
      .join(","),
    (node.indexes ?? [])
      .map((idx) => `${idx.name}:${idx.isUnique ? "U" : "I"}:(${idx.columns.join(",")})`)
      .join(";"),
    // Comentários entram via JSON para que separadores no texto não colidam com os da assinatura.
    JSON.stringify([node.comment ?? "", node.columns.map((c) => c.comment ?? "")]),
  ].join("|");
}

function formatRef(col: DiffableColumn): string {
  if (!col.isForeign && !col.references) return "";
  if (col.references) return `${col.references.table}.${col.references.column}`;
  return "FK";
}

/**
 * Calcula o diff coluna-a-coluna entre duas versões da mesma tabela.
 * Retorna `null` quando a tabela não sofreu nenhuma mudança estrutural.
 */
export function computeTableColumnDiff(
  previousNode: DiffableNode | undefined | null,
  currentNode: DiffableNode | undefined | null
): TableDetailedDiff | null {
  if (!previousNode && !currentNode) return null;

  if (!previousNode && currentNode) {
    const columns = new Map<string, ColumnChangeDetail>();
    for (const col of currentNode.columns) {
      columns.set(col.name, {
        name: col.name,
        status: "added",
        changes: [`+${col.type}${col.isNullable === false ? " NOT NULL" : ""}`],
        currentType: col.type,
      });
    }
    return {
      tableId: currentNode.id,
      status: "added",
      columns,
      removedColumns: [],
    };
  }

  if (previousNode && !currentNode) {
    const columns = new Map<string, ColumnChangeDetail>();
    const removedColumns: ColumnChangeDetail[] = [];
    for (const col of previousNode.columns) {
      const detail: ColumnChangeDetail = {
        name: col.name,
        status: "removed",
        changes: [`-${col.type}`],
        previousType: col.type,
      };
      columns.set(col.name, detail);
      removedColumns.push(detail);
    }
    return {
      tableId: previousNode.id,
      status: "removed",
      columns,
      removedColumns,
    };
  }

  const prev = previousNode!;
  const curr = currentNode!;
  if (signatureOf(prev) === signatureOf(curr)) return null;

  const prevCols = new Map<string, DiffableColumn>();
  for (const col of prev.columns) {
    prevCols.set(col.name.toLowerCase(), col);
  }

  const currCols = new Map<string, DiffableColumn>();
  for (const col of curr.columns) {
    currCols.set(col.name.toLowerCase(), col);
  }

  const columns = new Map<string, ColumnChangeDetail>();
  const removedColumns: ColumnChangeDetail[] = [];

  for (const col of curr.columns) {
    const prevCol = prevCols.get(col.name.toLowerCase());
    if (!prevCol) {
      columns.set(col.name, {
        name: col.name,
        status: "added",
        changes: [`+${col.type}${col.isNullable === false ? " NOT NULL" : ""}`],
        currentType: col.type,
      });
      continue;
    }

    const changes: string[] = [];
    if (prevCol.name !== col.name) {
      changes.push(`nome: ${prevCol.name} → ${col.name}`);
    }
    if (prevCol.type !== col.type) {
      changes.push(`tipo: ${prevCol.type} → ${col.type}`);
    }
    const prevNotNull = prevCol.isNullable === false;
    const currNotNull = col.isNullable === false;
    if (prevNotNull !== currNotNull) {
      changes.push(`${prevNotNull ? "NOT NULL" : "NULL"} → ${currNotNull ? "NOT NULL" : "NULL"}`);
    }
    if (prevCol.isPrimary !== col.isPrimary) {
      changes.push(col.isPrimary ? "+PK" : "-PK");
    }
    if (Boolean(prevCol.isUnique) !== Boolean(col.isUnique)) {
      changes.push(col.isUnique ? "+UNIQUE" : "-UNIQUE");
    }
    if ((prevCol.comment ?? "") !== (col.comment ?? "")) {
      changes.push(col.comment ? (prevCol.comment ? "comentário alterado" : "+comentário") : "-comentário");
    }
    const prevRef = formatRef(prevCol);
    const currRef = formatRef(col);
    if (prevRef !== currRef) {
      if (!prevRef && currRef) {
        changes.push(`+FK → ${currRef}`);
      } else if (prevRef && !currRef) {
        changes.push(`-FK (${prevRef})`);
      } else {
        changes.push(`FK: ${prevRef} → ${currRef}`);
      }
    }

    if (changes.length > 0) {
      columns.set(col.name, {
        name: col.name,
        status: "altered",
        changes,
        previousType: prevCol.type,
        currentType: col.type,
      });
    }
  }

  for (const prevCol of prev.columns) {
    if (!currCols.has(prevCol.name.toLowerCase())) {
      const detail: ColumnChangeDetail = {
        name: prevCol.name,
        status: "removed",
        changes: [`-${prevCol.type}`],
        previousType: prevCol.type,
      };
      columns.set(prevCol.name, detail);
      removedColumns.push(detail);
    }
  }

  return {
    tableId: curr.id,
    status: "altered",
    columns,
    removedColumns,
  };
}

/**
 * Compara duas versões de um diagrama e retorna o diff detalhado (ao nível de coluna e constraint)
 * para cada tabela adicionada, alterada ou removida.
 */
export function computeDetailedDiagramDiff(
  previous: DiffableDiagram | null | undefined,
  current: DiffableDiagram
): Map<string, TableDetailedDiff> {
  const result = new Map<string, TableDetailedDiff>();
  if (!previous) {
    for (const node of current.nodes) {
      const diff = computeTableColumnDiff(null, node);
      if (diff) result.set(node.id, diff);
    }
    return result;
  }

  const prevById = new Map<string, DiffableNode>();
  for (const node of previous.nodes) {
    prevById.set(node.id, node);
  }
  const currById = new Map<string, DiffableNode>();
  for (const node of current.nodes) {
    currById.set(node.id, node);
  }

  for (const node of current.nodes) {
    const prevNode = prevById.get(node.id);
    const diff = computeTableColumnDiff(prevNode, node);
    if (diff) result.set(node.id, diff);
  }

  for (const prevNode of previous.nodes) {
    if (!currById.has(prevNode.id)) {
      const diff = computeTableColumnDiff(prevNode, null);
      if (diff) result.set(prevNode.id, diff);
    }
  }

  return result;
}

/** Compara duas versões de um DiagramResponse e retorna o status (added/altered/removed) de cada tabela. */
export function computeDiagramDiff(
  previous: DiagramResponse | null,
  current: DiagramResponse
): Map<string, DiagramDiffStatus> {
  const map = new Map<string, DiagramDiffStatus>();
  if (!previous) {
    current.nodes.forEach((node) => map.set(node.id, "added"));
    return map;
  }

  const prevIds = new Set(previous.nodes.map((n) => n.id));
  const prevSignatures = new Map(previous.nodes.map((n) => [n.id, signatureOf(n)]));

  current.nodes.forEach((node) => {
    if (!prevIds.has(node.id)) {
      map.set(node.id, "added");
    } else if (prevSignatures.get(node.id) !== signatureOf(node)) {
      map.set(node.id, "altered");
    }
  });

  prevIds.forEach((id) => {
    if (!current.nodes.some((n) => n.id === id)) {
      map.set(id, "removed");
    }
  });

  return map;
}

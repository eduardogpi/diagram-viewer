export type CytoscapeSizingMode = "uniform" | "degree" | "columns";
export type CytoscapeLayoutMode = "cose" | "dagre-tb" | "dagre-lr" | "concentric" | "breadthfirst";

export type CyColumnInput = {
  name: string;
  type: string;
  isNullable?: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  isUnique?: boolean;
  comment?: string;
  references?: { table: string; column: string };
};

export type CyTableNodeInput = {
  id: string;
  label: string;
  schema: string;
  scope: string;
  comment?: string;
  columns: CyColumnInput[];
  indexes?: Array<{ name: string; columns: string[]; isUnique?: boolean }>;
};

export type CyRelationshipInput = {
  id: string;
  source: string;
  target: string;
  scope: string;
  constraint: string;
  columns: Array<{ source: string; target: string }>;
  cardinality?: string;
  onDelete?: string;
  onUpdate?: string;
};

export type CyScopeInput = {
  id: string;
  label: string;
  description: string;
  tables: number;
};

export type CyDiffStatus = "added" | "altered" | "removed" | undefined;

export type CyElementData = {
  id: string;
  label: string;
  parent?: string;
  source?: string;
  target?: string;
  isScope?: boolean;
  scope?: string;
  schema?: string;
  scopeColor?: string;
  scopeBorder?: string;
  scopeFill?: string;
  borderColor?: string;
  bgColor?: string;
  diffStatus?: string;
  degree?: number;
  inDegree?: number;
  outDegree?: number;
  columnCount?: number;
  pkCount?: number;
  fkCount?: number;
  uqCount?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  crossScope?: boolean;
  edgeLabel?: string;
  constraint?: string;
  cardinality?: string;
  /** Comentário/documentação da tabela (texto completo, para o tooltip). */
  comment?: string;
  documentedColumns?: number;
};

/**
 * Marcador desenhado ao lado do nome quando a tabela (ou alguma coluna) tem documentação. O texto
 * em si fica no tooltip: o canvas do Cytoscape não quebra bem textos longos.
 */
export const CY_DOC_ICON = "ⓘ";

export type CyElementDef = {
  group: "nodes" | "edges";
  data: CyElementData;
  classes?: string;
};

const SCOPE_COLORS = ["#22d3ee", "#34d399", "#f97316", "#facc15", "#fb7185", "#a78bfa"];

export function scopeToneFor(scopeId: string) {
  const index = Array.from(scopeId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % SCOPE_COLORS.length;
  const color = SCOPE_COLORS[index];
  return { color, border: `${color}99`, fill: `${color}14` };
}

function humanizeScope(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function scopeParentId(scope: string): string {
  return `cy-scope:${scope}`;
}

export function buildCytoscapeElements(params: {
  nodes: CyTableNodeInput[];
  edges: CyRelationshipInput[];
  scopes?: CyScopeInput[];
  diffMap?: Map<string, CyDiffStatus>;
  sizingMode?: CytoscapeSizingMode;
  showKeyColumns?: boolean;
  useCompoundScopes?: boolean;
}): CyElementDef[] {
  const {
    nodes,
    edges,
    scopes = [],
    diffMap,
    sizingMode = "degree",
    showKeyColumns = true,
    useCompoundScopes = true,
  } = params;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
  }

  const validEdges = edges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target));
  for (const edge of validEdges) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const byScope = new Map<string, CyTableNodeInput[]>();
  for (const node of nodes) {
    if (!byScope.has(node.scope)) byScope.set(node.scope, []);
    byScope.get(node.scope)!.push(node);
  }

  const hasMultipleScopes = useCompoundScopes && byScope.size > 1;
  const scopeMeta = new Map(scopes.map((s) => [s.id, s]));
  const elements: CyElementDef[] = [];

  if (hasMultipleScopes) {
    for (const [scopeId, list] of byScope.entries()) {
      const tone = scopeToneFor(scopeId);
      const title = scopeMeta.get(scopeId)?.label || humanizeScope(scopeId);
      elements.push({
        group: "nodes",
        classes: "cy-scope",
        data: {
          id: scopeParentId(scopeId),
          label: `${title} (${list.length})`,
          isScope: true,
          scope: scopeId,
          scopeColor: tone.color,
          scopeBorder: tone.border,
          scopeFill: tone.fill,
        },
      });
    }
  }

  for (const node of nodes) {
    const tone = scopeToneFor(node.scope);
    const status = diffMap?.get(node.id);
    const inDeg = inDegree.get(node.id) ?? 0;
    const outDeg = outDegree.get(node.id) ?? 0;
    const totalDeg = inDeg + outDeg;

    const pkCols = node.columns.filter((c) => c.isPrimary);
    const fkCols = node.columns.filter((c) => c.isForeign);
    const uqCols = node.columns.filter((c) => c.isUnique && !c.isPrimary);

    const keyLines: string[] = [];
    if (showKeyColumns) {
      const importantCols = node.columns.filter((c) => c.isPrimary || c.isForeign || c.isUnique).slice(0, 5);
      for (const col of importantCols) {
        const tag = col.isPrimary ? "PK" : col.isForeign ? "FK" : "UQ";
        keyLines.push(`[${tag}] ${col.name}: ${col.type}`);
      }
      const extraKeys =
        node.columns.filter((c) => c.isPrimary || c.isForeign || c.isUnique).length - importantCols.length;
      if (extraKeys > 0) {
        keyLines.push(`+${extraKeys} chave(s)...`);
      }
    }

    const metricsLine = `${node.columns.length} col · ${pkCols.length} PK · ${fkCols.length} FK${
      uqCols.length > 0 ? ` · ${uqCols.length} UQ` : ""
    }`;

    const documented = Boolean(node.comment?.trim()) || node.columns.some((c) => c.comment?.trim());
    const header = `${documented ? `${node.label}  ${CY_DOC_ICON}` : node.label}\n${metricsLine}`;
    const fullLabel = keyLines.length > 0 ? `${header}\n${"─".repeat(18)}\n${keyLines.join("\n")}` : header;

    let baseWidth = 190;
    let baseHeight = keyLines.length > 0 ? 68 + keyLines.length * 15 : 64;

    if (sizingMode === "degree") {
      const bonus = Math.min(totalDeg * 10, 70);
      baseWidth += bonus;
      baseHeight += Math.min(totalDeg * 4, 28);
    } else if (sizingMode === "columns") {
      const bonus = Math.min(node.columns.length * 4, 64);
      baseWidth += bonus;
      baseHeight += Math.min(node.columns.length * 2, 24);
    }

    const borderColor =
      status === "added"
        ? "#34d399"
        : status === "altered"
          ? "#fbbf24"
          : status === "removed"
            ? "#fb7185"
            : tone.color;

    const bgColor =
      status === "added"
        ? "#064e3b"
        : status === "altered"
          ? "#451a03"
          : status === "removed"
            ? "#4c0519"
            : "#0f172a";

    const classes = ["cy-table"];
    if (status) classes.push(`diff-${status}`);
    if (totalDeg >= 4) classes.push("cy-hub");

    elements.push({
      group: "nodes",
      classes: classes.join(" "),
      data: {
        id: node.id,
        label: fullLabel,
        parent: hasMultipleScopes ? scopeParentId(node.scope) : undefined,
        isScope: false,
        scope: node.scope,
        schema: node.schema,
        scopeColor: tone.color,
        borderColor,
        bgColor,
        diffStatus: status ?? "",
        degree: totalDeg,
        inDegree: inDeg,
        outDegree: outDeg,
        columnCount: node.columns.length,
        pkCount: pkCols.length,
        fkCount: fkCols.length,
        uqCount: uqCols.length,
        nodeWidth: baseWidth,
        nodeHeight: baseHeight,
        ...(node.comment?.trim() ? { comment: node.comment.trim() } : {}),
        documentedColumns: node.columns.filter((c) => c.comment?.trim()).length,
      },
    });
  }

  for (const edge of validEdges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const crossScope = Boolean(sourceNode && targetNode && sourceNode.scope !== targetNode.scope);
    const colMapping =
      edge.columns.length > 0
        ? edge.columns.map((pair) => `${pair.source} → ${pair.target}`).join(", ")
        : edge.constraint;
    const edgeLabel = edge.cardinality ? `${colMapping} (${edge.cardinality})` : colMapping;

    elements.push({
      group: "edges",
      classes: crossScope ? "cy-edge cy-edge-cross" : "cy-edge",
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edgeLabel,
        edgeLabel,
        constraint: edge.constraint,
        cardinality: edge.cardinality ?? "N:1",
        crossScope,
      },
    });
  }

  return elements;
}

export type JoinPathStep = {
  fromTable: string;
  toTable: string;
  edgeId: string;
  constraint: string;
  onClause: string;
};

export type JoinPathResult = {
  found: boolean;
  nodeIds: string[];
  edgeIds: string[];
  steps: JoinPathStep[];
  sql: string;
};

/**
 * Encontra o menor caminho de chaves estrangeiras (BFS não-direcionado) entre duas tabelas
 * e gera a consulta SQL com os JOINs correspondentes.
 */
export function findShortestJoinPath(
  nodes: CyTableNodeInput[],
  edges: CyRelationshipInput[],
  startTableId: string,
  endTableId: string
): JoinPathResult {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (!nodeById.has(startTableId) || !nodeById.has(endTableId)) {
    return { found: false, nodeIds: [], edgeIds: [], steps: [], sql: "" };
  }

  if (startTableId === endTableId) {
    const startNode = nodeById.get(startTableId)!;
    return {
      found: true,
      nodeIds: [startTableId],
      edgeIds: [],
      steps: [],
      sql: `SELECT *\nFROM ${startNode.label} t0;`,
    };
  }

  type NeighborStep = { neighborId: string; edge: CyRelationshipInput; direction: "forward" | "reverse" };
  const adj = new Map<string, NeighborStep[]>();
  for (const n of nodes) adj.set(n.id, []);

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    adj.get(edge.source)!.push({ neighborId: edge.target, edge, direction: "forward" });
    adj.get(edge.target)!.push({ neighborId: edge.source, edge, direction: "reverse" });
  }

  const visited = new Set<string>([startTableId]);
  const parentMap = new Map<string, { prevNodeId: string; step: NeighborStep }>();
  const queue: string[] = [startTableId];

  let reached = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === endTableId) {
      reached = true;
      break;
    }
    for (const step of adj.get(current) ?? []) {
      if (!visited.has(step.neighborId)) {
        visited.add(step.neighborId);
        parentMap.set(step.neighborId, { prevNodeId: current, step });
        queue.push(step.neighborId);
      }
    }
  }

  if (!reached) {
    return { found: false, nodeIds: [], edgeIds: [], steps: [], sql: "" };
  }

  const pathNodeIds: string[] = [endTableId];
  const pathEdgeIds: string[] = [];
  const rawSteps: Array<{ fromId: string; toId: string; step: NeighborStep }> = [];

  let cursor = endTableId;
  while (cursor !== startTableId) {
    const entry = parentMap.get(cursor)!;
    rawSteps.unshift({ fromId: entry.prevNodeId, toId: cursor, step: entry.step });
    pathNodeIds.unshift(entry.prevNodeId);
    pathEdgeIds.unshift(entry.step.edge.id);
    cursor = entry.prevNodeId;
  }

  const aliasByTableId = new Map<string, string>();
  pathNodeIds.forEach((id, idx) => {
    aliasByTableId.set(id, `t${idx}`);
  });

  const steps: JoinPathStep[] = [];
  const startNode = nodeById.get(startTableId)!;
  const sqlLines: string[] = [`SELECT t0.*, t${pathNodeIds.length - 1}.*`, `FROM ${startNode.label} t0`];

  for (const item of rawSteps) {
    const fromNode = nodeById.get(item.fromId)!;
    const toNode = nodeById.get(item.toId)!;
    const fromAlias = aliasByTableId.get(item.fromId)!;
    const toAlias = aliasByTableId.get(item.toId)!;
    const pairs = item.step.edge.columns;

    let onClause: string;
    if (pairs.length > 0) {
      onClause = pairs
        .map((p) =>
          item.step.direction === "forward"
            ? `${fromAlias}.${p.source} = ${toAlias}.${p.target}`
            : `${toAlias}.${p.source} = ${fromAlias}.${p.target}`
        )
        .join(" AND ");
    } else {
      onClause = `${fromAlias}.id = ${toAlias}.id`;
    }

    steps.push({
      fromTable: fromNode.label,
      toTable: toNode.label,
      edgeId: item.step.edge.id,
      constraint: item.step.edge.constraint,
      onClause,
    });
    sqlLines.push(`JOIN ${toNode.label} ${toAlias} ON ${onClause}`);
  }

  return {
    found: true,
    nodeIds: pathNodeIds,
    edgeIds: pathEdgeIds,
    steps,
    sql: `${sqlLines.join("\n")};`,
  };
}

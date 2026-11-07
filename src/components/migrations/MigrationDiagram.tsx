"use client";

import dagre from "@dagrejs/dagre";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeDragHandler,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { ChevronDown, Filter, LayoutGrid, Maximize2, Minimize2, Network, PencilRuler, Waypoints, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CytoscapeDiagram from "@/components/migrations/CytoscapeDiagram";
import {
  computeDetailedDiagramDiff,
  type ColumnChangeDetail,
  type TableDetailedDiff,
} from "@/lib/diagram-diff";

const EDGE_COLOR = "#0891b2";
const EDGE_COLOR_SELECTED = "#22d3ee";
const SCOPE_COLORS = ["#22d3ee", "#34d399", "#f97316", "#facc15", "#fb7185", "#a78bfa"];
const GROUP_PAD = 28;
const GROUP_HEADER = 36;

function colorFor(scopeId: string) {
  const index = Array.from(scopeId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % SCOPE_COLORS.length;
  const color = SCOPE_COLORS[index];
  return { color, border: `${color}88`, fill: `${color}18` };
}

function humanizeScope(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

type Column = {
  name: string;
  type: string;
  isNullable?: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  isUnique?: boolean;
  comment?: string;
  references?: { table: string; column: string };
};
type TableIndex = { name: string; columns: string[]; isUnique?: boolean };
type TableNode = {
  id: string;
  label: string;
  schema: string;
  scope: string;
  comment?: string;
  columns: Column[];
  indexes?: TableIndex[];
};
type Relationship = {
  id: string;
  source: string;
  target: string;
  scope: string;
  constraint: string;
  columns: Array<{ source: string; target: string }>;
  cardinality?: "1:1" | "1:N" | "N:1";
  onDelete?: string;
  onUpdate?: string;
};
type Scope = { id: string; label: string; description: string; tables: number };
type Payload = { nodes: TableNode[]; edges: Relationship[]; scopes: Scope[] };

type NodeData = {
  label: string;
  schema: string;
  scope: string;
  comment?: string;
  columns: Column[];
  status?: "added" | "altered" | "removed";
  detailedDiff?: TableDetailedDiff;
  /** Posições (0-1) dos handles de entrada/saída, distribuídas quando o nó tem múltiplas relações. */
  topHandlePositions: number[];
  bottomHandlePositions: number[];
  /** true = extremidade da seleção atual (linha ou "mostrar relações"); false = existe seleção mas este nó não participa. */
  emphasized?: boolean;
  /** true = este nó tem ao menos uma relação (FK) de entrada ou saída. */
  hasRelations?: boolean;
  /** true = o botão "mostrar todas as relações" deste nó está ativo. */
  relationsActive?: boolean;
  onShowRelations?: (nodeId: string) => void;
  tone?: { color: string; border: string; fill: string };
};

type GroupNodeData = {
  label: string;
  tables: number;
  tone: { color: string; border: string; fill: string };
};

type DiffStatus = "added" | "altered" | "removed" | undefined;

const NODE_W = 320;
const NODE_H_BASE = 48;
const NODE_H_PER_COLUMN = 22;
/**
 * O comentário da tabela aparece inteiro no card (quebrando linha), então a altura usada no
 * layout precisa estimar quantas linhas ele ocupa — senão o dagre posiciona os cards por cima uns
 * dos outros. Estimativa por caracteres: texto 11px itálico na largura útil do card (~296px).
 */
const COMMENT_CHARS_PER_LINE = 46;
const COMMENT_LINE_H = 17;
const COMMENT_PADDING_H = 8;

function commentLineCount(comment: string): number {
  return comment
    .split(/\r?\n/)
    .reduce((total, paragraph) => total + Math.max(1, Math.ceil(paragraph.trim().length / COMMENT_CHARS_PER_LINE)), 0);
}

function nodeHeight(node: { columns: unknown[]; comment?: string }): number {
  const comment = node.comment?.trim();
  const commentH = comment ? COMMENT_PADDING_H + commentLineCount(comment) * COMMENT_LINE_H : 0;
  return NODE_H_BASE + node.columns.length * NODE_H_PER_COLUMN + commentH;
}

const STATUS_BORDER: Record<NonNullable<DiffStatus>, string> = {
  added: "border-emerald-400",
  altered: "border-amber-400",
  removed: "border-rose-400 opacity-60",
};

const STATUS_DOT: Record<NonNullable<DiffStatus>, string> = {
  added: "bg-emerald-400",
  altered: "bg-amber-400",
  removed: "bg-rose-400",
};

const GroupNodeComponent = memo(function GroupNodeComponent({ data }: NodeProps<GroupNodeData>) {
  return (
    <div
      className="h-full w-full rounded-3xl border-2"
      style={{
        borderColor: data.tone.border,
        background: data.tone.fill,
        boxShadow: `inset 0 0 0 1px ${data.tone.color}22`,
      }}
    >
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: data.tone.color }} />
        <span className="truncate text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: data.tone.color }}>
          {data.label}
        </span>
        <span className="text-[10px] text-slate-500">({data.tables})</span>
      </div>
    </div>
  );
});

const TableNodeComponent = memo(function TableNodeComponent({ id, data }: NodeProps<NodeData>) {
  const status = data.status;
  const tone = data.tone ?? colorFor(data.scope);
  const borderClass = status ? STATUS_BORDER[status] : "";
  const topHandles = data.topHandlePositions.length > 0 ? data.topHandlePositions : [0.5];
  const bottomHandles = data.bottomHandlePositions.length > 0 ? data.bottomHandlePositions : [0.5];
  const emphasizedClass = data.emphasized
    ? "ring-2 ring-cyan-300 ring-offset-2 ring-offset-[var(--color-bg-layer-1)]"
    : "";

  return (
    <div
      className={`rounded-xl border bg-slate-950/90 shadow-lg transition-shadow ${borderClass} ${emphasizedClass}`}
      style={{ width: NODE_W, borderColor: status ? undefined : tone.border }}
    >
      {topHandles.map((pct, i) => (
        <Handle
          key={`t-${i}`}
          id={`t-${i}`}
          type="target"
          position={Position.Top}
          style={{ left: `${pct * 100}%`, background: tone.color }}
          className="!w-2 !h-2"
        />
      ))}
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        {status ? <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} /> : (
          <span className="h-2 w-2 rounded-full" style={{ background: tone.color }} />
        )}
        <span className="truncate text-sm font-semibold text-slate-100">{data.label}</span>
        {data.hasRelations ? (
          <button
            type="button"
            title="Mostrar todas as relações desta tabela"
            onClick={(e) => {
              e.stopPropagation();
              data.onShowRelations?.(id);
            }}
            className={`nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
              data.relationsActive
                ? "border-cyan-300 bg-cyan-400/20 text-cyan-200"
                : "border-slate-700 text-slate-500 hover:border-cyan-400 hover:text-cyan-300"
            }`}
          >
            <Waypoints className="h-3 w-3" />
          </button>
        ) : null}
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">{data.scope}</span>
      </div>
      {data.comment ? (
        <div className="whitespace-pre-wrap break-words border-b border-slate-800 px-3 py-1 text-[11px] italic leading-[17px] text-slate-400">
          {data.comment}
        </div>
      ) : null}
      <div className="max-h-[280px] overflow-y-auto">
        {data.columns.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-500">sem colunas</div>
        ) : (
          data.columns.map((col) => {
            const colDiff: ColumnChangeDetail | undefined =
              status === "altered" ? data.detailedDiff?.columns.get(col.name) : undefined;
            const rowClass =
              colDiff?.status === "added"
                ? "bg-emerald-500/10"
                : colDiff?.status === "altered"
                  ? "bg-amber-500/10"
                  : "";
            const titleText =
              [col.comment, colDiff ? colDiff.changes.join(" · ") : undefined].filter(Boolean).join("\n") || undefined;
            return (
              <div
                key={col.name}
                title={titleText}
                className={`flex items-center gap-2 border-b border-slate-900/60 px-3 py-1 text-xs ${rowClass}`}
              >
                <span className="w-4 text-center">
                  {col.isPrimary ? (
                    <span className="text-amber-300" title="Primary key">
                      PK
                    </span>
                  ) : col.isForeign ? (
                    <span className="text-cyan-300" title="Foreign key">
                      FK
                    </span>
                  ) : col.isUnique ? (
                    <span className="text-violet-300" title="Unique constraint">
                      UQ
                    </span>
                  ) : null}
                </span>
                {colDiff?.status === "added" ? (
                  <span className="shrink-0 font-mono text-[10px] font-bold text-emerald-400" title={titleText}>
                    +
                  </span>
                ) : colDiff?.status === "altered" ? (
                  <span className="shrink-0 font-mono text-[10px] font-bold text-amber-400" title={titleText}>
                    ~
                  </span>
                ) : null}
                <span className="truncate text-slate-200">{col.name}</span>
                {col.comment ? (
                  <span className="shrink-0 text-[10px] text-slate-500" aria-label="Coluna documentada">
                    ⓘ
                  </span>
                ) : null}
                <span className="ml-auto truncate text-slate-500">
                  {colDiff?.status === "altered" && colDiff.previousType && colDiff.previousType !== col.type ? (
                    <span>
                      <span className="line-through opacity-60">{colDiff.previousType}</span>{" "}
                      <span className="text-amber-300">{col.type}</span>
                    </span>
                  ) : (
                    col.type
                  )}
                </span>
              </div>
            );
          })
        )}
        {status === "altered" && data.detailedDiff && data.detailedDiff.removedColumns.length > 0 ? (
          <div
            className="border-t border-rose-500/20 bg-rose-500/10 px-3 py-1 text-[11px] text-rose-300"
            title={data.detailedDiff.removedColumns.map((c) => `${c.name} (${c.previousType ?? ""})`).join(", ")}
          >
            − {data.detailedDiff.removedColumns.map((c) => c.name).join(", ")}
          </div>
        ) : null}
      </div>
      {bottomHandles.map((pct, i) => (
        <Handle
          key={`s-${i}`}
          id={`s-${i}`}
          type="source"
          position={Position.Bottom}
          style={{ left: `${pct * 100}%`, background: tone.color }}
          className="!w-2 !h-2"
        />
      ))}
    </div>
  );
});

const nodeTypes = { table: TableNodeComponent, group: GroupNodeComponent };

function groupNodeId(scope: string): string {
  return `scope-group:${scope}`;
}

function layoutNodes(
  nodes: TableNode[],
  edges: Relationship[],
  scopes: Scope[],
  diffMap?: Map<string, DiffStatus>,
  detailedDiffMap?: Map<string, TableDetailedDiff>
) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80, ranker: "network-simplex" });
  g.setDefaultEdgeLabel(() => ({}));

  const byScope = new Map<string, TableNode[]>();
  nodes.forEach((node) => {
    if (!byScope.has(node.scope)) byScope.set(node.scope, []);
    byScope.get(node.scope)!.push(node);
  });

  nodes.forEach((node) => {
    const height = nodeHeight(node);
    g.setNode(node.id, { width: NODE_W, height });
  });
  edges.forEach((edge) => {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  const xOf = (id: string) => g.node(id)?.x ?? 0;

  // Agrupa as relações de cada nó por direção (saída = handles embaixo, entrada = handles em cima)
  // e ordena pela posição x do nó do outro lado, para distribuir os pontos de conexão da
  // esquerda pra direita e separar visualmente as linhas quando há mais de uma relação.
  const outgoingByNode = new Map<string, Relationship[]>();
  const incomingByNode = new Map<string, Relationship[]>();
  edges.forEach((edge) => {
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) return;
    if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
    outgoingByNode.get(edge.source)!.push(edge);
    if (!incomingByNode.has(edge.target)) incomingByNode.set(edge.target, []);
    incomingByNode.get(edge.target)!.push(edge);
  });

  const sourceHandleIndex = new Map<string, number>();
  const targetHandleIndex = new Map<string, number>();
  outgoingByNode.forEach((list) => {
    [...list]
      .sort((a, b) => xOf(a.target) - xOf(b.target))
      .forEach((edge, idx) => sourceHandleIndex.set(edge.id, idx));
  });
  incomingByNode.forEach((list) => {
    [...list]
      .sort((a, b) => xOf(a.source) - xOf(b.source))
      .forEach((edge, idx) => targetHandleIndex.set(edge.id, idx));
  });

  function handlePositions(count: number): number[] {
    if (count <= 1) return [0.5];
    const start = 0.18;
    const end = 0.82;
    return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1));
  }

  const showGroups = byScope.size > 1;
  const scopeMeta = new Map(scopes.map((scope) => [scope.id, scope]));
  const groupBounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();

  if (showGroups) {
    nodes.forEach((node) => {
      const pos = g.node(node.id);
      const height = nodeHeight(node);
      const left = (pos?.x ?? 0) - NODE_W / 2;
      const top = (pos?.y ?? 0) - height / 2;
      const current = groupBounds.get(node.scope) ?? { minX: left, minY: top, maxX: left + NODE_W, maxY: top + height };
      groupBounds.set(node.scope, {
        minX: Math.min(current.minX, left),
        minY: Math.min(current.minY, top),
        maxX: Math.max(current.maxX, left + NODE_W),
        maxY: Math.max(current.maxY, top + height),
      });
    });
  }

  const groupNodes: Node<GroupNodeData>[] = showGroups
    ? Array.from(groupBounds.entries()).map(([scope, box]) => {
        const tone = colorFor(scope);
        const width = box.maxX - box.minX + GROUP_PAD * 2;
        const height = box.maxY - box.minY + GROUP_PAD * 2 + GROUP_HEADER;
        return {
          id: groupNodeId(scope),
          type: "group",
          position: { x: box.minX - GROUP_PAD, y: box.minY - GROUP_PAD - GROUP_HEADER },
          data: {
            label: scopeMeta.get(scope)?.label || humanizeScope(scope),
            tables: byScope.get(scope)?.length ?? 0,
            tone,
          },
          style: { width, height, zIndex: -1 },
          selectable: false,
          draggable: false,
        };
      })
    : [];

  const rfNodes: Node<NodeData>[] = nodes.map((node) => {
    const pos = g.node(node.id);
    const status = diffMap?.get(node.id);
    const height = nodeHeight(node);
    const absX = (pos?.x ?? 0) - NODE_W / 2;
    const absY = (pos?.y ?? 0) - height / 2;
    const parentId = showGroups ? groupNodeId(node.scope) : undefined;
    const box = parentId ? groupBounds.get(node.scope) : undefined;
    return {
      id: node.id,
      type: "table",
      parentNode: parentId,
      extent: undefined,
      position: parentId && box
        ? { x: absX - (box.minX - GROUP_PAD), y: absY - (box.minY - GROUP_PAD - GROUP_HEADER) }
        : { x: absX, y: absY },
      data: {
        label: node.label,
        schema: node.schema,
        scope: node.scope,
        comment: node.comment,
        columns: node.columns,
        status,
        detailedDiff: detailedDiffMap?.get(node.id),
        tone: colorFor(node.scope),
        topHandlePositions: handlePositions(incomingByNode.get(node.id)?.length ?? 0),
        bottomHandlePositions: handlePositions(outgoingByNode.get(node.id)?.length ?? 0),
        hasRelations:
          (outgoingByNode.get(node.id)?.length ?? 0) + (incomingByNode.get(node.id)?.length ?? 0) > 0,
      },
    };
  });

  const rfEdges: Edge<Relationship>[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: `s-${sourceHandleIndex.get(edge.id) ?? 0}`,
    targetHandle: `t-${targetHandleIndex.get(edge.id) ?? 0}`,
    type: "smoothstep",
    animated: false,
    data: edge,
    style: { stroke: EDGE_COLOR, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 14, height: 14 },
  }));

  return { rfNodes: [...groupNodes, ...rfNodes], rfEdges };
}

function NodePanel({
  node,
  relationCount,
  detailedDiff,
  showColumnList = false,
  floatingOverlay = false,
  onFocus,
  onEdit,
  onClose,
}: {
  node: TableNode;
  relationCount: number;
  detailedDiff?: TableDetailedDiff;
  showColumnList?: boolean;
  floatingOverlay?: boolean;
  onFocus?: () => void;
  onEdit?: () => void;
  onClose: () => void;
}) {
  const columnChanges = detailedDiff
    ? Array.from(detailedDiff.columns.values())
    : [];

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-[0.26em] text-slate-500">Tabela selecionada</p>
            {detailedDiff?.status === "added" ? (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                nova
              </span>
            ) : detailedDiff?.status === "altered" ? (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                alterada
              </span>
            ) : null}
          </div>
          <h4 className="mt-2 truncate text-base font-semibold text-white">{node.label}</h4>
          <p className="mt-1 truncate font-mono text-xs text-slate-500">{node.schema}</p>
          {node.comment ? (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{node.comment}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Fechar painel"
          className="flex-shrink-0 rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {onFocus || onEdit ? (
        <div className="mt-3 flex gap-2">
          {onFocus ? (
            <button
              type="button"
              onClick={onFocus}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-400"
            >
              Centralizar
            </button>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:border-cyan-300"
            >
              <PencilRuler className="h-3.5 w-3.5" /> Editar tabela
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] text-slate-500">Colunas</p>
          <p className="mt-0.5 font-semibold text-white">{node.columns.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] text-slate-500">Relações</p>
          <p className="mt-0.5 font-semibold text-white">{relationCount}</p>
        </div>
      </div>

      {showColumnList && node.columns.length > 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Colunas ({node.columns.length})
          </p>
          <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto pr-1 text-xs">
            {node.columns.map((col) => (
              <li key={col.name} className="flex items-center justify-between gap-2 font-mono" title={col.comment}>
                <span className="truncate text-slate-200">
                  {col.isPrimary ? (
                    <span className="mr-1 text-[10px] text-amber-300">PK</span>
                  ) : col.isForeign ? (
                    <span className="mr-1 text-[10px] text-cyan-300">FK</span>
                  ) : col.isUnique ? (
                    <span className="mr-1 text-[10px] text-violet-300">UQ</span>
                  ) : null}
                  {col.name}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">{col.type}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {node.indexes && node.indexes.length > 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Índices / Unique ({node.indexes.length})
          </p>
          <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto pr-1 text-xs">
            {node.indexes.map((idx) => (
              <li key={idx.name} className="flex items-center justify-between gap-2 font-mono">
                <span className="truncate text-slate-200" title={idx.name}>
                  {idx.isUnique ? <span className="mr-1 text-[10px] text-violet-300">UQ</span> : null}
                  {idx.name}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">({idx.columns.join(", ")})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detailedDiff?.status === "altered" && columnChanges.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            Mudanças de coluna ({columnChanges.length})
          </p>
          <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1 text-xs">
            {columnChanges.map((change) => (
              <li key={change.name} className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-mono">
                  <span
                    className={
                      change.status === "added"
                        ? "font-bold text-emerald-400"
                        : change.status === "altered"
                          ? "font-bold text-amber-400"
                          : "font-bold text-rose-400"
                    }
                  >
                    {change.status === "added" ? "+" : change.status === "altered" ? "~" : "−"}
                  </span>
                  <span
                    className={
                      change.status === "removed"
                        ? "truncate text-rose-300 line-through"
                        : "truncate text-slate-100"
                    }
                  >
                    {change.name}
                  </span>
                </div>
                {change.changes.length > 0 ? (
                  <p className="pl-3.5 text-[11px] text-slate-400">{change.changes.join(" · ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );

  if (floatingOverlay) {
    return (
      <div className="absolute right-4 top-4 z-30 w-[320px] rounded-2xl border border-slate-700 bg-slate-950/92 p-4 text-sm text-slate-300 shadow-2xl backdrop-blur-md">
        {content}
      </div>
    );
  }

  return (
    <Panel
      position="top-right"
      className="w-[320px] rounded-2xl border border-slate-700 bg-slate-950/92 p-4 text-sm text-slate-300 shadow-2xl"
    >
      {content}
    </Panel>
  );
}

function EdgePanel({
  edge,
  floatingOverlay = false,
  onClose,
}: {
  edge: Edge<Relationship>;
  floatingOverlay?: boolean;
  onClose: () => void;
}) {
  const data = edge.data;
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.26em] text-slate-500">Relacionamento</p>
          <h4 className="mt-2 truncate text-sm font-semibold text-white">{data?.constraint}</h4>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {edge.source} → {edge.target}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Fechar painel"
          className="flex-shrink-0 rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] text-slate-500">Cardinalidade</p>
          <p className="mt-0.5 font-semibold text-white">{data?.cardinality ?? "Não informado"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] text-slate-500">Delete / Update</p>
          <p className="mt-0.5 text-white">
            {data?.onDelete ?? "Padrão"} / {data?.onUpdate ?? "Padrão"}
          </p>
        </div>
      </div>

      {data && data.columns.length > 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] text-slate-500">Mapeamento de colunas</p>
          <div className="mt-2 space-y-1.5">
            {data.columns.map((pair) => (
              <div key={`${pair.source}-${pair.target}`} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-mono text-cyan-200">{pair.source}</span>
                <span className="text-slate-500">→</span>
                <span className="font-mono text-emerald-200">{pair.target}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );

  if (floatingOverlay) {
    return (
      <div className="absolute bottom-4 right-4 z-30 w-[340px] rounded-2xl border border-slate-700 bg-slate-950/92 p-4 text-sm text-slate-300 shadow-2xl backdrop-blur-md">
        {content}
      </div>
    );
  }

  return (
    <Panel
      position="bottom-right"
      className="mb-4 w-[340px] rounded-2xl border border-slate-700 bg-slate-950/92 p-4 text-sm text-slate-300 shadow-2xl"
    >
      {content}
    </Panel>
  );
}

type Selection = { type: "edge"; id: string } | { type: "node"; id: string } | null;

type Props = {
  diagram: Payload;
  previousDiagram?: Payload | null;
  diffMap?: Map<string, DiffStatus>;
  height?: number | string;
  /** false = esconde o botão interno de tela cheia (quando o pai controla seu próprio fullscreen). */
  showFullscreenButton?: boolean;
  /** Quando informado, a seleção do canvas sincroniza com o pai (ex: inspector da modelagem). */
  selectedNodeId?: string | null;
  onSelectedNodeChange?: (nodeId: string | null) => void;
  /** true = não mostra o painel da tabela selecionada (ex: o pai abriu um editor no mesmo lugar). */
  hideNodePanel?: boolean;
  /** Quando informado, o painel da tabela ganha o botão "Editar tabela". */
  onEditNode?: (nodeId: string) => void;
};

export default function MigrationDiagram({
  diagram,
  previousDiagram,
  diffMap,
  height = 560,
  showFullscreenButton = true,
  selectedNodeId,
  onSelectedNodeChange,
  hideNodePanel = false,
  onEditNode,
}: Props) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<"er" | "cytoscape">("er");
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [hiddenScopes, setHiddenScopes] = useState<Set<string>>(new Set());
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [manualPositions, setManualPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [prevDiagram, setPrevDiagram] = useState(diagram);
  if (prevDiagram !== diagram) {
    setPrevDiagram(diagram);
    setSelection(null);
    setManualPositions(new Map());
  }

  const [prevSelectedNodeId, setPrevSelectedNodeId] = useState(selectedNodeId);
  if (prevSelectedNodeId !== selectedNodeId) {
    setPrevSelectedNodeId(selectedNodeId);
    if (selectedNodeId !== undefined) {
      if (selectedNodeId === null) {
        if (selection?.type === "node") setSelection(null);
      } else if (selection?.type !== "node" || selection.id !== selectedNodeId) {
        setSelection({ type: "node", id: selectedNodeId });
      }
    }
  }

  const onNodeDragStop = useCallback<NodeDragHandler>((_event, node) => {
    setManualPositions((prev) => {
      const next = new Map(prev);
      next.set(node.id, node.position);
      return next;
    });
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === canvasRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!canvasRef.current) return;
    if (document.fullscreenElement === canvasRef.current) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    await canvasRef.current.requestFullscreen().catch(() => undefined);
  }, []);

  const scopes = useMemo(() => {
    if (diagram.scopes.length > 0) return diagram.scopes;
    const seen = new Map<string, Scope>();
    diagram.nodes.forEach((node) => {
      if (!seen.has(node.scope)) {
        seen.set(node.scope, { id: node.scope, label: node.scope, description: "", tables: 0 });
      }
      seen.get(node.scope)!.tables += 1;
    });
    return Array.from(seen.values());
  }, [diagram]);

  const visibleNodes = useMemo(
    () => diagram.nodes.filter((node) => !hiddenScopes.has(node.scope)),
    [diagram.nodes, hiddenScopes]
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => diagram.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [diagram.edges, visibleNodeIds]
  );

  const detailedDiffMap = useMemo(() => {
    if (!diffMap || diffMap.size === 0 || previousDiagram === undefined) return undefined;
    return computeDetailedDiagramDiff(previousDiagram, diagram);
  }, [diffMap, previousDiagram, diagram]);

  const { rfNodes, rfEdges } = useMemo(
    () => layoutNodes(visibleNodes, visibleEdges, scopes, diffMap, detailedDiffMap),
    [visibleNodes, visibleEdges, scopes, diffMap, detailedDiffMap]
  );

  // Conjunto de linhas e tabelas envolvidas na seleção atual: uma única relação (clique numa
  // linha) ou todas as relações de uma tabela (botão "mostrar todas as relações" no cabeçalho).
  const highlighted = useMemo(() => {
    if (!selection) return null;
    const edgeIds = new Set<string>();
    const nodeIds = new Set<string>();
    if (selection.type === "edge") {
      const edge = rfEdges.find((e) => e.id === selection.id);
      if (!edge) return null;
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    } else {
      nodeIds.add(selection.id);
      rfEdges.forEach((edge) => {
        if (edge.source === selection.id || edge.target === selection.id) {
          edgeIds.add(edge.id);
          nodeIds.add(edge.source);
          nodeIds.add(edge.target);
        }
      });
      if (edgeIds.size === 0) return null;
    }
    return { edgeIds, nodeIds };
  }, [rfEdges, selection]);

  // Destaca o(s) caminho(s) selecionado(s) e esmaece o restante do diagrama, pra deixar
  // claro qual linha liga a quais tabelas.
  const displayEdges = useMemo(() => {
    if (!highlighted) return rfEdges;
    return rfEdges.map((edge) => {
      const isSelected = highlighted.edgeIds.has(edge.id);
      return {
        ...edge,
        animated: isSelected,
        zIndex: isSelected ? 1000 : 0,
        style: isSelected
          ? { stroke: EDGE_COLOR_SELECTED, strokeWidth: 3 }
          : { stroke: EDGE_COLOR, strokeWidth: 1, opacity: 0.15 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isSelected ? EDGE_COLOR_SELECTED : EDGE_COLOR,
          width: isSelected ? 18 : 14,
          height: isSelected ? 18 : 14,
        },
      };
    });
  }, [rfEdges, highlighted]);

  const onShowNodeRelations = useCallback((nodeId: string) => {
    setSelection((prev) => (prev?.type === "node" && prev.id === nodeId ? null : { type: "node", id: nodeId }));
  }, []);

  const displayNodes = useMemo(
    () =>
      rfNodes.map((node) => {
        if (node.type === "group") {
          const involved = highlighted
            ? visibleNodes.some((n) => n.scope === node.id.replace(/^scope-group:/, "") && highlighted.nodeIds.has(n.id))
            : true;
          return {
            ...node,
            style: { ...node.style, opacity: highlighted ? (involved ? 1 : 0.25) : 1 },
          };
        }
        const isInvolved = highlighted?.nodeIds.has(node.id) ?? false;
        const manualPosition = manualPositions.get(node.id);
        return {
          ...node,
          position: manualPosition ?? node.position,
          data: {
            ...(node.data as NodeData),
            emphasized: highlighted ? isInvolved : false,
            relationsActive: selection?.type === "node" && selection.id === node.id,
            onShowRelations: onShowNodeRelations,
          },
          style: highlighted ? { ...node.style, opacity: isInvolved ? 1 : 0.35 } : { ...node.style, opacity: 1 },
        };
      }),
    [rfNodes, highlighted, selection, onShowNodeRelations, manualPositions, visibleNodes]
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>((_event, edge) => {
    setSelection((prev) => (prev?.type === "edge" && prev.id === edge.id ? null : { type: "edge", id: edge.id }));
  }, []);

  const onNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    if (node.type === "group") return;
    onShowNodeRelations(node.id);
    onSelectedNodeChange?.(node.id);
  }, [onShowNodeRelations, onSelectedNodeChange]);

  const onPaneClick = useCallback(() => {
    setSelection(null);
    onSelectedNodeChange?.(null);
  }, [onSelectedNodeChange]);

  const selectedNodeDetail = selection?.type === "node" ? visibleNodes.find((n) => n.id === selection.id) : undefined;
  const selectedEdgeDetail = selection?.type === "edge" ? displayEdges.find((e) => e.id === selection.id) : undefined;

  const focusSelectedNode = useCallback(() => {
    if (!selectedNodeDetail || !reactFlowInstance) return;
    // Com grupos por módulo, `position` do nó é relativa ao grupo pai — centralizar por ela
    // mirava o lugar errado. O fitView no próprio nó usa a posição absoluta e o tamanho medido.
    void reactFlowInstance.fitView({
      nodes: [{ id: selectedNodeDetail.id }],
      padding: 0.35,
      minZoom: 0.5,
      maxZoom: Math.max(reactFlowInstance.getZoom(), 1),
      duration: 300,
    });
  }, [reactFlowInstance, selectedNodeDetail]);

  function toggleScope(scopeId: string) {
    setHiddenScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scopeId)) next.delete(scopeId);
      else next.add(scopeId);
      return next;
    });
  }

  if (diagram.nodes.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-slate-800 text-sm text-slate-500"
        style={{ height }}
      >
        Nenhuma tabela neste snapshot.
      </div>
    );
  }

  // Quando o pai passa height="100%" (ex: preencher um container com altura definida em
  // fullscreen), percentual só resolve se TODA a cadeia de ancestrais tiver altura definida —
  // e este componente teria uma div intermediária com altura automática quebrando essa cadeia.
  // Por isso, nesse caso, usamos flexbox (h-full + flex-1) em vez de propagar o percentual.
  const fillParent = height === "100%";

  return (
    <div className={fillParent ? "flex h-full flex-col gap-3" : "space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {scopes.length > 1 ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setScopeMenuOpen((v) => !v)}
              aria-expanded={scopeMenuOpen}
              title="Escolher quais módulos/escopos aparecem no diagrama"
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                hiddenScopes.size > 0
                  ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                  : "border-slate-800 text-slate-300 hover:border-slate-600"
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              Módulos ({scopes.length - scopes.filter((s) => hiddenScopes.has(s.id)).length}/{scopes.length})
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
            {scopeMenuOpen ? (
              <>
                {/* Camada invisível: clicar fora fecha o menu. */}
                <div className="fixed inset-0 z-40" onClick={() => setScopeMenuOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-[280px] rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl">
                  <div className="mb-1.5 flex items-center justify-between px-1 text-[11px]">
                    <button type="button" onClick={() => setHiddenScopes(new Set())} className="text-cyan-300 hover:underline">
                      Mostrar todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setHiddenScopes(new Set(scopes.map((s) => s.id)))}
                      className="text-slate-400 hover:underline"
                    >
                      Ocultar todos
                    </button>
                  </div>
                  <ul className="max-h-72 space-y-0.5 overflow-y-auto">
                    {scopes.map((scope) => {
                      const active = !hiddenScopes.has(scope.id);
                      const tone = colorFor(scope.id);
                      return (
                        <li key={scope.id}>
                          <label
                            title={scope.description || scope.label}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-900"
                          >
                            <input type="checkbox" checked={active} onChange={() => toggleScope(scope.id)} />
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone.color }} />
                            <span className="min-w-0 flex-1 truncate">{scope.label}</span>
                            <span className="text-slate-500">{scope.tables}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div />
        )}

        <div className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-950/90 p-1 text-xs">
          <button
            type="button"
            onClick={() => setViewMode("er")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
              viewMode === "er"
                ? "bg-cyan-500/20 text-cyan-200 shadow-sm ring-1 ring-cyan-400/50"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Cartões ER
          </button>
          <button
            type="button"
            onClick={() => setViewMode("cytoscape")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
              viewMode === "cytoscape"
                ? "bg-cyan-500/20 text-cyan-200 shadow-sm ring-1 ring-cyan-400/50"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            Grafo (Cytoscape)
          </button>
        </div>
      </div>

      {visibleNodes.length === 0 ? (
        <div
          className={`flex items-center justify-center rounded-xl border border-dashed border-slate-800 text-sm text-slate-500 ${
            fillParent ? "flex-1" : ""
          }`}
          style={fillParent ? undefined : { height }}
        >
          Nenhuma tabela visível com os módulos selecionados.
        </div>
      ) : (
        <div
          ref={canvasRef}
          className={`relative overflow-hidden border-2 border-slate-800 bg-slate-950 shadow-[0_20px_60px_-25px_rgba(8,145,178,0.35)] ${
            isFullscreen ? "h-screen w-screen" : fillParent ? "min-h-0 flex-1 rounded-2xl" : "rounded-2xl"
          }`}
          style={isFullscreen ? undefined : fillParent ? undefined : { height }}
        >
          {viewMode === "er" ? (
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              onInit={setReactFlowInstance}
              onNodeClick={onNodeClick}
              onNodeDragStop={onNodeDragStop}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={2}
              onlyRenderVisibleElements
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
              <Controls className="!bg-slate-900 !border-slate-700" />
              <MiniMap
                className="!bg-slate-900"
                nodeColor={(n) => {
                  if (n.type === "group") return (n.data as GroupNodeData).tone.color;
                  const status = (n.data as NodeData)?.status;
                  if (status === "added") return "#34d399";
                  if (status === "altered") return "#fbbf24";
                  if (status === "removed") return "#fb7185";
                  return (n.data as NodeData)?.tone?.color ?? "#334155";
                }}
              />
              {showFullscreenButton ? (
                <Panel position="top-left">
                  <button
                    type="button"
                    onClick={() => void toggleFullscreen()}
                    title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/90 text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
                  >
                    {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
                </Panel>
              ) : null}
              {selectedNodeDetail && !hideNodePanel ? (
                <NodePanel
                  node={selectedNodeDetail}
                  relationCount={highlighted && selection?.type === "node" ? highlighted.edgeIds.size : 0}
                  detailedDiff={detailedDiffMap?.get(selectedNodeDetail.id)}
                  onFocus={focusSelectedNode}
                  onEdit={onEditNode ? () => onEditNode(selectedNodeDetail.id) : undefined}
                  onClose={() => setSelection(null)}
                />
              ) : null}
              {selectedEdgeDetail ? <EdgePanel edge={selectedEdgeDetail} onClose={() => setSelection(null)} /> : null}
            </ReactFlow>
          ) : (
            <>
              <CytoscapeDiagram
                nodes={visibleNodes}
                edges={visibleEdges}
                scopes={scopes}
                diffMap={diffMap}
                selectedNodeId={selection?.type === "node" ? selection.id : null}
                selectedEdgeId={selection?.type === "edge" ? selection.id : null}
                onSelectNode={(nodeId) => {
                  setSelection(nodeId ? { type: "node", id: nodeId } : null);
                  onSelectedNodeChange?.(nodeId);
                }}
                onSelectEdge={(edgeId) => {
                  setSelection(edgeId ? { type: "edge", id: edgeId } : null);
                }}
              />
              {showFullscreenButton ? (
                <button
                  type="button"
                  onClick={() => void toggleFullscreen()}
                  title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                  className="absolute bottom-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/90 text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
              ) : null}
              {selectedNodeDetail && !hideNodePanel ? (
                <NodePanel
                  node={selectedNodeDetail}
                  onEdit={onEditNode ? () => onEditNode(selectedNodeDetail.id) : undefined}
                  relationCount={
                    visibleEdges.filter(
                      (e) => e.source === selectedNodeDetail.id || e.target === selectedNodeDetail.id
                    ).length
                  }
                  detailedDiff={detailedDiffMap?.get(selectedNodeDetail.id)}
                  showColumnList
                  floatingOverlay
                  onClose={() => {
                    setSelection(null);
                    onSelectedNodeChange?.(null);
                  }}
                />
              ) : null}
              {selectedEdgeDetail ? (
                <EdgePanel
                  edge={selectedEdgeDetail}
                  floatingOverlay
                  onClose={() => setSelection(null)}
                />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export type { DiffStatus, Payload as MigrationDiagramPayload };

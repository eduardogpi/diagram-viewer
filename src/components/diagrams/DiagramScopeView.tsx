"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";
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
  useNodesState,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "reactflow";
import "reactflow/dist/style.css";
import { Waypoints } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

type Props = { connectionId: string };
type GroupingMode = "domain" | "schema" | "prefix";
type LayoutDirection = "TB" | "LR";
type Column = { name: string; type: string; isPrimary: boolean; isForeign: boolean };
type TableNode = { id: string; label: string; schema: string; scope: string; columns: Column[] };
type Relationship = {
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
type Scope = { id: string; label: string; description: string; tables: number };
type Payload = { nodes: TableNode[]; edges: Relationship[]; scopes: Scope[] };
type ManualEdge = { id: string; source: string; target: string };
type DiagramPreferences = {
  minimap: boolean;
  scopeDepth: number;
  layoutDirection: LayoutDirection;
  groupingMode: GroupingMode;
  selectedScopeIds: string[];
  selectedTableIds: string[];
  searchQuery: string;
  viewport: Viewport | null;
};
type LayoutSnapshot = {
  id: string;
  name: string;
  nodes: Array<{ id: string; position: { x: number; y: number } }>;
  edges: string[];
  settings: DiagramPreferences;
  createdAt: string;
  createdBy: string;
};
type ScopeBucket = { id: string; label: string; description: string; tablesList: TableNode[] };
type NodeData = {
  label: string;
  schema: string;
  scope: string;
  columns: Column[];
  /** true = tabela corresponde à busca textual ativa. */
  highlighted: boolean;
  /** true = tabela é extremidade da seleção atual (linha ou "mostrar relações"). */
  emphasized: boolean;
  /** opacidade aplicada quando a tabela não participa da seleção/busca ativa (1 = normal). */
  dimOpacity: number;
  selected: boolean;
  layoutDirection: LayoutDirection;
  /** true = a tabela tem ao menos uma relação (FK) de entrada ou saída. */
  hasRelations: boolean;
  /** Posições (0-1) dos handles de entrada/saída, distribuídas quando há múltiplas relações. */
  targetHandlePositions: number[];
  sourceHandlePositions: number[];
  onShowRelations?: (nodeId: string) => void;
};

const NODE_W = 360;
const NODE_H = 280;
const DEFAULT_PREFERENCES: DiagramPreferences = {
  minimap: true,
  scopeDepth: 2,
  layoutDirection: "TB",
  groupingMode: "domain",
  selectedScopeIds: [],
  selectedTableIds: [],
  searchQuery: "",
  viewport: null,
};
const COLORS = ["#22d3ee", "#34d399", "#f97316", "#facc15", "#fb7185", "#a78bfa"];

function colorFor(scopeId: string) {
  const index = Array.from(scopeId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % COLORS.length;
  const color = COLORS[index];
  return { color, border: `${color}66`, fill: `${color}16` };
}

function derivePrefix(name: string, schema: string) {
  const [prefix] = name.split("_");
  return prefix && prefix.length >= 3 ? prefix : schema;
}

function normalizePayload(payload: unknown): Payload {
  const empty: Payload = { nodes: [], edges: [], scopes: [] };
  if (!payload || typeof payload !== "object") return empty;
  const raw = payload as Partial<Payload>;
  return {
    nodes: Array.isArray(raw.nodes) ? (raw.nodes.filter(Boolean) as TableNode[]) : [],
    edges: Array.isArray(raw.edges) ? (raw.edges.filter(Boolean) as Relationship[]) : [],
    scopes: Array.isArray(raw.scopes) ? (raw.scopes.filter(Boolean) as Scope[]) : [],
  };
}

function normalizePreferences(value: unknown): DiagramPreferences {
  if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
  const raw = value as Partial<DiagramPreferences>;
  return {
    minimap: typeof raw.minimap === "boolean" ? raw.minimap : DEFAULT_PREFERENCES.minimap,
    scopeDepth:
      typeof raw.scopeDepth === "number" && raw.scopeDepth >= 1 && raw.scopeDepth <= 5
        ? raw.scopeDepth
        : DEFAULT_PREFERENCES.scopeDepth,
    layoutDirection: raw.layoutDirection === "LR" ? "LR" : "TB",
    groupingMode: raw.groupingMode === "schema" || raw.groupingMode === "prefix" ? raw.groupingMode : "domain",
    selectedScopeIds: Array.isArray(raw.selectedScopeIds)
      ? raw.selectedScopeIds.filter((item): item is string => typeof item === "string")
      : [],
    selectedTableIds: Array.isArray(raw.selectedTableIds)
      ? raw.selectedTableIds.filter((item): item is string => typeof item === "string")
      : [],
    searchQuery: typeof raw.searchQuery === "string" ? raw.searchQuery : "",
    viewport:
      raw.viewport &&
      typeof raw.viewport.x === "number" &&
      typeof raw.viewport.y === "number" &&
      typeof raw.viewport.zoom === "number"
        ? raw.viewport
        : null,
  };
}

function normalizeSnapshots(value: unknown): LayoutSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(Boolean)
    .map((item) => item as Partial<LayoutSnapshot>)
    .filter((item) => typeof item.id === "string" && typeof item.name === "string")
    .map((item) => ({
      id: item.id as string,
      name: item.name as string,
      nodes: Array.isArray(item.nodes) ? (item.nodes as LayoutSnapshot["nodes"]) : [],
      edges: Array.isArray(item.edges) ? item.edges.filter((edge): edge is string => typeof edge === "string") : [],
      settings: normalizePreferences(item.settings),
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      createdBy: typeof item.createdBy === "string" ? item.createdBy : "unknown",
    }));
}

function buildScopes(payload: Payload, groupingMode: GroupingMode) {
  const sourceScopes = new Map(payload.scopes.map((scope) => [scope.id, scope]));
  const buckets = new Map<string, ScopeBucket>();

  payload.nodes.forEach((node) => {
    const id =
      groupingMode === "schema" ? node.schema : groupingMode === "prefix" ? derivePrefix(node.label, node.schema) : node.scope;
    const current = buckets.get(id) ?? {
      id,
      label: groupingMode === "domain" ? sourceScopes.get(node.scope)?.label ?? id : id,
      description:
        groupingMode === "domain"
          ? sourceScopes.get(node.scope)?.description ?? `Tables grouped by ${id}`
          : groupingMode === "schema"
          ? `Tables from schema ${node.schema}`
          : `Tables grouped by prefix ${id}`,
      tablesList: [],
    };
    current.tablesList.push(node);
    buckets.set(id, current);
  });

  return Array.from(buckets.values())
    .map((bucket) => ({ ...bucket, tablesList: bucket.tablesList.sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildAdjacency(edges: Relationship[]) {
  const map = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    const source = map.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    map.set(edge.source, source);
    const target = map.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    map.set(edge.target, target);
  });
  return map;
}

function expandNeighbors(baseIds: string[], adjacency: Map<string, Set<string>>, depth: number) {
  const visited = new Set(baseIds);
  let frontier = new Set(baseIds);
  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();
    frontier.forEach((id) => {
      adjacency.get(id)?.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      });
    });
    frontier = next;
    if (next.size === 0) break;
  }
  return visited;
}

type GraphLayout = {
  positions: Map<string, { x: number; y: number }>;
  sourceHandleIndex: Map<string, number>;
  targetHandleIndex: Map<string, number>;
  sourceHandlePositions: Map<string, number[]>;
  targetHandlePositions: Map<string, number[]>;
  sourceDegree: Map<string, number>;
  targetDegree: Map<string, number>;
};

/**
 * Calcula posição (dagre) e distribuição de handles de cada nó. Quando uma tabela tem mais de
 * uma relação, os pontos de conexão são espalhados ao longo do eixo em que os handles ficam
 * (horizontal no layout TB, vertical no LR) e ordenados pela posição do nó do outro lado —
 * evita que múltiplas linhas saiam/entrem todas do mesmo ponto e se sobreponham.
 */
function computeGraphLayout(
  nodeIds: string[],
  edges: Array<{ id: string; source: string; target: string }>,
  direction: LayoutDirection,
  pinnedPositions: Map<string, { x: number; y: number }>
): GraphLayout {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: direction, ranksep: direction === "TB" ? 170 : 220, nodesep: 120, edgesep: 60, marginx: 48, marginy: 48 });
  nodeIds.forEach((id) => graph.setNode(id, { width: NODE_W, height: NODE_H }));
  edges.forEach((edge) => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  });
  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  nodeIds.forEach((id) => {
    const pinned = pinnedPositions.get(id);
    const laidOut = graph.node(id);
    positions.set(id, pinned ?? { x: laidOut.x - NODE_W / 2, y: laidOut.y - NODE_H / 2 });
  });

  const axisOf = (id: string) => {
    const pos = positions.get(id);
    if (!pos) return 0;
    return direction === "LR" ? pos.y : pos.x;
  };

  const outgoingByNode = new Map<string, typeof edges>();
  const incomingByNode = new Map<string, typeof edges>();
  edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
    if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
    outgoingByNode.get(edge.source)!.push(edge);
    if (!incomingByNode.has(edge.target)) incomingByNode.set(edge.target, []);
    incomingByNode.get(edge.target)!.push(edge);
  });

  const sourceHandleIndex = new Map<string, number>();
  const targetHandleIndex = new Map<string, number>();
  outgoingByNode.forEach((list) => {
    [...list].sort((a, b) => axisOf(a.target) - axisOf(b.target)).forEach((edge, idx) => sourceHandleIndex.set(edge.id, idx));
  });
  incomingByNode.forEach((list) => {
    [...list].sort((a, b) => axisOf(a.source) - axisOf(b.source)).forEach((edge, idx) => targetHandleIndex.set(edge.id, idx));
  });

  function handlePositions(count: number): number[] {
    if (count <= 1) return [0.5];
    const start = 0.18;
    const end = 0.82;
    return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1));
  }

  const sourceHandlePositions = new Map<string, number[]>();
  const targetHandlePositions = new Map<string, number[]>();
  const sourceDegree = new Map<string, number>();
  const targetDegree = new Map<string, number>();
  nodeIds.forEach((id) => {
    const outCount = outgoingByNode.get(id)?.length ?? 0;
    const inCount = incomingByNode.get(id)?.length ?? 0;
    sourceDegree.set(id, outCount);
    targetDegree.set(id, inCount);
    sourceHandlePositions.set(id, handlePositions(outCount));
    targetHandlePositions.set(id, handlePositions(inCount));
  });

  return {
    positions,
    sourceHandleIndex,
    targetHandleIndex,
    sourceHandlePositions,
    targetHandlePositions,
    sourceDegree,
    targetDegree,
  };
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toggleInList(id: string, setter: Dispatch<SetStateAction<string[]>>) {
  setter((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
}

function TableCard({ id, data }: NodeProps<NodeData>) {
  const tone = colorFor(data.scope);
  const columns = data.columns.slice(0, 10);
  const hidden = data.columns.length - columns.length;
  const isLR = data.layoutDirection === "LR";
  const targetPos = isLR ? Position.Left : Position.Top;
  const sourcePos = isLR ? Position.Right : Position.Bottom;
  const targetHandles = data.targetHandlePositions.length > 0 ? data.targetHandlePositions : [0.5];
  const sourceHandles = data.sourceHandlePositions.length > 0 ? data.sourceHandlePositions : [0.5];
  const ringActive = data.selected || data.highlighted || data.emphasized;

  return (
    <div
      className="min-w-[340px] rounded-3xl border bg-[var(--color-card-bg)] shadow-[var(--color-card-shadow)] transition-opacity"
      style={{
        borderColor: data.selected ? tone.color : ringActive ? tone.border : "rgba(148, 163, 184, 0.6)",
        boxShadow: ringActive ? `0 0 0 1px ${tone.color}55, var(--color-card-shadow)` : "var(--color-card-shadow)",
        opacity: data.dimOpacity,
      }}
    >
      {targetHandles.map((pct, i) => (
        <Handle
          key={`t-${i}`}
          id={`t-${i}`}
          type="target"
          position={targetPos}
          style={
            isLR
              ? { top: `${pct * 100}%`, width: 10, height: 10, background: tone.color, border: `2px solid ${tone.border}` }
              : { left: `${pct * 100}%`, width: 10, height: 10, background: tone.color, border: `2px solid ${tone.border}` }
          }
        />
      ))}
      <div className="rounded-t-3xl border-b px-5 py-4" style={{ borderColor: tone.border, background: tone.fill }}>
        <div className="flex items-center gap-2">
          <p className="flex-1 text-sm font-semibold uppercase tracking-[0.22em]" style={{ color: tone.color }}>{data.scope}</p>
          {data.hasRelations ? (
            <button
              type="button"
              title="Mostrar todas as relações desta tabela"
              onClick={(e) => {
                e.stopPropagation();
                data.onShowRelations?.(id);
              }}
              className={`nodrag nopan flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                data.selected
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              }`}
            >
              <Waypoints className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        <h4 className="mt-2 truncate text-lg font-semibold text-[var(--color-text-primary)]">{data.label}</h4>
        <p className="mt-2 truncate font-mono text-xs text-[var(--color-text-secondary)]">{data.schema}</p>
      </div>
      <div className="space-y-2 px-5 py-4">
        {columns.map((column) => (
          <div key={column.name} className="flex items-center justify-between gap-3 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`inline-flex h-5 min-w-[30px] items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold ${
                column.isPrimary
                  ? "border-[var(--color-warning)]/50 bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
                  : column.isForeign
                    ? "border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-panel-muted)] text-[var(--color-text-secondary)]"
              }`}>{column.isPrimary ? "PK" : column.isForeign ? "FK" : ""}</span>
              <span className="truncate font-mono text-[12px] text-[var(--color-text-primary)]">{column.name}</span>
            </div>
            <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">{column.type}</span>
          </div>
        ))}
        {hidden > 0 ? <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-muted)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">+{hidden} colunas omitidas</div> : null}
      </div>
      {sourceHandles.map((pct, i) => (
        <Handle
          key={`s-${i}`}
          id={`s-${i}`}
          type="source"
          position={sourcePos}
          style={
            isLR
              ? { top: `${pct * 100}%`, width: 10, height: 10, background: tone.color, border: `2px solid ${tone.border}` }
              : { left: `${pct * 100}%`, width: 10, height: 10, background: tone.color, border: `2px solid ${tone.border}` }
          }
        />
      ))}
    </div>
  );
}

const nodeTypes = { table: TableCard };

function NodePanel({
  node,
  selectedTableIds,
  neighborIds,
  toolbarHeight,
  onFocus,
  onToggleNeighbors,
  onClose,
}: {
  node: TableNode;
  selectedTableIds: string[];
  neighborIds: Set<string>;
  toolbarHeight: number;
  onFocus: () => void;
  onToggleNeighbors: () => void;
  onClose: () => void;
}) {
  const neighborsActive = selectedTableIds.length > 0 && selectedTableIds.every((id) => neighborIds.has(id));

  return (
    <Panel position="top-right" style={{ marginTop: toolbarHeight + 12 }} className="w-[360px] rounded-3xl border border-white/10 bg-slate-950/92 p-4 text-sm text-slate-300 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.26em] text-slate-500">Tabela selecionada</p>
          <h4 className="mt-2 truncate text-lg font-semibold text-white">{node.label}</h4>
          <p className="mt-1 truncate font-mono text-xs text-slate-500">{node.schema}</p>
        </div>
        <button
          onClick={onClose}
          className="mt-1 flex-shrink-0 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
          title="Fechar painel"
        >
          ✕
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          onClick={onFocus}
          className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
        >
          Centralizar
        </button>

        <button
          onClick={onToggleNeighbors}
          className={`rounded-2xl border px-3 py-2.5 text-sm font-semibold transition ${
            neighborsActive
              ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/20"
              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
          }`}
          title={neighborsActive ? "Desativar filtro de vizinhos" : "Mostrar apenas tabelas vizinhas"}
        >
          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
            neighborsActive ? "bg-cyan-400" : "bg-slate-600"
          }`} />
          Vizinhos
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs text-slate-500">Colunas</p>
          <p className="mt-1 font-semibold text-white">{node.columns.length}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs text-slate-500">Relações</p>
          <p className="mt-1 font-semibold text-white">{neighborIds.size - 1}</p>
        </div>
      </div>
    </Panel>
  );
}

function EdgePanel({ edge, onRemove }: { edge: Edge<Relationship>; onRemove?: () => void }) {
  const data = edge.data;
  const isManual = edge.data?.constraint?.startsWith("manual:");
  return (
    <Panel position="bottom-right" className="mb-4 w-[380px] rounded-3xl border border-white/10 bg-slate-950/92 p-4 text-sm text-slate-300 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-[0.26em] text-slate-500">Relacionamento</p>
            {isManual && (
              <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Manual</span>
            )}
          </div>
          <h4 className="mt-2 text-base font-semibold text-white">{isManual ? `${edge.source} → ${edge.target}` : data?.constraint}</h4>
          <p className="mt-1 font-mono text-xs text-slate-500">{edge.source} → {edge.target}</p>
        </div>
        {isManual && onRemove && (
          <button
            onClick={onRemove}
            className="mt-1 flex-shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/20"
            title="Remover FK manual"
          >
            Remover
          </button>
        )}
      </div>
      {!isManual && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-slate-500">Cardinalidade</p>
              <p className="mt-1 font-semibold text-white">{data?.cardinality ?? "Não informado"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-slate-500">Delete / Update</p>
              <p className="mt-1 text-white">{data?.onDelete ?? "Padrão"} / {data?.onUpdate ?? "Padrão"}</p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-slate-500">Mapeamento de colunas</p>
            <div className="mt-2 space-y-2">
              {data?.columns.map((pair) => (
                <div key={`${pair.source}-${pair.target}`} className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-mono text-cyan-200">{pair.source}</span>
                  <span className="text-slate-500">→</span>
                  <span className="font-mono text-emerald-200">{pair.target}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function FilterModal({
  open,
  scopes,
  activeScopeSet,
  selectedTableSet,
  scopeQuery,
  tableQuery,
  setScopeQuery,
  setTableQuery,
  setSelectedScopeIds,
  setSelectedTableIds,
  onClose,
}: {
  open: boolean;
  scopes: ScopeBucket[];
  activeScopeSet: Set<string>;
  selectedTableSet: Set<string>;
  scopeQuery: string;
  tableQuery: string;
  setScopeQuery: (value: string) => void;
  setTableQuery: (value: string) => void;
  setSelectedScopeIds: Dispatch<SetStateAction<string[]>>;
  setSelectedTableIds: Dispatch<SetStateAction<string[]>>;
  onClose: () => void;
}) {
  if (!open) return null;
  const sq = scopeQuery.trim().toLowerCase();
  const tq = tableQuery.trim().toLowerCase();
  const filteredScopes = scopes
    .filter((scope) => !sq || scope.label.toLowerCase().includes(sq) || scope.description.toLowerCase().includes(sq))
    .map((scope) => ({
      ...scope,
      filteredTables: scope.tablesList.filter((table) => !tq || table.label.toLowerCase().includes(tq) || table.schema.toLowerCase().includes(tq) || table.columns.some((column) => column.name.toLowerCase().includes(tq))),
    }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_srgb,var(--color-bg-canvas)_65%,#000)]/70 p-4 backdrop-blur-md sm:items-center"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-[var(--color-border-strong)] bg-[var(--color-bg-layer-1)] shadow-[var(--shadow-floating)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-6 py-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-[var(--color-text-muted)]">Filtros do diagrama</p>
            <h3 className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">Escopos e tabelas</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
          >
            Fechar
          </button>
        </div>
        <div className="grid gap-4 border-b border-[var(--color-border-subtle)] px-6 py-4 lg:grid-cols-2">
          <input
            value={scopeQuery}
            onChange={(event) => setScopeQuery(event.target.value)}
            placeholder="Buscar escopo"
            className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]"
          />
          <input
            value={tableQuery}
            onChange={(event) => setTableQuery(event.target.value)}
            placeholder="Buscar tabela ou coluna"
            className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]"
          />
        </div>
        <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
          {filteredScopes.map((scope) => {
            const tone = colorFor(scope.id);
            const enabled = activeScopeSet.has(scope.id);
            return (
              <section key={scope.id} className="overflow-hidden rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-3 w-3 rounded-full" style={{ background: tone.color, boxShadow: `0 0 12px ${tone.color}` }} />
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">{scope.label}</h4>
                    </div>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">{scope.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => toggleInList(scope.id, setSelectedScopeIds)}
                      className="rounded-2xl border px-3 py-2 text-xs font-semibold transition"
                      style={{
                        borderColor: enabled ? tone.border : "var(--color-border-subtle)",
                        background: enabled ? tone.fill : "var(--color-bg-layer-2)",
                        color: enabled ? tone.color : "var(--color-text-secondary)",
                      }}
                    >
                      {enabled ? "Escopo visível" : "Ativar escopo"}
                    </button>
                    <button
                      onClick={() =>
                        setSelectedTableIds((current) => Array.from(new Set([...current, ...scope.filteredTables.map((table) => table.id)])))
                      }
                      className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
                    >
                      Selecionar tabelas
                    </button>
                    <button
                      onClick={() =>
                        setSelectedTableIds((current) => current.filter((tableId) => !scope.filteredTables.some((table) => table.id === tableId)))
                      }
                      className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)]"
                    >
                      Ocultar tabelas
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
                  {scope.filteredTables.map((table) => {
                    const checked = selectedTableSet.has(table.id);
                    return (
                      <label
                        key={table.id}
                        className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition"
                        style={{
                          borderColor: checked ? tone.border : "var(--color-border-subtle)",
                          background: checked ? tone.fill : "var(--color-bg-layer-2)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleInList(table.id, setSelectedTableIds)}
                          className="mt-1 h-4 w-4 rounded border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] text-[var(--color-accent)]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{table.label}</p>
                          <p className="mt-1 truncate font-mono text-xs text-[var(--color-text-muted)]">{table.schema}</p>
                          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{table.columns.length} colunas</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedScopeIds([])}
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)]"
            >
              Mostrar todos os escopos
            </button>
            <button
              onClick={() => setSelectedTableIds([])}
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)]"
            >
              Limpar seleção de tabelas
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))]"
          >
            Aplicar filtros
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DiagramScopeView({ connectionId }: Props) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const prefTimer = useRef<number | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(120);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<LayoutSnapshot[]>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [scopeQuery, setScopeQuery] = useState("");
  const [tableQuery, setTableQuery] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pendingViewport, setPendingViewport] = useState<Viewport | null>(null);
  const [manualPositions, setManualPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [minimap, setMinimap] = useState(DEFAULT_PREFERENCES.minimap);
  const [scopeDepth, setScopeDepth] = useState(DEFAULT_PREFERENCES.scopeDepth);
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>(DEFAULT_PREFERENCES.layoutDirection);
  const [groupingMode, setGroupingMode] = useState<GroupingMode>(DEFAULT_PREFERENCES.groupingMode);
  const [selectedScopeIds, setSelectedScopeIds] = useState<string[]>(DEFAULT_PREFERENCES.selectedScopeIds);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>(DEFAULT_PREFERENCES.selectedTableIds);
  const [searchQuery, setSearchQuery] = useState(DEFAULT_PREFERENCES.searchQuery);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [manualEdges, setManualEdges] = useState<ManualEdge[]>([]);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      setErrorMessage(null);
      try {
        const [diagramResponse, preferenceResponse, layoutsResponse] = await Promise.all([
          fetch(`/api/connections/${connectionId}/diagram`, { cache: "no-store" }),
          fetch(`/api/diagram-preferences/${connectionId}`, { cache: "no-store" }),
          fetch(`/api/diagram-layouts/${connectionId}`, { cache: "no-store" }),
        ]);
        if (!diagramResponse.ok) throw new Error("Unable to load the diagram.");
        const nextPayload = normalizePayload(await diagramResponse.json());
        const nextPreferences = preferenceResponse.ok ? normalizePreferences(await preferenceResponse.json()) : DEFAULT_PREFERENCES;
        const nextSnapshots = layoutsResponse.ok ? normalizeSnapshots(await layoutsResponse.json()) : [];
        if (cancelled) return;
        setPayload(nextPayload);
        setSnapshots(nextSnapshots);
        setMinimap(nextPreferences.minimap);
        setScopeDepth(nextPreferences.scopeDepth);
        setLayoutDirection(nextPreferences.layoutDirection);
        setGroupingMode(nextPreferences.groupingMode);
        setSelectedScopeIds(nextPreferences.selectedScopeIds);
        setSelectedTableIds(nextPreferences.selectedTableIds);
        setSearchQuery(nextPreferences.searchQuery);
        setPendingViewport(nextPreferences.viewport);
        setPreferencesLoaded(true);
        setStatus("idle");
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Unable to load the diagram.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    if (!reactFlowInstance || !pendingViewport) return;
    window.setTimeout(() => {
      void reactFlowInstance.setViewport(pendingViewport, { duration: 250 });
    }, 250);
    setPendingViewport(null);
  }, [pendingViewport, reactFlowInstance]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === canvasRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const scopes = useMemo(() => buildScopes(payload ?? { nodes: [], edges: [], scopes: [] }, groupingMode), [groupingMode, payload]);
  const tableGroupMap = useMemo(() => new Map(scopes.flatMap((scope) => scope.tablesList.map((table) => [table.id, scope.id] as const))), [scopes]);
  const allScopeIds = useMemo(() => scopes.map((scope) => scope.id), [scopes]);
  const activeScopeIds = selectedScopeIds.length > 0 ? selectedScopeIds : allScopeIds;
  const activeScopeSet = useMemo(() => new Set(activeScopeIds), [activeScopeIds]);
  const selectedTableSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);
  const adjacency = useMemo(() => buildAdjacency(payload?.edges ?? []), [payload?.edges]);
  const search = searchQuery.trim().toLowerCase();

  const visibleTables = useMemo(() => {
    const visibleByScope = new Set(scopes.filter((scope) => activeScopeSet.has(scope.id)).flatMap((scope) => scope.tablesList.map((table) => table.id)));
    const base = (payload?.nodes ?? []).filter((node) => visibleByScope.has(node.id));
    if (selectedTableIds.length === 0) return base;
    const expanded = expandNeighbors(selectedTableIds, adjacency, scopeDepth);
    return base.filter((node) => expanded.has(node.id));
  }, [activeScopeSet, adjacency, payload?.nodes, scopeDepth, scopes, selectedTableIds]);

  const visibleTableSet = useMemo(() => new Set(visibleTables.map((table) => table.id)), [visibleTables]);
  const highlightedTableSet = useMemo(() => new Set(visibleTables.filter((table) => search && (table.label.toLowerCase().includes(search) || table.schema.toLowerCase().includes(search) || table.columns.some((column) => column.name.toLowerCase().includes(search)))).map((table) => table.id)), [search, visibleTables]);

  // Conectividade "crua" (sem estilo), usada só para o layout dagre e para os handles —
  // separada da lista de edges estilizada abaixo pra evitar dependência circular.
  const connectivityEdges = useMemo(() => {
    const intrinsic = (payload?.edges ?? [])
      .filter((edge) => visibleTableSet.has(edge.source) && visibleTableSet.has(edge.target))
      .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }));
    const manual = manualEdges
      .filter((me) => visibleTableSet.has(me.source) && visibleTableSet.has(me.target))
      .map((me) => ({ id: me.id, source: me.source, target: me.target }));
    return [...intrinsic, ...manual];
  }, [manualEdges, payload?.edges, visibleTableSet]);

  const graphLayout = useMemo(
    () => computeGraphLayout(visibleTables.map((table) => table.id), connectivityEdges, layoutDirection, manualPositions),
    [connectivityEdges, layoutDirection, manualPositions, visibleTables]
  );

  // Conjunto de linhas e tabelas envolvidas na seleção atual: uma única relação (clique numa
  // linha) ou todas as relações de uma tabela (botão "mostrar todas as relações" no cabeçalho).
  const highlighted = useMemo(() => {
    if (!selectedEdgeId && !selectedNodeId) return null;
    const edgeIds = new Set<string>();
    const nodeIds = new Set<string>();
    if (selectedEdgeId) {
      const edge = connectivityEdges.find((e) => e.id === selectedEdgeId);
      if (!edge) return null;
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    } else if (selectedNodeId) {
      nodeIds.add(selectedNodeId);
      connectivityEdges.forEach((edge) => {
        if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
          edgeIds.add(edge.id);
          nodeIds.add(edge.source);
          nodeIds.add(edge.target);
        }
      });
    }
    if (edgeIds.size === 0 && nodeIds.size === 0) return null;
    return { edgeIds, nodeIds };
  }, [connectivityEdges, selectedEdgeId, selectedNodeId]);

  const showAllRelationsFor = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
    setSelectedEdgeId(null);
  }, []);

  const edges = useMemo(() => {
    const intrinsic = (payload?.edges ?? []).filter((edge) => visibleTableSet.has(edge.source) && visibleTableSet.has(edge.target)).map((edge) => {
      const tone = colorFor(tableGroupMap.get(edge.source) ?? edge.scope);
      const emphasized = highlighted?.edgeIds.has(edge.id) ?? false;
      const dimmed = highlighted ? !emphasized : false;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: `s-${graphLayout.sourceHandleIndex.get(edge.id) ?? 0}`,
        targetHandle: `t-${graphLayout.targetHandleIndex.get(edge.id) ?? 0}`,
        data: edge,
        zIndex: emphasized ? 1000 : 0,
        animated: emphasized,
        markerEnd: { type: MarkerType.ArrowClosed, width: emphasized ? 24 : 20, height: emphasized ? 24 : 20, color: tone.color },
        style: { stroke: tone.color, strokeWidth: emphasized ? 3 : 1.8, opacity: dimmed ? 0.12 : 1 },
        label: edge.constraint,
        labelStyle: { fill: tone.color, fontSize: 11, fontWeight: 700, opacity: dimmed ? 0.15 : 1 },
        labelBgStyle: { fill: "#020617", fillOpacity: dimmed ? 0.2 : 0.88 },
        labelBgBorderRadius: 10,
        labelBgPadding: [8, 4] as [number, number],
      } satisfies Edge<Relationship>;
    });

    const manual = manualEdges
      .filter((me) => visibleTableSet.has(me.source) && visibleTableSet.has(me.target))
      .map((me) => {
        const emphasized = highlighted?.edgeIds.has(me.id) ?? false;
        const dimmed = highlighted ? !emphasized : false;
        const fakeData: Relationship = { id: me.id, source: me.source, target: me.target, scope: "", constraint: `manual:${me.id}`, columns: [] };
        return {
          id: me.id,
          source: me.source,
          target: me.target,
          sourceHandle: `s-${graphLayout.sourceHandleIndex.get(me.id) ?? 0}`,
          targetHandle: `t-${graphLayout.targetHandleIndex.get(me.id) ?? 0}`,
          data: fakeData,
          zIndex: emphasized ? 1000 : 0,
          animated: emphasized,
          markerEnd: { type: MarkerType.ArrowClosed, width: emphasized ? 22 : 18, height: emphasized ? 22 : 18, color: "#f59e0b" },
          style: { stroke: "#f59e0b", strokeWidth: emphasized ? 2.6 : 1.6, strokeDasharray: "6 3", opacity: dimmed ? 0.12 : 1 },
          label: "manual",
          labelStyle: { fill: "#f59e0b", fontSize: 10, fontWeight: 700, opacity: dimmed ? 0.15 : 1 },
          labelBgStyle: { fill: "#020617", fillOpacity: dimmed ? 0.2 : 0.88 },
          labelBgBorderRadius: 10,
          labelBgPadding: [6, 3] as [number, number],
        } satisfies Edge<Relationship>;
      });

    return [...intrinsic, ...manual];
  }, [graphLayout, highlighted, manualEdges, payload?.edges, tableGroupMap, visibleTableSet]);

  const layoutedNodes = useMemo(
    () =>
      visibleTables.map((table) => {
        const position = graphLayout.positions.get(table.id) ?? { x: 0, y: 0 };
        const involved = highlighted?.nodeIds.has(table.id) ?? false;
        const hasRelations = (graphLayout.sourceDegree.get(table.id) ?? 0) + (graphLayout.targetDegree.get(table.id) ?? 0) > 0;
        const searchDimmed = highlightedTableSet.size > 0 && !highlightedTableSet.has(table.id);
        const dimOpacity = highlighted ? (involved ? 1 : 0.3) : searchDimmed ? 0.5 : 1;
        return {
          id: table.id,
          type: "table",
          position,
          sourcePosition: layoutDirection === "LR" ? Position.Right : Position.Bottom,
          targetPosition: layoutDirection === "LR" ? Position.Left : Position.Top,
          data: {
            label: table.label,
            schema: table.schema,
            scope: tableGroupMap.get(table.id) ?? table.scope,
            columns: table.columns,
            highlighted: highlightedTableSet.has(table.id),
            emphasized: highlighted ? involved : false,
            dimOpacity,
            selected: table.id === selectedNodeId,
            layoutDirection,
            hasRelations,
            targetHandlePositions: graphLayout.targetHandlePositions.get(table.id) ?? [0.5],
            sourceHandlePositions: graphLayout.sourceHandlePositions.get(table.id) ?? [0.5],
            onShowRelations: showAllRelationsFor,
          },
        } satisfies Node<NodeData>;
      }),
    [graphLayout, highlighted, highlightedTableSet, layoutDirection, selectedNodeId, showAllRelationsFor, tableGroupMap, visibleTables]
  );

  useEffect(() => {
    setRfNodes(layoutedNodes);
  }, [layoutedNodes, setRfNodes]);

  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId) as Edge<Relationship> | undefined, [edges, selectedEdgeId]);
  const selectedNode = useMemo(() => visibleTables.find((table) => table.id === selectedNodeId) ?? null, [selectedNodeId, visibleTables]);

  const currentPreferences = useMemo<DiagramPreferences>(() => ({
    minimap,
    scopeDepth,
    layoutDirection,
    groupingMode,
    selectedScopeIds,
    selectedTableIds,
    searchQuery,
    viewport: reactFlowInstance?.getViewport() ?? null,
  }), [groupingMode, layoutDirection, minimap, reactFlowInstance, scopeDepth, searchQuery, selectedScopeIds, selectedTableIds]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (prefTimer.current) window.clearTimeout(prefTimer.current);
    prefTimer.current = window.setTimeout(() => {
      void fetch(`/api/diagram-preferences/${connectionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(currentPreferences),
      }).catch(() => undefined);
    }, 400);
    return () => {
      if (prefTimer.current) window.clearTimeout(prefTimer.current);
    };
  }, [connectionId, currentPreferences, preferencesLoaded]);

  const handleNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    if (linkMode) {
      if (!linkSource) {
        setLinkSource(node.id);
        return;
      }
      if (linkSource !== node.id) {
        const id = `manual:${linkSource}\u2192${node.id}:${Date.now()}`;
        setManualEdges((prev) => [...prev, { id, source: linkSource, target: node.id }]);
      }
      setLinkSource(null);
      setLinkMode(false);
      return;
    }
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, [linkMode, linkSource]);
  const handleEdgeClick = useCallback<EdgeMouseHandler>((_event, edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);
  const handleNodeDragStop = useCallback((_event: MouseEvent, node: Node<NodeData>) => {
    setManualPositions((current) => {
      const next = new Map(current);
      next.set(node.id, { x: node.position.x, y: node.position.y });
      return next;
    });
  }, []);

  const focusTable = useCallback((tableId: string) => {
    const node = rfNodes.find((item) => item.id === tableId);
    if (!node || !reactFlowInstance) return;
    setSelectedNodeId(tableId);
    void reactFlowInstance.setCenter(node.position.x + NODE_W / 2, node.position.y + NODE_H / 2, { zoom: Math.max(reactFlowInstance.getZoom(), 0.9), duration: 300 });
  }, [reactFlowInstance, rfNodes]);

  const selectedNodeNeighborIds = useMemo(
    () => (selectedNodeId ? expandNeighbors([selectedNodeId], adjacency, scopeDepth) : new Set<string>()),
    [selectedNodeId, adjacency, scopeDepth]
  );

  const removeManualEdge = useCallback((edgeId: string) => {
    setManualEdges((prev) => prev.filter((e) => e.id !== edgeId));
    setSelectedEdgeId(null);
  }, []);

  const toggleNeighbors = useCallback(() => {
    if (!selectedNodeId) return;
    const neighborArr = Array.from(selectedNodeNeighborIds);
    const alreadyActive =
      selectedTableIds.length > 0 && selectedTableIds.every((id) => selectedNodeNeighborIds.has(id));
    setSelectedTableIds(alreadyActive ? [] : neighborArr);
  }, [selectedNodeId, selectedNodeNeighborIds, selectedTableIds]);

  const saveLayout = useCallback(async () => {
    const name = window.prompt("Nome do layout", `Layout ${new Date().toLocaleString("pt-BR")}`)?.trim();
    if (!name) return;
    const response = await fetch(`/api/diagram-layouts/${connectionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        nodes: rfNodes.map((node) => ({ id: node.id, position: node.position })),
        edges: edges.map((edge) => edge.id),
        settings: { ...currentPreferences, viewport: reactFlowInstance?.getViewport() ?? currentPreferences.viewport },
      }),
    });
    if (!response.ok) return;
    const refresh = await fetch(`/api/diagram-layouts/${connectionId}`, { cache: "no-store" });
    if (refresh.ok) setSnapshots(normalizeSnapshots(await refresh.json()));
  }, [connectionId, currentPreferences, edges, reactFlowInstance, rfNodes]);

  const restoreSnapshot = useCallback((snapshot: LayoutSnapshot) => {
    setManualPositions(new Map(snapshot.nodes.map((node) => [node.id, node.position])));
    setMinimap(snapshot.settings.minimap);
    setScopeDepth(snapshot.settings.scopeDepth);
    setLayoutDirection(snapshot.settings.layoutDirection);
    setGroupingMode(snapshot.settings.groupingMode);
    setSelectedScopeIds(snapshot.settings.selectedScopeIds);
    setSelectedTableIds(snapshot.settings.selectedTableIds);
    setSearchQuery(snapshot.settings.searchQuery);
    if (snapshot.settings.viewport) window.setTimeout(() => void reactFlowInstance?.setViewport(snapshot.settings.viewport as Viewport, { duration: 250 }), 200);
  }, [reactFlowInstance]);

  const exportCurrentDiagram = useCallback(() => {
    downloadJson(`diagram-${connectionId}.json`, {
      connectionId,
      exportedAt: new Date().toISOString(),
      preferences: { ...currentPreferences, viewport: reactFlowInstance?.getViewport() ?? currentPreferences.viewport },
      nodes: rfNodes.map((node) => ({ id: node.id, label: node.data.label, schema: node.data.schema, scope: node.data.scope, position: node.position })),
      edges: edges.map((edge) => edge.data),
    });
  }, [connectionId, currentPreferences, edges, reactFlowInstance, rfNodes]);

  const toggleFullscreen = useCallback(async () => {
    if (!canvasRef.current) return;
    if (document.fullscreenElement === canvasRef.current) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    await canvasRef.current.requestFullscreen().catch(() => undefined);
  }, []);

  return (
    <>
      <div ref={canvasRef} className={`relative w-full overflow-hidden bg-[var(--color-bg-canvas)] ${isFullscreen ? "h-screen" : "h-[calc(100vh-120px)] min-h-[820px]"}`}>
        <div
          ref={(el) => {
            toolbarRef.current = el;
            if (el) {
              const observer = new ResizeObserver(() => setToolbarHeight(el.offsetHeight));
              observer.observe(el);
            }
          }}
          className="absolute inset-x-0 top-0 z-20 border-b border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-bg-layer-1)_90%,transparent)] px-4 py-3 backdrop-blur-md"
        >
          {/* Linha 1: título + busca + ações principais */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-[var(--color-text-primary)]">
              <h3 className="mr-2 text-sm font-semibold">Diagrama relacional</h3>
              <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
                {status === "loading" ? "Carregando..." : `${visibleTables.length} tabelas`}
              </span>
              <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
                {edges.length} relações
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar tabela, schema ou coluna"
                className="w-full rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-4 py-2.5 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)] sm:w-[280px]"
              />
              <button onClick={() => setShowFilters(true)} className="rounded-2xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--color-accent)] transition hover:bg-[color-mix(in_srgb,var(--color-accent-soft)_90%,var(--color-accent))]">
                Filtros
              </button>
              <button onClick={() => void reactFlowInstance?.fitView({ padding: 0.14, duration: 320 })} className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]">
                Ajustar tela
              </button>
              <button onClick={toggleFullscreen} className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]">
                {isFullscreen ? "Sair do fullscreen" : "Fullscreen"}
              </button>
              <ThemeToggle />
            </div>
          </div>

          {/* Linha 2: controles de layout agrupados com separadores */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[var(--color-text-primary)]">
            {/* Grupo: direção do layout */}
            <div className="flex items-center overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]">
              {(["TB", "LR"] as const).map((direction) => (
                <button
                  key={direction}
                  onClick={() => { setLayoutDirection(direction); setManualPositions(new Map()); }}
                  className={`px-3 py-2 text-xs font-semibold transition ${layoutDirection === direction ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)]" : "text-[var(--color-text-secondary)] hover:bg-[color-mix(in_srgb,var(--color-bg-layer-2)_85%,var(--color-accent)_15%)]"}`}
                  title={direction === "TB" ? "Layout vertical" : "Layout horizontal"}
                >
                  {direction === "TB" ? "↕ Vertical" : "↔ Horizontal"}
                </button>
              ))}
            </div>

            <span className="h-5 w-px bg-[var(--color-border-subtle)]" />

            {/* Grupo: modo de agrupamento */}
            <div className="flex items-center overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]">
              {([{ id: "domain", label: "Domínio" }, { id: "schema", label: "Schema" }, { id: "prefix", label: "Prefixo" }] as const).map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setGroupingMode(mode.id)}
                  className={`px-3 py-2 text-xs font-semibold transition ${groupingMode === mode.id ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)]" : "text-[var(--color-text-secondary)] hover:bg-[color-mix(in_srgb,var(--color-bg-layer-2)_85%,var(--color-accent)_15%)]"}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <span className="h-5 w-px bg-[var(--color-border-subtle)]" />

            {/* Grupo: profundidade de vizinhança */}
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">Profundidade</span>
              <select value={scopeDepth} onChange={(event) => setScopeDepth(Number(event.target.value))} className="bg-transparent text-sm text-[var(--color-text-primary)] outline-none">
                {[1, 2, 3, 4, 5].map((depth) => <option key={depth} value={depth} className="bg-[var(--color-bg-layer-1)] text-[var(--color-text-primary)]">{depth}</option>)}
              </select>
            </div>

            {/* Minimapa */}
            <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)]">
              <input type="checkbox" checked={minimap} onChange={(event) => setMinimap(event.target.checked)} className="h-4 w-4 rounded border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] text-[var(--color-accent)]" />
              Minimapa
            </label>

            <span className="h-5 w-px bg-[var(--color-border-subtle)]" />

            {/* Ações secundárias */}
            <button
              onClick={() => {
                setLinkMode((prev) => {
                  if (prev) { setLinkSource(null); }
                  return !prev;
                });
              }}
              className={`rounded-2xl border px-4 py-2 text-sm font-semibold transition ${
                linkMode
                  ? "border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_18%,var(--color-bg-layer-1))] text-[var(--color-warning)]"
                  : "border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] text-[var(--color-text-primary)] hover:border-[var(--color-accent)]"
              }`}
              title={linkMode ? "Cancelar modo de ligação" : "Ativar modo: clique em dois nós para criar FK manual"}
            >
              {linkMode ? (linkSource ? "Selecione o destino..." : "Selecione a origem...") : "Ligar FK"}
            </button>
            <button onClick={saveLayout} className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]">Salvar layout</button>
            <button onClick={exportCurrentDiagram} className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]">Exportar JSON</button>
            <button
              onClick={() => { setSelectedEdgeId(null); setSelectedNodeId(null); setSelectedScopeIds([]); setSelectedTableIds([]); setSearchQuery(""); setManualPositions(new Map()); setLinkMode(false); setLinkSource(null); }}
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)]"
            >
              Resetar
            </button>
          </div>
        </div>

        {status === "error" ? (
          <div className="flex h-full items-center justify-center px-6 pt-24">
            <div className="max-w-xl rounded-3xl border border-red-500/30 bg-red-500/10 px-6 py-5 text-center text-sm text-red-600">
              {errorMessage ?? "Não foi possível carregar o diagrama."}
            </div>
          </div>
        ) : null}

        {status === "loading" ? (
          <div className="flex h-full items-center justify-center pt-24 text-sm text-[var(--color-text-muted)]">Montando diagrama...</div>
        ) : null}

        {status === "idle" && rfNodes.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 pt-24">
            <div className="flex max-w-xl flex-col items-center gap-4 rounded-3xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-8 py-8 text-center">
              <p className="text-sm text-[var(--color-text-secondary)]">Nenhuma tabela encontrada para o escopo ou filtros ativos.</p>
              <button
                onClick={() => {
                  setSelectedScopeIds([]);
                  setSelectedTableIds([]);
                  setSearchQuery("");
 }}
                className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
              >
                Limpar filtros
              </button>
            </div>
          </div>
        ) : null}

        {linkMode ? (
          <div className="pointer-events-none absolute inset-x-0 z-10 flex justify-center" style={{ top: toolbarHeight + 12 }}>
            <div
              className="flex items-center gap-3 rounded-2xl border px-5 py-3 text-sm shadow-2xl backdrop-blur-md"
              style={{
                borderColor: "color-mix(in srgb, var(--color-warning) 45%, transparent)",
                background: "color-mix(in srgb, var(--color-warning) 15%, var(--color-bg-layer-1))",
                color: "var(--color-warning)",
              }}
            >
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--color-warning)" }} />
              {linkSource ? (
                <>
                  <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>Origem:</span>
                  <span className="font-mono" style={{ color: "var(--color-text-primary)" }}>{linkSource}</span>
                  <span className="mx-1" style={{ color: "var(--color-warning)" }}>→</span>
                  <span style={{ color: "var(--color-text-primary)" }}>clique na tabela destino</span>
                </>
              ) : (
                <span style={{ color: "var(--color-text-primary)" }}>Clique na tabela de origem da FK manual</span>
              )}
              <button
                className="pointer-events-auto ml-2 rounded-lg border px-2.5 py-1 text-xs font-semibold"
                style={{
                  borderColor: "color-mix(in srgb, var(--color-warning) 35%, transparent)",
                  background: "color-mix(in srgb, var(--color-warning) 12%, var(--color-bg-layer-1))",
                  color: "var(--color-warning)",
                }}
                onClick={() => { setLinkMode(false); setLinkSource(null); }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        {status === "idle" && rfNodes.length > 0 ? (
          <ReactFlow
            nodes={rfNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            onPaneClick={() => { if (!linkMode) { setSelectedNodeId(null); setSelectedEdgeId(null); } }}
            onNodeDragStop={handleNodeDragStop}
            onMoveEnd={() => {
              if (!preferencesLoaded) return;
              if (prefTimer.current) window.clearTimeout(prefTimer.current);
              prefTimer.current = window.setTimeout(() => {
                void fetch(`/api/diagram-preferences/${connectionId}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ ...currentPreferences, viewport: reactFlowInstance?.getViewport() ?? null }),
                }).catch(() => undefined);
              }, 250);
            }}
            onInit={setReactFlowInstance}
            fitView
            fitViewOptions={{ padding: 0.14, duration: 320 }}
            minZoom={0.2}
            maxZoom={2.2}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="color-mix(in srgb, var(--color-text-muted) 35%, transparent)" />
            {minimap ? <MiniMap pannable zoomable maskColor="color-mix(in srgb, var(--color-bg-layer-1) 88%, #000)" nodeColor={(node) => colorFor((node.data as NodeData).scope).color} className="!border !border-[var(--color-border-subtle)] !bg-[var(--color-bg-layer-1)]/95" /> : null}
            <Controls showInteractive={false} className="!border-[var(--color-border-subtle)] !bg-[var(--color-bg-layer-1)]/90 !text-[var(--color-text-primary)]" />
            <Panel position="top-left" style={{ marginTop: toolbarHeight + 12 }} className="w-[320px] rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/95 p-4 text-sm text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]">
              <p className="text-[10px] uppercase tracking-[0.26em] text-[var(--color-text-muted)]">Workbench</p>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  onClick={() => setShowFilters(true)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10"
                >
                  Escopos visíveis
                </button>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-slate-500">Profundidade</p>
                  <p className="mt-1 font-semibold text-white">{scopeDepth} saltos</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-slate-500">Agrupamento</p>
                  <p className="mt-1 font-semibold text-white capitalize">{groupingMode === "domain" ? "Domínio" : groupingMode === "schema" ? "Schema" : "Prefixo"}</p>
                </div>
              </div>
              {snapshots.length > 0 ? (
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-[0.26em] text-slate-500">Layouts salvos</p>
                  <div className="mt-3 space-y-2">
                    {snapshots.map((snapshot) => (
                      <button key={snapshot.id} onClick={() => restoreSnapshot(snapshot)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left transition hover:bg-white/10">
                        <p className="truncate font-semibold text-white">{snapshot.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{new Date(snapshot.createdAt).toLocaleString("pt-BR")}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </Panel>
            {selectedNode ? (
              <NodePanel
                node={selectedNode}
                selectedTableIds={selectedTableIds}
                neighborIds={selectedNodeNeighborIds}
                toolbarHeight={toolbarHeight}
                onFocus={() => focusTable(selectedNode.id)}
                onToggleNeighbors={toggleNeighbors}
                onClose={() => setSelectedNodeId(null)}
              />
            ) : null}
            {selectedEdge ? (
              <EdgePanel
                edge={selectedEdge}
                onRemove={selectedEdge.data?.constraint?.startsWith("manual:") ? () => removeManualEdge(selectedEdge.id) : undefined}
              />
            ) : null}
          </ReactFlow>
        ) : null}
      </div>

      <FilterModal
        open={showFilters}
        scopes={scopes}
        activeScopeSet={activeScopeSet}
        selectedTableSet={selectedTableSet}
        scopeQuery={scopeQuery}
        tableQuery={tableQuery}
        setScopeQuery={setScopeQuery}
        setTableQuery={setTableQuery}
        setSelectedScopeIds={setSelectedScopeIds}
        setSelectedTableIds={setSelectedTableIds}
        onClose={() => setShowFilters(false)}
      />
    </>
  );
}

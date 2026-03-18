"use client";

import { useEffect, useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";

const DAGRE_NODE_WIDTH = 240;
const DAGRE_NODE_HEIGHT = 280;

const basePalette = [
  "#22d3ee",
  "#a855f7",
  "#f97316",
  "#fcd34d",
  "#34d399",
  "#fb7185",
  "#38bdf8",
  "#f472b6",
];

const scopeStylesCache = new Map<string, { color: string; fill: string; border: string }>();

function getPalette(scope: string) {
  if (!scopeStylesCache.has(scope)) {
    const hash = Array.from(scope).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const base = basePalette[hash % basePalette.length];
    scopeStylesCache.set(scope, {
      color: base,
      border: `${base}88`,
      fill: `${base}22`,
    });
  }
  return scopeStylesCache.get(scope)!;
}

type DiagramScopeViewProps = {
  connectionId: string;
};

type RemoteColumn = {
  name: string;
  type: string;
  isNullable: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  references?: { table: string; column: string };
};

type RemoteNode = {
  id: string;
  label: string;
  schema: string;
  scope: string;
  columns: RemoteColumn[];
};

type RemoteEdge = {
  id: string;
  source: string;
  target: string;
  scope: string;
  constraint: string;
  columns: { source: string; target: string }[];
};

type RemoteScope = {
  id: string;
  label: string;
  description: string;
  tables: number;
};

type RemotePayload = {
  nodes: RemoteNode[];
  edges: RemoteEdge[];
  scopes: RemoteScope[];
};

type ManualEdge = {
  id: string;
  source: string;
  target: string;
  sourceColumn: string;
  targetColumn: string;
};

type TableNodeData = {
  label: string;
  schema: string;
  scope: string;
  columns: RemoteColumn[];
};

type TableEdgeData = {
  scope: string;
  constraint: string;
  columns: { source: string; target: string }[];
  manual?: boolean;
};

function ColumnRow({ column }: { column: RemoteColumn }) {
  return (
    <div className="flex items-center justify-between text-[11px] text-slate-300">
      <span className="flex items-center gap-1">
        <span
          className={`inline-flex h-4 min-w-4 items-center justify-center rounded border px-1 text-[10px] ${
            column.isPrimary
              ? "border-amber-400 text-amber-300"
              : column.isForeign
                ? "border-cyan-400 text-cyan-200"
                : "border-slate-600 text-slate-400"
          }`}
        >
          {column.isPrimary ? "PK" : column.isForeign ? "FK" : ""}
        </span>
        <span className="font-mono text-[11px] text-slate-100">{column.name}</span>
      </span>
      <span className="font-mono text-[10px] text-slate-500">{column.type}</span>
    </div>
  );
}

function TableNode({ data }: NodeProps<TableNodeData>) {
  const palette = getPalette(data.scope);
  const columns = Array.isArray(data.columns) ? data.columns : [];

  return (
    <div className="relative min-w-[220px] rounded-xl border border-slate-800 bg-slate-950/90 shadow-2xl">
      {/* Handle de entrada (esquerda) */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: palette.color, width: 10, height: 10, border: `2px solid ${palette.border}` }}
      />

      <div
        className="rounded-t-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider"
        style={{ background: palette.fill, color: palette.color }}
      >
        {data.label}
      </div>
      <div className="border-t border-slate-900/80 px-4 py-2 text-[10px] text-slate-500">{data.schema}</div>
      <div className="border-t border-slate-900/80 px-4 py-3 text-[11px] text-slate-400">
        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Colunas</p>
        <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-auto pr-2">
          {columns.length === 0 && <p className="text-slate-600">Sem colunas</p>}
          {columns.map((column) => (
            <ColumnRow key={column.name} column={column} />
          ))}
        </div>
      </div>

      {/* Handle de saída (direita) */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: palette.color, width: 10, height: 10, border: `2px solid ${palette.border}` }}
      />
    </div>
  );
}

const nodeTypes = { table: TableNode };

function normalizeColumn(column: unknown): RemoteColumn | null {
  if (!column || typeof column !== "object") {
    return null;
  }

  const candidate = column as Partial<RemoteColumn>;
  if (typeof candidate.name !== "string" || typeof candidate.type !== "string") {
    return null;
  }

  return {
    name: candidate.name,
    type: candidate.type,
    isNullable: Boolean(candidate.isNullable),
    isPrimary: Boolean(candidate.isPrimary),
    isForeign: Boolean(candidate.isForeign),
    references:
      candidate.references &&
      typeof candidate.references.table === "string" &&
      typeof candidate.references.column === "string"
        ? candidate.references
        : undefined,
  };
}

function normalizeDiagramPayload(payload: unknown): RemotePayload {
  const empty: RemotePayload = { nodes: [], edges: [], scopes: [] };
  if (!payload || typeof payload !== "object") {
    return empty;
  }

  const raw = payload as Partial<RemotePayload>;

  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes
        .map((node) => {
          if (!node || typeof node !== "object") {
            return null;
          }

          const candidate = node as Partial<RemoteNode>;
          if (
            typeof candidate.id !== "string" ||
            typeof candidate.label !== "string" ||
            typeof candidate.schema !== "string" ||
            typeof candidate.scope !== "string"
          ) {
            return null;
          }

          return {
            id: candidate.id,
            label: candidate.label,
            schema: candidate.schema,
            scope: candidate.scope,
            columns: Array.isArray(candidate.columns)
              ? candidate.columns.map(normalizeColumn).filter((item): item is RemoteColumn => item !== null)
              : [],
          } satisfies RemoteNode;
        })
        .filter((item): item is RemoteNode => item !== null)
    : [];

  const edges = Array.isArray(raw.edges)
    ? raw.edges
        .map((edge) => {
          if (!edge || typeof edge !== "object") {
            return null;
          }

          const candidate = edge as Partial<RemoteEdge>;
          if (
            typeof candidate.id !== "string" ||
            typeof candidate.source !== "string" ||
            typeof candidate.target !== "string" ||
            typeof candidate.scope !== "string" ||
            typeof candidate.constraint !== "string"
          ) {
            return null;
          }

          return {
            id: candidate.id,
            source: candidate.source,
            target: candidate.target,
            scope: candidate.scope,
            constraint: candidate.constraint,
            columns: Array.isArray(candidate.columns)
              ? candidate.columns
                  .map((column) => {
                    if (!column || typeof column !== "object") {
                      return null;
                    }
                    const pair = column as { source?: unknown; target?: unknown };
                    return typeof pair.source === "string" && typeof pair.target === "string"
                      ? { source: pair.source, target: pair.target }
                      : null;
                  })
                  .filter((item): item is { source: string; target: string } => item !== null)
              : [],
          } satisfies RemoteEdge;
        })
        .filter((item): item is RemoteEdge => item !== null)
    : [];

  const scopes = Array.isArray(raw.scopes)
    ? raw.scopes
        .map((scope) => {
          if (!scope || typeof scope !== "object") {
            return null;
          }

          const candidate = scope as Partial<RemoteScope>;
          if (
            typeof candidate.id !== "string" ||
            typeof candidate.label !== "string" ||
            typeof candidate.description !== "string"
          ) {
            return null;
          }

          return {
            id: candidate.id,
            label: candidate.label,
            description: candidate.description,
            tables: typeof candidate.tables === "number" ? candidate.tables : 0,
          } satisfies RemoteScope;
        })
        .filter((item): item is RemoteScope => item !== null)
    : [];

  return { nodes, edges, scopes };
}

function getLayoutedNodes(
  nodes: Array<Pick<Node<TableNodeData>, "id" | "data" | "type">>,
  edges: Array<Pick<Edge<TableEdgeData>, "source" | "target">>
) {
  const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: "TB",
    ranksep: 85,
    nodesep: 35,
    marginx: 24,
    marginy: 24,
    acyclicer: "greedy",
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: DAGRE_NODE_WIDTH, height: DAGRE_NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    const position = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - DAGRE_NODE_WIDTH / 2,
        y: position.y - DAGRE_NODE_HEIGHT / 2,
      },
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
    } satisfies Node<TableNodeData>;
  });
}

function makeManualEdgeId(source: string, sourceColumn: string, target: string, targetColumn: string) {
  return `manual-${source}-${sourceColumn}-${target}-${targetColumn}`;
}

export default function DiagramScopeView({ connectionId }: DiagramScopeViewProps) {
  const [selectedScope, setSelectedScope] = useState<string>("ALL");
  const [payload, setPayload] = useState<RemotePayload | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [manualEdges, setManualEdges] = useState<ManualEdge[]>([]);
  const [sourceTableId, setSourceTableId] = useState("");
  const [targetTableId, setTargetTableId] = useState("");
  const [sourceColumnName, setSourceColumnName] = useState("");
  const [targetColumnName, setTargetColumnName] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDiagram() {
      setStatus("loading");
      try {
        const res = await fetch(`/api/connections/${connectionId}/diagram`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(await res.text());
        }

        const data = normalizeDiagramPayload(await res.json());
        if (!cancelled) {
          setPayload(data);
          setStatus("idle");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Falha ao carregar diagrama", error);
          setStatus("error");
        }
      }
    }

    loadDiagram();

    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const onEdgeClick: EdgeMouseHandler = (_event, edge) => {
    setSelectedEdgeId(edge.id);
  };

  const availableTables = payload?.nodes ?? [];
  const scopeFilters = useMemo(() => {
    if (!payload) {
      return [] as { id: string; label: string; description: string }[];
    }

    return [
      { id: "ALL", label: "Visão geral", description: "Todas as entidades conectadas" },
      ...payload.scopes.map((scope) => ({
        id: scope.id,
        label: scope.label,
        description: scope.description,
      })),
    ];
  }, [payload]);

  const scopedTables = useMemo(
    () => availableTables.filter((node) => selectedScope === "ALL" || node.scope === selectedScope),
    [availableTables, selectedScope]
  );

  const visibleNodesData = useMemo(() => {
    if (!manualMode || selectedTableIds.length === 0) {
      return scopedTables;
    }

    const selected = new Set(selectedTableIds);
    return scopedTables.filter((node) => selected.has(node.id));
  }, [manualMode, scopedTables, selectedTableIds]);

  const mergedEdgesData = useMemo(() => {
    const manual: RemoteEdge[] = manualEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      scope: "manual",
      constraint: "Manual FK",
      columns: [{ source: edge.sourceColumn, target: edge.targetColumn }],
    }));

    return [...(payload?.edges ?? []), ...manual];
  }, [manualEdges, payload?.edges]);

  const nodes = useMemo(() => {
    const baseNodes = visibleNodesData.map((node) => ({
      id: node.id,
      type: "table",
      data: {
        label: node.label,
        schema: node.schema,
        scope: node.scope,
        columns: node.columns,
      },
    }));

    const visibleIds = new Set(visibleNodesData.map((node) => node.id));
    const baseEdges = mergedEdgesData
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
      }));

    return getLayoutedNodes(baseNodes, baseEdges);
  }, [mergedEdgesData, visibleNodesData]);

  const edges = useMemo(() => {
    const allowed = new Set(nodes.map((node) => node.id));

    return mergedEdgesData
      .filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))
      .map((edge) => {
        const palette = getPalette(edge.scope);
        const manual = edge.constraint === "Manual FK";

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          data: {
            scope: edge.scope,
            constraint: edge.constraint,
            columns: edge.columns,
            manual,
          },
          label: edge.constraint,
          labelBgPadding: [6, 2],
          labelBgBorderRadius: 6,
          labelStyle: { fill: palette.color, fontSize: 10 },
          animated: manual,
          style: {
            stroke: palette.color,
            strokeWidth: manual ? 3 : 2,
            strokeDasharray: manual ? "6 4" : undefined,
          },
        } satisfies Edge<TableEdgeData>;
      });
  }, [mergedEdgesData, nodes]);

  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const activeScope = scopeFilters.find((scope) => scope.id === selectedScope);
  const sourceColumns = availableTables.find((table) => table.id === sourceTableId)?.columns ?? [];
  const targetColumns = availableTables.find((table) => table.id === targetTableId)?.columns ?? [];

  function toggleTableSelection(tableId: string) {
    setSelectedTableIds((current) =>
      current.includes(tableId) ? current.filter((id) => id !== tableId) : [...current, tableId]
    );
  }

  function createManualEdge() {
    if (!sourceTableId || !targetTableId || !sourceColumnName || !targetColumnName) {
      return;
    }

    const id = makeManualEdgeId(sourceTableId, sourceColumnName, targetTableId, targetColumnName);
    setManualEdges((current) => {
      if (current.some((edge) => edge.id === id)) {
        return current;
      }

      return [
        ...current,
        {
          id,
          source: sourceTableId,
          target: targetTableId,
          sourceColumn: sourceColumnName,
          targetColumn: targetColumnName,
        },
      ];
    });
    setSelectedEdgeId(id);
  }

  function removeManualEdge(id: string) {
    setManualEdges((current) => current.filter((edge) => edge.id !== id));
    setSelectedEdgeId((current) => (current === id ? null : current));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Escopos disponíveis</p>
          <h3 className="text-xl font-semibold text-slate-100">Diagramas orientados a fluxo</h3>
          <p className="text-sm text-slate-400">
            Você pode usar o escopo detectado automaticamente ou montar seu próprio subconjunto de tabelas e relações.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800/60 bg-slate-900/80 px-4 py-2 text-sm text-slate-300">
          {status === "loading" ? "Carregando..." : `${visibleNodesData.length} tabelas • ${edges.length} relações`}
        </div>
      </div>

      {status === "error" && (
        <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-200">
          Não foi possível carregar o diagrama desta conexão. Verifique se as credenciais têm acesso ao INFORMATION_SCHEMA.
        </div>
      )}

      {scopeFilters.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {scopeFilters.map((scope) => (
            <button
              key={scope.id}
              onClick={() => setSelectedScope(scope.id)}
              className={`rounded-2xl border px-4 py-2 text-left text-xs transition md:text-sm ${
                selectedScope === scope.id
                  ? "border-cyan-400 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.25)]"
                  : "border-slate-800/80 text-slate-400 hover:border-slate-600 hover:text-slate-100"
              }`}
            >
              <p className="font-semibold">{scope.label}</p>
              <p className="text-[11px] text-slate-400">{scope.description}</p>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <aside className="space-y-4 rounded-2xl border border-slate-900 bg-slate-950/60 p-4">
          <div className="rounded-2xl border border-slate-800/50 bg-slate-900/40 p-4 text-xs text-slate-400">
            <p>
              Escopo ativo: <span className="text-slate-200">{activeScope?.label ?? "Visão geral"}</span>
            </p>
            <p className="mt-1">Ative o modo manual para escolher exatamente quais cards entram no fluxo.</p>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/50 px-3 py-3 text-sm text-slate-200">
            <span>Modo manual</span>
            <input
              type="checkbox"
              checked={manualMode}
              onChange={(e) => setManualMode(e.target.checked)}
              className="h-4 w-4"
            />
          </label>

          {manualMode && (
            <>
              <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-100">Tabelas do escopo</h4>
                  <button
                    type="button"
                    onClick={() => setSelectedTableIds(scopedTables.map((table) => table.id))}
                    className="text-xs text-cyan-300"
                  >
                    Selecionar todas
                  </button>
                </div>
                <div className="max-h-56 space-y-2 overflow-auto pr-1">
                  {scopedTables.map((table) => (
                    <label key={table.id} className="flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={selectedTableIds.includes(table.id)}
                        onChange={() => toggleTableSelection(table.id)}
                        className="h-4 w-4"
                      />
                      <span className="font-mono text-[12px]">{table.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-100">Adicionar FK manual</h4>
                <div className="space-y-3">
                  <select
                    value={sourceTableId}
                    onChange={(e) => {
                      setSourceTableId(e.target.value);
                      setSourceColumnName("");
                    }}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="">Tabela origem</option>
                    {visibleNodesData.map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={sourceColumnName}
                    onChange={(e) => setSourceColumnName(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="">Coluna origem</option>
                    {sourceColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={targetTableId}
                    onChange={(e) => {
                      setTargetTableId(e.target.value);
                      setTargetColumnName("");
                    }}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="">Tabela destino</option>
                    {visibleNodesData.map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={targetColumnName}
                    onChange={(e) => setTargetColumnName(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="">Coluna destino</option>
                    {targetColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={createManualEdge}
                    className="w-full rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950"
                  >
                    Criar conexão manual
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-100">Relações manuais</h4>
                <div className="space-y-2">
                  {manualEdges.length === 0 && <p className="text-xs text-slate-500">Nenhuma relação manual criada.</p>}
                  {manualEdges.map((edge) => (
                    <div key={edge.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
                      <p className="font-mono">
                        {edge.source}.{edge.sourceColumn} {"->"} {edge.target}.{edge.targetColumn}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeManualEdge(edge.id)}
                        className="mt-2 text-[11px] text-red-300"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>

        <div className="h-[calc(100vh-280px)] min-h-[540px] overflow-hidden rounded-3xl border border-slate-900 bg-slate-950/60">
          {status === "loading" && (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Montando diagrama...</div>
          )}

          {status !== "loading" && nodes.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <p>Nenhuma tabela encontrada para este escopo.</p>
              <p>Selecione outro escopo ou monte um escopo manual.</p>
            </div>
          )}

          {nodes.length > 0 && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onEdgeClick={onEdgeClick}
              onPaneClick={() => setSelectedEdgeId(null)}
              fitView
              fitViewOptions={{ padding: 0.15, includeHiddenNodes: false }}
              minZoom={0.05}
              maxZoom={2}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              proOptions={{ hideAttribution: true }}
              nodeTypes={nodeTypes}
            >
              <Background gap={18} color="#1f2937" variant={BackgroundVariant.Lines} />
              <MiniMap
                nodeColor={(node) => getPalette((node.data as TableNodeData).scope).color}
                maskColor="rgba(2,6,23,0.85)"
              />
              <Controls showInteractive={false} className="!bg-slate-900/80 !border-slate-800" />

              {selectedEdge && (
                <Panel
                  position="top-right"
                  className="w-72 rounded-2xl border border-slate-800 bg-slate-950/95 p-4 text-xs text-slate-300 shadow-2xl"
                >
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                      {selectedEdge.data?.manual ? "Relação manual" : "Foreign key"}
                    </p>
                    <p className="font-semibold text-slate-100">{selectedEdge.data?.constraint ?? selectedEdge.label}</p>
                    <div className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-3">
                      <p className="font-mono text-[11px] text-slate-200">
                        {selectedEdge.source} {"->"} {selectedEdge.target}
                      </p>
                      <div className="mt-2 space-y-1">
                        {selectedEdge.data?.columns?.map((column) => (
                          <div key={`${column.source}-${column.target}`} className="flex justify-between gap-3 text-[11px]">
                            <span className="font-mono text-cyan-200">{column.source}</span>
                            <span className="text-slate-500">{"->"}</span>
                            <span className="font-mono text-emerald-200">{column.target}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </Panel>
              )}
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
}

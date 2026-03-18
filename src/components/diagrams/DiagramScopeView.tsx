"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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

const NODE_W = 320;
const NODE_H = 360;
const MAX_COLS = 10;
const PALETTE = ["#22d3ee", "#a855f7", "#f97316", "#fcd34d", "#34d399", "#fb7185"];

type Props = { connectionId: string };
type Col = { name: string; type: string; isPrimary: boolean; isForeign: boolean };
type Tbl = { id: string; label: string; schema: string; scope: string; columns: Col[] };
type Rel = { id: string; source: string; target: string; scope: string; constraint: string; columns: { source: string; target: string }[] };
type Scope = { id: string; label: string; description: string; tables: number };
type Payload = { nodes: Tbl[]; edges: Rel[]; scopes: Scope[] };
type NodeData = { label: string; schema: string; scope: string; columns: Col[] };

const nodeTypes = { table: TableCard };

function palette(scope: string) {
  const base = PALETTE[Array.from(scope).reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
  return { color: base, fill: `${base}22`, border: `${base}88` };
}

function TableCard({ data }: NodeProps<NodeData>) {
  const p = palette(data.scope);
  const columns = data.columns.slice(0, MAX_COLS);
  const hidden = Math.max(data.columns.length - columns.length, 0);
  return (
    <div className="relative min-w-[300px] rounded-2xl border border-slate-800 bg-slate-950/95 shadow-[0_30px_80px_rgba(2,6,23,0.45)]">
      <Handle type="target" position={Position.Left} style={{ background: p.color, width: 12, height: 12, border: `2px solid ${p.border}` }} />
      <div className="rounded-t-2xl px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em]" style={{ background: p.fill, color: p.color }}>{data.label}</div>
      <div className="border-t border-slate-900/80 px-5 py-2.5 text-xs text-slate-500">{data.schema}</div>
      <div className="border-t border-slate-900/80 px-5 py-4">
        <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-slate-500"><span>Colunas</span><span>{data.columns.length}</span></div>
        <div className="flex max-h-72 flex-col gap-2 overflow-auto pr-2">
          {columns.map((col) => (
            <div key={col.name} className="flex items-center justify-between gap-3 text-xs text-slate-300">
              <span className="flex items-center gap-2">
                <span className={`inline-flex h-5 min-w-6 items-center justify-center rounded border px-1.5 text-[10px] font-semibold ${col.isPrimary ? "border-amber-400 text-amber-300" : col.isForeign ? "border-cyan-400 text-cyan-200" : "border-slate-600 text-slate-400"}`}>{col.isPrimary ? "PK" : col.isForeign ? "FK" : ""}</span>
                <span className="font-mono text-[12px] text-slate-100">{col.name}</span>
              </span>
              <span className="font-mono text-[11px] text-slate-500">{col.type}</span>
            </div>
          ))}
          {hidden > 0 && <p className="pt-2 text-[11px] text-slate-500">+{hidden} colunas ocultas para manter a leitura.</p>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: p.color, width: 12, height: 12, border: `2px solid ${p.border}` }} />
    </div>
  );
}

function normalize(payload: unknown): Payload {
  const empty: Payload = { nodes: [], edges: [], scopes: [] };
  if (!payload || typeof payload !== "object") return empty;
  const raw = payload as Partial<Payload>;
  return {
    nodes: Array.isArray(raw.nodes) ? raw.nodes.filter(Boolean) as Tbl[] : [],
    edges: Array.isArray(raw.edges) ? raw.edges.filter(Boolean) as Rel[] : [],
    scopes: Array.isArray(raw.scopes) ? raw.scopes.filter(Boolean) as Scope[] : [],
  };
}

function layoutNodes(nodes: Array<Pick<Node<NodeData>, "id" | "type" | "data">>, edges: Array<Pick<Edge, "source" | "target">>) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 140, nodesep: 90, edgesep: 50, marginx: 48, marginy: 48, acyclicer: "greedy" });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 }, sourcePosition: Position.Right, targetPosition: Position.Left } satisfies Node<NodeData>;
  });
}

export default function DiagramScopeView({ connectionId }: Props) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [scopeQuery, setScopeQuery] = useState("");
  const [tableQuery, setTableQuery] = useState("");
  const [selectedScopeIds, setSelectedScopeIds] = useState<string[]>([]);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      try {
        const res = await fetch(`/api/connections/${connectionId}/diagram`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        if (!cancelled) {
          setPayload(normalize(await res.json()));
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const scopes = useMemo(() => {
    const byScope = new Map<string, Tbl[]>();
    (payload?.nodes ?? []).forEach((node) => byScope.set(node.scope, [...(byScope.get(node.scope) ?? []), node]));
    return (payload?.scopes ?? []).map((scope) => ({ ...scope, tablesList: (byScope.get(scope.id) ?? []).sort((a, b) => a.label.localeCompare(b.label)) }));
  }, [payload]);

  const allScopeIds = scopes.map((scope) => scope.id);
  const activeScopeIds = selectedScopeIds.length > 0 ? selectedScopeIds : allScopeIds;
  const activeScopeSet = new Set(activeScopeIds);
  const selectedTableSet = new Set(selectedTableIds);

  const filteredScopes = useMemo(() => {
    const sq = scopeQuery.trim().toLowerCase();
    const tq = tableQuery.trim().toLowerCase();
    return scopes
      .filter((scope) => !sq || scope.label.toLowerCase().includes(sq) || scope.description.toLowerCase().includes(sq))
      .map((scope) => ({
        ...scope,
        filteredTables: scope.tablesList.filter((table) => !tq || table.label.toLowerCase().includes(tq) || table.schema.toLowerCase().includes(tq) || table.columns.some((col) => col.name.toLowerCase().includes(tq))),
      }));
  }, [scopeQuery, scopes, tableQuery]);

  const visibleTables = useMemo(() => {
    const scoped = (payload?.nodes ?? []).filter((node) => activeScopeSet.has(node.scope));
    return selectedTableIds.length === 0 ? scoped : scoped.filter((node) => selectedTableSet.has(node.id));
  }, [activeScopeSet, payload?.nodes, selectedTableIds.length]);

  const nodes = useMemo(() => {
    const visibleIds = new Set(visibleTables.map((n) => n.id));
    return layoutNodes(
      visibleTables.map((node) => ({ id: node.id, type: "table", data: { label: node.label, schema: node.schema, scope: node.scope, columns: node.columns } })),
      (payload?.edges ?? []).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => ({ source: edge.source, target: edge.target }))
    );
  }, [payload?.edges, visibleTables]);

  const edges = useMemo(() => {
    const allowed = new Set(nodes.map((node) => node.id));
    return (payload?.edges ?? [])
      .filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))
      .map((edge) => {
        const p = palette(edge.scope);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          data: { scope: edge.scope, constraint: edge.constraint, columns: edge.columns },
          label: edge.constraint,
          labelBgPadding: [8, 4],
          labelBgBorderRadius: 8,
          labelStyle: { fill: p.color, fontSize: 11, fontWeight: 600 },
          style: { stroke: p.color, strokeWidth: 2.25 },
        } satisfies Edge;
      });
  }, [nodes, payload?.edges]);

  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) as Edge<{ constraint: string; columns: { source: string; target: string }[] }> | undefined;

  function toggleInList(id: string, setter: Dispatch<SetStateAction<string[]>>) {
    setter((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function clearFilters() {
    setSelectedScopeIds([]);
    setSelectedTableIds([]);
    setScopeQuery("");
    setTableQuery("");
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-slate-900 bg-slate-950/70 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Canvas do diagrama</p>
            <h3 className="text-xl font-semibold text-slate-100">Fluxos relacionais por escopo</h3>
            <p className="mt-1 text-sm text-slate-400">O canvas agora prioriza área útil, e os filtros ficam em um modal com seleção por escopo e tabela.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setShowFilters(true)} className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Abrir filtros</button>
            <button type="button" onClick={clearFilters} className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 hover:border-slate-500">Limpar</button>
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/80 px-4 py-2 text-sm text-slate-300">{status === "loading" ? "Carregando..." : `${visibleTables.length} tabelas • ${edges.length} relações`}</div>
          </div>
        </div>

        {status === "error" && <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-200">Não foi possível carregar o diagrama desta conexão.</div>}

        <div className="relative h-[calc(100vh-120px)] min-h-[820px] overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950/60">
          {status === "loading" && <div className="flex h-full items-center justify-center text-sm text-slate-400">Montando diagrama...</div>}
          {status !== "loading" && nodes.length === 0 && <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400"><p>Nenhuma tabela encontrada com os filtros atuais.</p><p>Abra o modal de filtros e selecione outros escopos ou tabelas.</p></div>}
          {nodes.length > 0 && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onEdgeClick={((_e, edge) => setSelectedEdgeId(edge.id)) as EdgeMouseHandler}
              onPaneClick={() => setSelectedEdgeId(null)}
              fitView
              fitViewOptions={{ padding: 0.06, includeHiddenNodes: false, minZoom: 0.72 }}
              defaultViewport={{ x: 0, y: 0, zoom: 0.92 }}
              minZoom={0.25}
              maxZoom={2.4}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              proOptions={{ hideAttribution: true }}
              nodeTypes={nodeTypes}
            >
              <Background gap={24} size={1.2} color="#1f2937" variant={BackgroundVariant.Lines} />
              <MiniMap nodeColor={(node) => palette((node.data as NodeData).scope).color} maskColor="rgba(2,6,23,0.85)" pannable zoomable />
              <Controls showInteractive={false} className="!bg-slate-900/80 !border-slate-800" />
              {selectedEdge && (
                <Panel position="top-right" className="w-80 rounded-2xl border border-slate-800 bg-slate-950/95 p-4 text-xs text-slate-300 shadow-2xl">
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Foreign key</p>
                    <p className="font-semibold text-slate-100">{selectedEdge.data?.constraint ?? selectedEdge.label}</p>
                    <div className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-3">
                      <p className="font-mono text-[11px] text-slate-200">{selectedEdge.source} {"->"} {selectedEdge.target}</p>
                      <div className="mt-2 space-y-1">{selectedEdge.data?.columns?.map((c) => <div key={`${c.source}-${c.target}`} className="flex justify-between gap-3 text-[11px]"><span className="font-mono text-cyan-200">{c.source}</span><span className="text-slate-500">{"->"}</span><span className="font-mono text-emerald-200">{c.target}</span></div>)}</div>
                    </div>
                  </div>
                </Panel>
              )}
            </ReactFlow>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-950 shadow-[0_40px_120px_rgba(2,6,23,0.75)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Filtros do diagrama</p>
                <h4 className="text-2xl font-semibold text-slate-100">Escopos e tabelas visíveis</h4>
                <p className="mt-1 text-sm text-slate-400">Se nenhuma tabela estiver marcada, o diagrama mostra todas as tabelas dos escopos ativos.</p>
              </div>
              <button type="button" onClick={() => setShowFilters(false)} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:border-slate-500">Fechar</button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_1fr]">
              <aside className="border-r border-slate-800 bg-slate-950/80 p-5">
                <div className="space-y-3">
                  <input value={scopeQuery} onChange={(e) => setScopeQuery(e.target.value)} placeholder="Buscar escopo" className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setSelectedScopeIds(allScopeIds)} className="flex-1 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200">Todos</button>
                    <button type="button" onClick={() => setSelectedScopeIds([])} className="flex-1 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200">Limpar</button>
                  </div>
                </div>
                <div className="mt-5 space-y-2 overflow-auto pr-1">
                  {filteredScopes.map((scope) => {
                    const checked = activeScopeSet.has(scope.id);
                    return (
                      <label key={scope.id} className={`block rounded-2xl border p-3 ${checked ? "border-cyan-400 bg-cyan-400/10" : "border-slate-800 bg-slate-900/40"}`}>
                        <div className="flex items-start gap-3">
                          <input type="checkbox" checked={checked} onChange={() => toggleInList(scope.id, setSelectedScopeIds)} className="mt-1 h-4 w-4" />
                          <div>
                            <p className="text-sm font-semibold text-slate-100">{scope.label}</p>
                            <p className="mt-1 text-xs text-slate-400">{scope.description}</p>
                            <p className="mt-2 text-[11px] uppercase tracking-[0.25em] text-slate-500">{scope.tablesList.length} tabelas</p>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </aside>

              <div className="flex min-h-0 flex-col bg-slate-950/60">
                <div className="border-b border-slate-800 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <input value={tableQuery} onChange={(e) => setTableQuery(e.target.value)} placeholder="Buscar tabela, schema ou coluna" className="min-w-[260px] flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" />
                    <button type="button" onClick={() => setSelectedTableIds([])} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200">Mostrar todas</button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
                  <div className="space-y-5">
                    {filteredScopes.filter((scope) => activeScopeSet.has(scope.id)).map((scope) => (
                      <section key={scope.id} className="rounded-3xl border border-slate-800 bg-slate-900/35 p-4">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                          <div><h5 className="text-lg font-semibold text-slate-100">{scope.label}</h5><p className="text-sm text-slate-400">{scope.description}</p></div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setSelectedTableIds((c) => Array.from(new Set([...c, ...scope.tablesList.map((t) => t.id)])))} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200">Selecionar escopo</button>
                            <button type="button" onClick={() => setSelectedTableIds((c) => c.filter((id) => !scope.tablesList.some((t) => t.id === id)))} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200">Limpar escopo</button>
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {scope.filteredTables.map((table) => {
                            const checked = selectedTableSet.has(table.id);
                            const p = palette(table.scope);
                            return (
                              <label key={table.id} className={`rounded-2xl border p-4 ${checked ? "border-cyan-400 bg-cyan-400/10" : "border-slate-800 bg-slate-950/50"}`}>
                                <div className="flex items-start gap-3">
                                  <input type="checkbox" checked={checked} onChange={() => toggleInList(table.id, setSelectedTableIds)} className="mt-1 h-4 w-4" />
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold uppercase tracking-[0.2em]" style={{ color: p.color }}>{table.label}</p>
                                    <p className="mt-1 text-xs text-slate-500">{table.schema}</p>
                                    <p className="mt-3 text-[11px] text-slate-400">{table.columns.length} colunas</p>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

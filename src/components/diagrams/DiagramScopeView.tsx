"use client";

import { useEffect, useMemo, useState, useCallback, type Dispatch, type SetStateAction } from "react";
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
const PALETTE = ["#22d3ee", "#a855f7", "#f97316", "#fcd34d", "#34d399", "#fb7185"];

type Props = { connectionId: string };
type Col = { name: string; type: string; isPrimary: boolean; isForeign: boolean };
type Tbl = { id: string; label: string; schema: string; scope: string; columns: Col[] };
type Rel = { id: string; source: string; target: string; scope: string; constraint: string; columns: { source: string; target: string }[] };
type Scope = { id: string; label: string; description: string; tables: number };
type Payload = { nodes: Tbl[]; edges: Rel[]; scopes: Scope[] };
type NodeData = { label: string; schema: string; scope: string; columns: Col[]; expanded: boolean };

const nodeTypes = { table: TableCard };

function palette(scope: string) {
  const base = PALETTE[Array.from(scope).reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
  return { color: base, fill: `${base}18`, border: `${base}66` };
}

function TableCard({ data }: NodeProps<NodeData>) {
  const p = palette(data.scope);
  const [expanded, setExpanded] = useState(false);
  const visibleCols = expanded ? data.columns : data.columns.slice(0, 8);
  const hidden = data.columns.length - visibleCols.length;

  return (
    <div
      className="relative min-w-[300px] rounded-2xl border bg-slate-950/95 shadow-[0_20px_60px_rgba(2,6,23,0.55)]"
      style={{ borderColor: p.border }}
    >
      <Handle type="target" position={Position.Left} style={{ background: p.color, width: 11, height: 11, border: `2px solid ${p.border}` }} />

      <div
        className="rounded-t-2xl px-5 py-3 text-sm font-bold uppercase tracking-[0.22em]"
        style={{ background: p.fill, color: p.color, borderBottom: `1px solid ${p.border}` }}
      >
        {data.label}
      </div>

      <div className="border-b border-slate-900/80 px-5 py-2 text-xs text-slate-500 font-mono">{data.schema}</div>

      <div className="px-5 py-4">
        <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-500">
          <span>Colunas</span>
          <span style={{ color: p.color }}>{data.columns.length}</span>
        </div>
        <div className="flex flex-col gap-2">
          {visibleCols.map((col) => (
            <div key={col.name} className="flex items-center justify-between gap-3 text-xs text-slate-300">
              <span className="flex items-center gap-2">
                <span
                  className={`inline-flex h-5 min-w-[26px] items-center justify-center rounded border px-1.5 text-[10px] font-semibold ${
                    col.isPrimary
                      ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
                      : col.isForeign
                      ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-200"
                      : "border-slate-700/60 text-slate-500"
                  }`}
                >
                  {col.isPrimary ? "PK" : col.isForeign ? "FK" : ""}
                </span>
                <span className="font-mono text-[12px] text-slate-100">{col.name}</span>
              </span>
              <span className="font-mono text-[11px] text-slate-500">{col.type}</span>
            </div>
          ))}
          {(hidden > 0 || expanded) && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 w-full rounded-xl border border-slate-800 py-1.5 text-[11px] text-slate-400 hover:border-slate-600 hover:text-slate-200 transition-colors"
            >
              {expanded ? "▲ Recolher colunas" : `▼ +${hidden} colunas`}
            </button>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Right} style={{ background: p.color, width: 11, height: 11, border: `2px solid ${p.border}` }} />
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

function layoutNodes(
  nodes: Array<Pick<Node<NodeData>, "id" | "type" | "data">>,
  edges: Array<Pick<Edge, "source" | "target">>
) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 140, nodesep: 90, edgesep: 50, marginx: 48, marginy: 48, acyclicer: "greedy" });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    } satisfies Node<NodeData>;
  });
}

// ─── Filter Modal ──────────────────────────────────────────────────────────────

type ScopeWithTables = Scope & { tablesList: Tbl[]; filteredTables: Tbl[] };

type FilterModalProps = {
  scopes: ScopeWithTables[];
  allScopeIds: string[];
  activeScopeSet: Set<string>;
  selectedTableSet: Set<string>;
  selectedScopeIds: string[];
  selectedTableIds: string[];
  scopeQuery: string;
  tableQuery: string;
  setScopeQuery: (v: string) => void;
  setTableQuery: (v: string) => void;
  setSelectedScopeIds: Dispatch<SetStateAction<string[]>>;
  setSelectedTableIds: Dispatch<SetStateAction<string[]>>;
  toggleInList: (id: string, setter: Dispatch<SetStateAction<string[]>>) => void;
  onClose: () => void;
  visibleCount: number;
  edgeCount: number;
};

function FilterModal({
  scopes,
  allScopeIds,
  activeScopeSet,
  selectedTableSet,
  selectedScopeIds,
  selectedTableIds,
  scopeQuery,
  tableQuery,
  setScopeQuery,
  setTableQuery,
  setSelectedScopeIds,
  setSelectedTableIds,
  toggleInList,
  onClose,
  visibleCount,
  edgeCount,
}: FilterModalProps) {
  const [activeTab, setActiveTab] = useState<"scopes" | "tables">("scopes");

  const totalAvailableTables = useMemo(
    () => scopes.filter((s) => activeScopeSet.has(s.id)).reduce((acc, s) => acc + s.tablesList.length, 0),
    [scopes, activeScopeSet]
  );

  const activeScopes = scopes.filter((s) => activeScopeSet.has(s.id));
  const filteredActiveScopes = scopes.filter((s) => activeScopeSet.has(s.id) && s.filteredTables.length > 0);

  const selectAllTables = () => {
    const all = activeScopes.flatMap((s) => s.tablesList.map((t) => t.id));
    setSelectedTableIds(all);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-slate-950/75 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-t-[2rem] sm:rounded-[2rem] border border-white/[0.06] bg-[#080d16] shadow-[0_40px_120px_rgba(0,0,0,0.8)]"
        style={{ maxHeight: "92vh" }}
      >
        {/* Topo decorativo */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
        <div className="absolute left-1/2 top-0 h-40 w-96 -translate-x-1/2 rounded-full bg-cyan-500/5 blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="relative flex items-start justify-between gap-4 px-7 pt-7 pb-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.5em] text-cyan-500/70 mb-1">Filtros do diagrama</p>
            <h4 className="text-2xl font-bold text-white leading-tight">Escopos &amp; Tabelas</h4>
            <p className="mt-1.5 text-sm text-slate-400/80">
              Exibindo{" "}
              <span className="text-cyan-400 font-semibold">{visibleCount} tabelas</span>{" "}
              e{" "}
              <span className="text-purple-400 font-semibold">{edgeCount} relações</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white transition-all"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="relative flex gap-1 border-b border-white/[0.06] px-7 pb-0">
          {(["scopes", "tables"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-4 pb-3 pt-1 text-sm font-semibold transition-colors ${
                activeTab === tab ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {tab === "scopes" ? `Escopos (${allScopeIds.length})` : `Tabelas (${totalAvailableTables})`}
              {activeTab === tab && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400" />
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">

          {/* ── ABA ESCOPOS ── */}
          {activeTab === "scopes" && (
            <div className="p-7 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">⌕</span>
                  <input
                    value={scopeQuery}
                    onChange={(e) => setScopeQuery(e.target.value)}
                    placeholder="Buscar escopo..."
                    className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] pl-8 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 outline-none focus:border-cyan-500/50 focus:bg-white/[0.06] transition-all"
                  />
                </div>
                <button
                  onClick={() => setSelectedScopeIds([])}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] hover:text-white transition-all"
                >
                  Todos os escopos
                </button>
                <button
                  onClick={() => setSelectedScopeIds(allScopeIds)}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] hover:text-white transition-all"
                >
                  Nenhum
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {scopes
                  .filter(
                    (s) =>
                      !scopeQuery ||
                      s.label.toLowerCase().includes(scopeQuery.toLowerCase()) ||
                      s.description.toLowerCase().includes(scopeQuery.toLowerCase())
                  )
                  .map((scope) => {
                    const checked = activeScopeSet.has(scope.id);
                    const p = palette(scope.id);
                    return (
                      <label
                        key={scope.id}
                        className={`group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border p-4 transition-all ${
                          checked
                            ? "border-transparent bg-gradient-to-br from-white/[0.07] to-white/[0.03]"
                            : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                        }`}
                        style={checked ? { boxShadow: `0 0 0 1.5px ${p.color}55, inset 0 1px 0 ${p.color}22` } : {}}
                      >
                        {checked && (
                          <div
                            className="absolute inset-x-0 top-0 h-px"
                            style={{ background: `linear-gradient(90deg, transparent, ${p.color}88, transparent)` }}
                          />
                        )}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-white">{scope.label}</p>
                            <p className="mt-1 text-xs text-slate-500 leading-relaxed line-clamp-2">{scope.description}</p>
                          </div>
                          <div
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold transition-all ${
                              checked ? "border-transparent text-slate-900" : "border-white/20 text-transparent"
                            }`}
                            style={checked ? { background: p.color } : {}}
                          >
                            ✓
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
                            style={{ color: p.color }}
                          >
                            {scope.tablesList.length} tabelas
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleInList(scope.id, setSelectedScopeIds)}
                          className="sr-only"
                        />
                      </label>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ── ABA TABELAS ── */}
          {activeTab === "tables" && (
            <div className="flex flex-col">
              <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#080d16]/90 backdrop-blur-sm px-7 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[260px]">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">⌕</span>
                    <input
                      value={tableQuery}
                      onChange={(e) => setTableQuery(e.target.value)}
                      placeholder="Buscar por tabela, schema ou coluna..."
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] pl-8 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 outline-none focus:border-cyan-500/50 focus:bg-white/[0.06] transition-all"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={selectAllTables}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] hover:text-white transition-all"
                    >
                      Selecionar todas
                    </button>
                    <button
                      onClick={() => setSelectedTableIds([])}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] hover:text-white transition-all"
                    >
                      Mostrar todas
                    </button>
                  </div>
                </div>

                {selectedTableIds.length > 0 ? (
                  <p className="mt-2 text-xs text-cyan-400/80">
                    {selectedTableIds.length} tabela{selectedTableIds.length !== 1 ? "s" : ""} selecionada
                    {selectedTableIds.length !== 1 ? "s" : ""} — o diagrama exibe apenas estas.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Nenhuma tabela selecionada — exibindo todas as {totalAvailableTables} tabelas dos escopos ativos.
                  </p>
                )}
              </div>

              <div className="px-7 py-5 space-y-6">
                {filteredActiveScopes.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <p className="text-3xl mb-3">🔍</p>
                    <p className="text-slate-400 font-semibold">Nenhuma tabela encontrada</p>
                    <p className="text-slate-600 text-sm mt-1">Tente ajustar os filtros ou ativar mais escopos.</p>
                  </div>
                )}

                {filteredActiveScopes.map((scope) => {
                  const p = palette(scope.id);
                  const allScopeTableIds = scope.tablesList.map((t) => t.id);
                  const selectedInScope = allScopeTableIds.filter((id) => selectedTableSet.has(id));
                  const allInScopeSelected =
                    allScopeTableIds.length > 0 && selectedInScope.length === allScopeTableIds.length;

                  return (
                    <section
                      key={scope.id}
                      className="rounded-3xl border border-white/[0.06] bg-white/[0.02] overflow-hidden"
                    >
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4"
                        style={{ background: `linear-gradient(90deg, ${p.color}12, transparent)` }}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }}
                          />
                          <div>
                            <h5 className="text-sm font-bold text-white">{scope.label}</h5>
                            <p className="text-xs text-slate-500">
                              {scope.filteredTables.length} de {scope.tablesList.length} tabelas
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (allInScopeSelected) {
                              setSelectedTableIds((c) => c.filter((id) => !allScopeTableIds.includes(id)));
                            } else {
                              setSelectedTableIds((c) => Array.from(new Set([...c, ...allScopeTableIds])));
                            }
                          }}
                          className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold transition-all hover:bg-white/[0.08]"
                          style={{ color: p.color }}
                        >
                          {allInScopeSelected ? "Desmarcar escopo" : "Selecionar escopo"}
                        </button>
                      </div>

                      <div className="grid gap-2.5 p-4 sm:grid-cols-2 xl:grid-cols-3">
                        {scope.filteredTables.map((table) => {
                          const checked = selectedTableSet.has(table.id);
                          return (
                            <label
                              key={table.id}
                              className={`group relative flex cursor-pointer items-start gap-3 overflow-hidden rounded-2xl border p-3.5 transition-all ${
                                checked
                                  ? "border-transparent"
                                  : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                              }`}
                              style={checked ? { background: `${p.color}12`, boxShadow: `0 0 0 1px ${p.color}44` } : {}}
                            >
                              <div
                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold transition-all ${
                                  checked ? "border-transparent text-slate-900" : "border-white/20 text-transparent"
                                }`}
                                style={checked ? { background: p.color } : {}}
                              >
                                ✓
                              </div>
                              <div className="min-w-0 flex-1">
                                <p
                                  className="truncate text-xs font-bold uppercase tracking-[0.18em]"
                                  style={{ color: p.color }}
                                >
                                  {table.label}
                                </p>
                                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{table.schema}</p>
                                <p className="mt-1.5 text-[11px] text-slate-600">{table.columns.length} colunas</p>
                              </div>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleInList(table.id, setSelectedTableIds)}
                                className="sr-only"
                              />
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between gap-4 border-t border-white/[0.06] px-7 py-4 bg-[#080d16]">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          <p className="text-xs text-slate-600">
            {selectedScopeIds.length > 0
              ? `${selectedScopeIds.length} escopo${selectedScopeIds.length !== 1 ? "s" : ""} ativo${selectedScopeIds.length !== 1 ? "s" : ""}`
              : "Todos os escopos ativos"}
            {selectedTableIds.length > 0 && ` · ${selectedTableIds.length} tabelas selecionadas`}
          </p>
          <button
            onClick={onClose}
            className="rounded-xl bg-cyan-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-400 transition-colors shadow-[0_0_20px_rgba(34,211,238,0.25)]"
          >
            Aplicar filtros
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

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
    return () => { cancelled = true; };
  }, [connectionId]);

  // selectedTableSet memoizado para evitar recriação a cada render
  const selectedTableSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);

  const scopes = useMemo(() => {
    const byScope = new Map<string, Tbl[]>();
    (payload?.nodes ?? []).forEach((node) =>
      byScope.set(node.scope, [...(byScope.get(node.scope) ?? []), node])
    );
    return (payload?.scopes ?? []).map((scope) => ({
      ...scope,
      tablesList: (byScope.get(scope.id) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }, [payload]);

  const allScopeIds = useMemo(() => scopes.map((s) => s.id), [scopes]);

  // Nenhum escopo explicitamente selecionado → todos ativos
  const activeScopeIds = selectedScopeIds.length > 0 ? selectedScopeIds : allScopeIds;
  const activeScopeSet = useMemo(() => new Set(activeScopeIds), [activeScopeIds]);

  const filteredScopes = useMemo(() => {
    const sq = scopeQuery.trim().toLowerCase();
    const tq = tableQuery.trim().toLowerCase();
    return scopes
      .filter((s) => !sq || s.label.toLowerCase().includes(sq) || s.description.toLowerCase().includes(sq))
      .map((scope) => ({
        ...scope,
        filteredTables: scope.tablesList.filter(
          (t) =>
            !tq ||
            t.label.toLowerCase().includes(tq) ||
            t.schema.toLowerCase().includes(tq) ||
            t.columns.some((col) => col.name.toLowerCase().includes(tq))
        ),
      }));
  }, [scopeQuery, scopes, tableQuery]);

  // Tabelas visíveis: filtradas por escopo ativo e, opcionalmente, por seleção manual
  const visibleTables = useMemo(() => {
    const scoped = (payload?.nodes ?? []).filter((node) => activeScopeSet.has(node.scope));
    return selectedTableIds.length === 0 ? scoped : scoped.filter((node) => selectedTableSet.has(node.id));
  }, [activeScopeSet, payload?.nodes, selectedTableIds, selectedTableSet]);

  const nodes = useMemo(() => {
    const visibleIds = new Set(visibleTables.map((n) => n.id));
    return layoutNodes(
      visibleTables.map((node) => ({
        id: node.id,
        type: "table",
        data: { label: node.label, schema: node.schema, scope: node.scope, columns: node.columns, expanded: false },
      })),
      (payload?.edges ?? [])
        .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
        .map((e) => ({ source: e.source, target: e.target }))
    );
  }, [payload?.edges, visibleTables]);

  const edges = useMemo(() => {
    const allowed = new Set(nodes.map((n) => n.id));
    return (payload?.edges ?? [])
      .filter((e) => allowed.has(e.source) && allowed.has(e.target))
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
          style: { stroke: p.color, strokeWidth: 2 },
        } satisfies Edge;
      });
  }, [nodes, payload?.edges]);

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) as
    | Edge<{ constraint: string; columns: { source: string; target: string }[] }>
    | undefined;

  const toggleInList = useCallback((id: string, setter: Dispatch<SetStateAction<string[]>>) => {
    setter((curr) => (curr.includes(id) ? curr.filter((item) => item !== id) : [...curr, id]));
  }, []);

  function clearFilters() {
    setSelectedScopeIds([]);
    setSelectedTableIds([]);
    setScopeQuery("");
    setTableQuery("");
  }

  const hasActiveFilters = selectedScopeIds.length > 0 || selectedTableIds.length > 0;

  return (
    <>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-slate-900 bg-slate-950/70 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Canvas do diagrama</p>
            <h3 className="text-xl font-semibold text-slate-100">Fluxos relacionais por escopo</h3>
            <p className="mt-1 text-sm text-slate-400">Visualize e filtre tabelas por escopo e relações entre elas.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowFilters(true)}
              className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 transition-colors"
            >
              {hasActiveFilters ? "✦ Filtros ativos" : "Abrir filtros"}
            </button>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 hover:border-slate-500 transition-colors"
              >
                Limpar filtros
              </button>
            )}
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/80 px-4 py-2 text-sm text-slate-300">
              {status === "loading" ? "Carregando..." : `${visibleTables.length} tabelas · ${edges.length} relações`}
            </div>
          </div>
        </div>

        {status === "error" && (
          <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-200">
            Não foi possível carregar o diagrama desta conexão.
          </div>
        )}

        {/* Canvas */}
        <div className="relative h-[calc(100vh-120px)] min-h-[820px] overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950/60">
          {status === "loading" && (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Montando diagrama...
            </div>
          )}
          {status !== "loading" && nodes.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <p>Nenhuma tabela encontrada com os filtros atuais.</p>
              <p>Abra os filtros e selecione outros escopos ou tabelas.</p>
            </div>
          )}
          {nodes.length > 0 && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onEdgeClick={((_e, edge) => setSelectedEdgeId(edge.id)) as EdgeMouseHandler}
              onPaneClick={() => setSelectedEdgeId(null)}
              fitView
              fitViewOptions={{ padding: 0.06, includeHiddenNodes: false }}
              minZoom={0.25}
              maxZoom={2.4}
              nodesDraggable={true}
              nodesConnectable={false}
              elementsSelectable={false}
              proOptions={{ hideAttribution: true }}
              nodeTypes={nodeTypes}
            >
              <Background gap={24} size={1.2} color="#1f2937" variant={BackgroundVariant.Lines} />
              <MiniMap
                nodeColor={(node) => palette((node.data as NodeData).scope).color}
                maskColor="rgba(2,6,23,0.85)"
                pannable
                zoomable
              />
              <Controls showInteractive={false} className="!bg-slate-900/80 !border-slate-800" />
              {selectedEdge && (
                <Panel
                  position="top-right"
                  className="w-80 rounded-2xl border border-slate-800 bg-slate-950/95 p-4 text-xs text-slate-300 shadow-2xl"
                >
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Foreign key</p>
                    <p className="font-semibold text-slate-100">
                      {selectedEdge.data?.constraint ?? selectedEdge.label}
                    </p>
                    <div className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-3">
                      <p className="font-mono text-[11px] text-slate-200">
                        {selectedEdge.source} {"→"} {selectedEdge.target}
                      </p>
                      <div className="mt-2 space-y-1">
                        {selectedEdge.data?.columns?.map((c) => (
                          <div key={`${c.source}-${c.target}`} className="flex justify-between gap-3 text-[11px]">
                            <span className="font-mono text-cyan-200">{c.source}</span>
                            <span className="text-slate-500">→</span>
                            <span className="font-mono text-emerald-200">{c.target}</span>
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

      {showFilters && (
        <FilterModal
          scopes={filteredScopes}
          allScopeIds={allScopeIds}
          activeScopeSet={activeScopeSet}
          selectedTableSet={selectedTableSet}
          selectedScopeIds={selectedScopeIds}
          selectedTableIds={selectedTableIds}
          scopeQuery={scopeQuery}
          tableQuery={tableQuery}
          setScopeQuery={setScopeQuery}
          setTableQuery={setTableQuery}
          setSelectedScopeIds={setSelectedScopeIds}
          setSelectedTableIds={setSelectedTableIds}
          toggleInList={toggleInList}
          onClose={() => setShowFilters(false)}
          visibleCount={visibleTables.length}
          edgeCount={edges.length}
        />
      )}
    </>
  );
}

"use client";

import { Search, Table2, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { DiffStatus } from "@/components/migrations/MigrationDiagram";

/**
 * Só o que a lista usa. Estrutural de propósito: aceita tanto o `DiagramResponse` (DTO da API)
 * quanto o payload local do canvas, que não carrega `isNullable`.
 */
export type MigrationTableListDiagram = {
  nodes: Array<{
    id: string;
    label: string;
    scope: string;
    schema: string;
    columns: Array<{ name: string }>;
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
  scopes: Array<{ id: string; label: string; tables: number }>;
};

type Props = {
  diagram: MigrationTableListDiagram;
  diffMap?: Map<string, DiffStatus>;
  selectedTableId: string | null;
  onSelect: (tableId: string | null) => void;
};

const STATUS_STYLE: Record<"added" | "altered" | "removed", string> = {
  added: "bg-emerald-400",
  altered: "bg-amber-400",
  removed: "bg-rose-400",
};

/**
 * Lista navegável das tabelas do snapshot atual. Existe porque conexões de migrations não têm
 * banco real por trás — o Explorer fica indisponível — e o canvas ER só mostra o que cabe na
 * viewport. Aqui dá pra buscar por tabela ou coluna e ver o que cada migration alterou.
 */
export default function MigrationTableList({ diagram, diffMap, selectedTableId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [scope, setScope] = useState("all");

  const relations = useMemo(() => {
    const outgoing = new Map<string, number>();
    const incoming = new Map<string, number>();
    for (const edge of diagram.edges) {
      outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    }
    return { outgoing, incoming };
  }, [diagram.edges]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return diagram.nodes
      .map((node) => {
        const status = diffMap?.get(node.id);
        const matchedColumns = needle
          ? node.columns.filter((c) => c.name.toLowerCase().includes(needle)).map((c) => c.name)
          : [];
        return {
          node,
          status,
          matchedColumns,
          outgoing: relations.outgoing.get(node.id) ?? 0,
          incoming: relations.incoming.get(node.id) ?? 0,
        };
      })
      .filter((row) => (scope === "all" ? true : row.node.scope === scope))
      .filter((row) => !onlyChanged || Boolean(row.status))
      .filter((row) => {
        if (!needle) return true;
        return (
          row.node.label.toLowerCase().includes(needle) ||
          row.node.id.toLowerCase().includes(needle) ||
          row.matchedColumns.length > 0
        );
      })
      .sort((a, b) => a.node.scope.localeCompare(b.node.scope) || a.node.label.localeCompare(b.node.label));
  }, [diagram.nodes, diffMap, query, onlyChanged, scope, relations]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!map.has(row.node.scope)) map.set(row.node.scope, []);
      map.get(row.node.scope)!.push(row);
    }
    return Array.from(map.entries());
  }, [rows]);

  const changedCount = useMemo(
    () => diagram.nodes.filter((node) => diffMap?.get(node.id)).length,
    [diagram.nodes, diffMap]
  );

  return (
    <div className="flex h-[640px] flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60">
      <div className="space-y-2 border-b border-[var(--color-border-subtle)] p-3">
        <div className="flex items-center gap-2">
          <Table2 className="h-3.5 w-3.5 text-[var(--color-accent)]" />
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            Tabelas
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            {rows.length}/{diagram.nodes.length}
          </span>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar tabela ou coluna..."
            aria-label="Buscar tabela ou coluna"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] py-1.5 pl-7 pr-7 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-text-muted)] transition hover:text-[var(--color-text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            aria-label="Filtrar por módulo"
            className="min-w-0 flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none"
          >
            <option value="all">todos os módulos</option>
            {diagram.scopes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.tables})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setOnlyChanged((value) => !value)}
            aria-pressed={onlyChanged}
            disabled={changedCount === 0}
            title="Mostrar só tabelas que esta migration alterou"
            className={`shrink-0 rounded-md border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
              onlyChanged
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            }`}
          >
            alteradas ({changedCount})
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="p-3 text-xs text-[var(--color-text-muted)]">Nenhuma tabela encontrada.</p>
        ) : (
          grouped.map(([scopeId, scopeRows]) => (
            <div key={scopeId} className="mb-2">
              <p className="px-1.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                {scopeId} <span className="opacity-60">({scopeRows.length})</span>
              </p>
              <ul className="space-y-0.5">
                {scopeRows.map((row) => {
                  const active = selectedTableId === row.node.id;
                  return (
                    <li key={row.node.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(active ? null : row.node.id)}
                        title={`${row.node.id}${row.node.schema ? ` (${row.node.schema})` : ""}`}
                        className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                          active
                            ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
                            : "border-transparent hover:border-[var(--color-border-strong)] hover:bg-[var(--color-panel-muted)]"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            row.status ? STATUS_STYLE[row.status] : "bg-[var(--color-border-strong)]"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate font-mono text-xs ${
                              active ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"
                            }`}
                          >
                            {row.node.label}
                          </span>
                          {row.matchedColumns.length > 0 ? (
                            <span className="mt-0.5 block truncate text-[10px] text-[var(--color-accent)]">
                              {row.matchedColumns.slice(0, 3).join(", ")}
                              {row.matchedColumns.length > 3 ? ` +${row.matchedColumns.length - 3}` : ""}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-right text-[10px] leading-tight text-[var(--color-text-muted)]">
                          <span className="block">{row.node.columns.length} col</span>
                          <span className="block">
                            {row.outgoing > 0 ? `${row.outgoing} FK` : ""}
                            {row.outgoing > 0 && row.incoming > 0 ? " · " : ""}
                            {row.incoming > 0 ? `${row.incoming} ref` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      {diffMap && diffMap.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border-subtle)] p-2 text-[10px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> adicionada
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> alterada
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-400" /> removida
          </span>
        </div>
      ) : null}
    </div>
  );
}

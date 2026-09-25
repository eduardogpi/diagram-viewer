"use client";

import { Copy, Database, Download, KeyRound, Link2, Loader2, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ExplorerCatalog, ExplorerPreview, ExplorerTable } from "@/lib/types/explorer";

type Props = { connectionId: string };

function formatRows(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function TablePreview({ connectionId, table }: { connectionId: string; table: ExplorerTable }) {
  const [preview, setPreview] = useState<ExplorerPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const params = new URLSearchParams({ table: table.name, limit: "50" });
      if (table.schema) params.set("schema", table.schema);
      const res = await fetch(`/api/explorer/${connectionId}/preview?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao carregar preview");
      }
      setPreview((await res.json()) as ExplorerPreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar preview");
    } finally {
      setLoading(false);
    }
  }, [connectionId, table.name, table.schema]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Preview de dados (até 50 linhas)
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          title="Recarregar preview"
          className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando dados...
        </p>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : !preview || preview.rows.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">Nenhuma linha retornada.</p>
      ) : (
        <div className="overflow-auto rounded-xl border border-[var(--color-border-subtle)]">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-[var(--color-panel-muted)] text-[var(--color-text-secondary)]">
              <tr>
                {preview.columns.map((col) => (
                  <th key={col} className="whitespace-nowrap px-3 py-2 font-mono font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, idx) => (
                <tr key={idx} className="border-t border-[var(--color-border-subtle)]">
                  {preview.columns.map((col) => (
                    <td key={col} className="whitespace-nowrap px-3 py-1.5 font-mono text-[var(--color-text-primary)]">
                      {row[col] === null || row[col] === undefined ? (
                        <span className="text-[var(--color-text-muted)]">NULL</span>
                      ) : (
                        String(row[col])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ExplorerWorkbench({ connectionId }: Props) {
  const [catalog, setCatalog] = useState<ExplorerCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [schemaFilter, setSchemaFilter] = useState("ALL");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/explorer/${connectionId}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao carregar schema");
      }
      const data = (await res.json()) as ExplorerCatalog;
      setCatalog(data);
      setSelectedName((current) => current ?? data.tables[0]?.name ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar schema");
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredTables = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLowerCase();
    return catalog.tables.filter((table) => {
      const matchesSchema = schemaFilter === "ALL" || table.schema === schemaFilter;
      if (!matchesSchema) return false;
      if (!needle) return true;
      return (
        table.name.toLowerCase().includes(needle) ||
        table.columns.some((col) => col.name.toLowerCase().includes(needle))
      );
    });
  }, [catalog, query, schemaFilter]);

  const selectedTable = useMemo(
    () => catalog?.tables.find((table) => table.name === selectedName) ?? null,
    [catalog, selectedName]
  );

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1200);
    } catch {
      // clipboard indisponível — ignora silenciosamente
    }
  }

  if (loading && !catalog) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando schema...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3 rounded-2xl border border-dashed border-[var(--color-border-subtle)] p-6 text-sm text-[var(--color-text-secondary)]">
        <p className="text-red-500">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-xs hover:border-[var(--color-accent)]"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <section className="space-y-3">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-4 shadow-[var(--shadow-floating)]">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
              <Database className="h-3.5 w-3.5" /> Explorer
            </p>
            <div className="flex items-center gap-2">
              <a
                href={`/api/explorer/${connectionId}/docs`}
                title="Exportar documentação do schema (Markdown)"
                className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] transition hover:text-[var(--color-accent)]"
              >
                <Download className="h-3.5 w-3.5" /> Doc
              </a>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                title="Recarregar catálogo"
                className="text-[var(--color-text-muted)] transition hover:text-[var(--color-accent)] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            {catalog?.database} · {catalog?.tables.length ?? 0} tabela(s)
          </p>

          <div className="mt-3 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar tabela ou coluna"
                className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] py-2 pl-8 pr-3 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
            {catalog && catalog.schemas.length > 1 ? (
              <select
                value={schemaFilter}
                onChange={(e) => setSchemaFilter(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                <option value="ALL">Todos os schemas</option>
                {catalog.schemas.map((schema) => (
                  <option key={schema} value={schema}>
                    {schema}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>

        <div className="max-h-[520px] overflow-auto rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-2 shadow-[var(--shadow-floating)]">
          {filteredTables.length === 0 ? (
            <p className="p-3 text-xs text-[var(--color-text-muted)]">Nenhuma tabela encontrada.</p>
          ) : (
            <ul className="space-y-0.5">
              {filteredTables.map((table) => (
                <li key={`${table.schema}.${table.name}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedName(table.name)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition ${
                      selectedName === table.name
                        ? "bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-text-primary)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-panel-muted)]"
                    }`}
                  >
                    <span className="truncate font-mono">{table.name}</span>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">{formatRows(table.estimatedRows)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="min-w-0 space-y-4">
        {!selectedTable ? (
          <div className="flex h-[400px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
            Selecione uma tabela para ver os detalhes.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-5 shadow-[var(--shadow-floating)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">{selectedTable.schema}</p>
                  <h2 className="flex items-center gap-2 truncate text-xl font-semibold text-[var(--color-text-primary)]">
                    <span className="font-mono">{selectedTable.name}</span>
                    <button
                      type="button"
                      onClick={() => void copyText(selectedTable.name, `table:${selectedTable.name}`)}
                      title="Copiar nome da tabela"
                      className="text-[var(--color-text-muted)] transition hover:text-[var(--color-accent)]"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    {copied === `table:${selectedTable.name}` ? (
                      <span className="text-[10px] text-[var(--color-accent)]">copiado</span>
                    ) : null}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/workspace/${connectionId}?tab=editor&sql=${encodeURIComponent(`SELECT * FROM ${selectedTable.name} LIMIT 100`)}`}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
                  >
                    Abrir no editor SQL
                  </Link>
                  <Link
                    href={`/workspace/${connectionId}?tab=diagram`}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
                  >
                    Abrir no diagrama
                  </Link>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Linhas (est.)", value: formatRows(selectedTable.estimatedRows) },
                  { label: "Colunas", value: String(selectedTable.columns.length) },
                  { label: "Índices", value: String(selectedTable.indexes.length) },
                  { label: "Relações", value: String(selectedTable.foreignKeys.length + selectedTable.referencedBy.length) },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-muted)] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{stat.label}</p>
                    <p className="mt-1 font-semibold text-[var(--color-text-primary)]">{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-5 shadow-[var(--shadow-floating)]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Colunas</p>
              <div className="mt-3 overflow-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-2 py-1 font-medium">Nome</th>
                      <th className="px-2 py-1 font-medium">Tipo</th>
                      <th className="px-2 py-1 font-medium">Chaves</th>
                      <th className="px-2 py-1 font-medium">Referência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTable.columns.map((col) => (
                      <tr key={col.name} className="border-t border-[var(--color-border-subtle)]">
                        <td className="px-2 py-1.5 font-mono text-[var(--color-text-primary)]">
                          <span className="flex items-center gap-1.5">
                            {col.name}
                            <button
                              type="button"
                              onClick={() => void copyText(col.name, `col:${col.name}`)}
                              title="Copiar nome da coluna"
                              className="text-[var(--color-text-muted)] transition hover:text-[var(--color-accent)]"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[var(--color-text-secondary)]">{col.type}</td>
                        <td className="px-2 py-1.5">
                          <span className="flex gap-1">
                            {col.isPrimary ? (
                              <span className="inline-flex items-center gap-1 rounded border border-[var(--color-warning)]/50 bg-[var(--color-warning-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-warning)]">
                                <KeyRound className="h-2.5 w-2.5" /> PK
                              </span>
                            ) : null}
                            {col.isForeign ? (
                              <span className="inline-flex items-center gap-1 rounded border border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-accent)]">
                                <Link2 className="h-2.5 w-2.5" /> FK
                              </span>
                            ) : null}
                            {col.isNullable ? (
                              <span className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                                NULL
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[var(--color-text-secondary)]">
                          {col.references ? `${col.references.table}.${col.references.column}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedTable.indexes.length > 0 ? (
              <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-5 shadow-[var(--shadow-floating)]">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Índices</p>
                <ul className="mt-3 space-y-1.5 text-xs">
                  {selectedTable.indexes.map((index) => (
                    <li key={index.name} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[var(--color-text-primary)]">{index.name}</span>
                      <span className="text-[var(--color-text-muted)]">({index.columns.join(", ")})</span>
                      {index.isPrimary ? <span className="text-[10px] text-[var(--color-warning)]">PRIMARY</span> : null}
                      {index.isUnique && !index.isPrimary ? <span className="text-[10px] text-[var(--color-accent)]">UNIQUE</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selectedTable.foreignKeys.length > 0 || selectedTable.referencedBy.length > 0 ? (
              <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-5 shadow-[var(--shadow-floating)]">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Relacionamentos</p>
                <div className="mt-3 space-y-2 text-xs">
                  {selectedTable.foreignKeys.map((rel) => (
                    <div key={`out-${rel.constraint}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-[var(--color-text-muted)]">→</span>
                      <span className="font-mono text-[var(--color-text-primary)]">{rel.column}</span>
                      <span className="text-[var(--color-text-muted)]">referencia</span>
                      <button
                        type="button"
                        onClick={() => setSelectedName(rel.referencesTable)}
                        className="font-mono text-[var(--color-accent)] hover:underline"
                      >
                        {rel.referencesTable}.{rel.referencesColumn}
                      </button>
                    </div>
                  ))}
                  {selectedTable.referencedBy.map((rel) => (
                    <div key={`in-${rel.constraint}-${rel.referencesTable}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-[var(--color-text-muted)]">←</span>
                      <button
                        type="button"
                        onClick={() => setSelectedName(rel.referencesTable)}
                        className="font-mono text-[var(--color-accent)] hover:underline"
                      >
                        {rel.referencesTable}.{rel.referencesColumn}
                      </button>
                      <span className="text-[var(--color-text-muted)]">aponta para</span>
                      <span className="font-mono text-[var(--color-text-primary)]">{rel.column}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-5 shadow-[var(--shadow-floating)]">
              <TablePreview connectionId={connectionId} table={selectedTable} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

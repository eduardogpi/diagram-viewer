"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import MigrationPackageSummaryPanel from "@/components/migrations/MigrationPackageSummaryPanel";
import MigrationSummaryPanel from "@/components/migrations/MigrationSummaryPanel";
import MigrationTimeline from "@/components/migrations/MigrationTimeline";
import type { MigrationPackageDTO, MigrationPackageDetailDTO } from "@/lib/types/migrations";

type Props = {
  connectionId: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Falha (${res.status})`);
  }
  return (await res.json()) as T;
}

function TableChips({ label, tables, tone }: { label: string; tables: string[]; tone: string }) {
  if (tables.length === 0) return null;
  return (
    <div>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${tone}`}>
        {label} <span className="text-[var(--color-text-muted)]">({tables.length})</span>
      </p>
      <ul className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {tables.map((table) => (
          <li
            key={table}
            className="rounded-md border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
          >
            {table}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Timeline das migrations em tela cheia, separada do diagrama: navega pela evolução do schema
 * (delta por migration, módulos, filtros) e gera os resumos por IA — de uma migration ou do
 * package inteiro.
 */
export default function MigrationTimelineView({ connectionId }: Props) {
  const [packages, setPackages] = useState<MigrationPackageDTO[] | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MigrationPackageDetailDTO | null>(null);
  const [currentOrder, setCurrentOrder] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (id: string, keepOrder: number | null = null) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJson<MigrationPackageDetailDTO>(`/api/migrations/${connectionId}/${id}`);
        setDetail(data);
        const orders = data.snapshots.map((snapshot) => snapshot.migrationOrder);
        setCurrentOrder(
          keepOrder !== null && orders.includes(keepOrder) ? keepOrder : (orders[orders.length - 1] ?? null)
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar o package");
      } finally {
        setLoading(false);
      }
    },
    [connectionId]
  );

  useEffect(() => {
    let cancelled = false;
    fetchJson<MigrationPackageDTO[]>(`/api/migrations/${connectionId}`)
      .then((list) => {
        if (cancelled) return;
        setPackages(list);
        setPackageId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao listar packages");
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    if (!packageId) return;
    setDetail(null);
    void loadDetail(packageId);
  }, [packageId, loadDetail]);

  async function reprocess() {
    if (!packageId) return;
    setReprocessing(true);
    setError(null);
    try {
      await fetchJson(`/api/migrations/${connectionId}/${packageId}/reprocess`, { method: "POST" });
      await loadDetail(packageId, currentOrder);
      setPackages(await fetchJson<MigrationPackageDTO[]>(`/api/migrations/${connectionId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao reprocessar");
    } finally {
      setReprocessing(false);
    }
  }

  const current = useMemo(
    () => detail?.snapshots.find((snapshot) => snapshot.migrationOrder === currentOrder) ?? null,
    [detail, currentOrder]
  );
  const totalWarnings = useMemo(
    () => detail?.snapshots.reduce((sum, snapshot) => sum + snapshot.warnings.length, 0) ?? 0,
    [detail]
  );

  if (packages !== null && packages.length === 0) {
    return (
      <div className="space-y-2 rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-6 text-sm text-[var(--color-text-secondary)]">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Nenhum package de migrations</h2>
        <p>
          Importe migrations na aba{" "}
          <Link className="text-[var(--color-accent)] underline" href={`/workspace/${connectionId}?tab=migrations`}>
            Migrations
          </Link>{" "}
          para ver a timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-6 shadow-[var(--shadow-floating)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-accent)]">Workspace / Timeline</p>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Evolução do schema</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {packages && packages.length > 1 ? (
              <select
                value={packageId ?? ""}
                onChange={(event) => setPackageId(event.target.value)}
                aria-label="Package de migrations"
                className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} ({pkg.fileCount})
                  </option>
                ))}
              </select>
            ) : null}
            <Link
              href={`/workspace/${connectionId}?tab=migrations`}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
            >
              Ver diagrama
            </Link>
          </div>
        </div>

        {error ? <p className="text-xs text-red-500">{error}</p> : null}

        {detail?.parserStale ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] p-3">
            <p className="text-xs text-[var(--color-warning)]">
              Processado por uma versão anterior do parser (v{detail.parserVersion}) — a timeline pode estar
              incompleta ou com avisos que já foram corrigidos. Reprocesse para atualizar.
            </p>
            <button
              type="button"
              onClick={() => void reprocess()}
              disabled={reprocessing}
              className="rounded-lg bg-[var(--color-warning)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reprocessing ? "Reprocessando..." : "Reprocessar agora"}
            </button>
          </div>
        ) : null}

        {loading && !detail ? (
          <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">Carregando timeline...</p>
        ) : null}

        {detail && detail.snapshots.length > 0 ? (
          <>
            <p className="text-xs text-[var(--color-text-muted)]">
              {detail.name} · {detail.fileCount} migrations · {detail.sourceProvider}
              {totalWarnings > 0 ? ` · ${totalWarnings} statement(s) não reconhecidos` : " · sem avisos do parser"}
            </p>
            <MigrationTimeline snapshots={detail.snapshots} currentOrder={currentOrder} onSelect={setCurrentOrder} />
          </>
        ) : null}
      </section>

      {detail && current && packageId ? (
        <section className="space-y-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-mono text-sm text-[var(--color-text-primary)]">
              #{current.migrationOrder} {current.migrationName}
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              {current.stats.tables} tabelas · {current.stats.columns} colunas · {current.stats.edges} FKs (acumulado)
              {current.stats.ignoredStatements > 0 ? ` · ${current.stats.ignoredStatements} statement(s) sem efeito no schema` : ""}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <TableChips label="Adicionadas" tables={current.stats.addedTables} tone="text-emerald-400" />
            <TableChips label="Alteradas" tables={current.stats.alteredTables} tone="text-amber-400" />
            <TableChips label="Removidas" tables={current.stats.removedTables} tone="text-rose-400" />
          </div>
          {current.stats.addedTables.length + current.stats.alteredTables.length + current.stats.removedTables.length ===
          0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">Nenhuma alteração de tabela nesta migration.</p>
          ) : null}

          {current.warnings.length > 0 ? (
            <details className="rounded-lg border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] p-3">
              <summary className="cursor-pointer text-xs text-[var(--color-warning)]">
                {current.warnings.length} aviso(s) de statements não reconhecidos
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">
                {current.warnings.map((warning, index) => (
                  <li key={index}>
                    <span className="text-[var(--color-warning)]">{warning.reason}:</span>{" "}
                    <code className="text-[var(--color-text-muted)]">{warning.statement.slice(0, 160)}</code>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <MigrationSummaryPanel
            connectionId={connectionId}
            packageId={packageId}
            order={current.migrationOrder}
            migrationName={current.migrationName}
          />
        </section>
      ) : null}

      {detail && packageId ? (
        <MigrationPackageSummaryPanel connectionId={connectionId} packageId={packageId} packageName={detail.name} />
      ) : null}
    </div>
  );
}

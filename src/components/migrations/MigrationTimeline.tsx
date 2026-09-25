"use client";

import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

type SnapshotSummary = {
  migrationOrder: number;
  migrationName: string;
  warnings: Array<{ statement: string; reason: string }>;
};

type Props = {
  snapshots: SnapshotSummary[];
  currentOrder: number | null;
  onSelect: (order: number) => void;
};

const STOP_WIDTH = 128;

/** Extrai o segmento de módulo/pasta do nome exibido ("modulo/V1__x.sql" -> "modulo"). */
function moduleOf(migrationName: string): string | null {
  const lastSlash = migrationName.lastIndexOf("/");
  return lastSlash > 0 ? migrationName.slice(0, lastSlash) : null;
}

function fileNameOf(migrationName: string): string {
  const lastSlash = migrationName.lastIndexOf("/");
  return lastSlash >= 0 ? migrationName.slice(lastSlash + 1) : migrationName;
}

export default function MigrationTimeline({ snapshots, currentOrder, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stopRefs = useRef(new Map<number, HTMLButtonElement>());

  const activeIndex = useMemo(
    () => snapshots.findIndex((s) => s.migrationOrder === currentOrder),
    [snapshots, currentOrder]
  );

  const groups = useMemo(
    () =>
      snapshots.map((snap, idx) => {
        const mod = moduleOf(snap.migrationName);
        const prevMod = idx > 0 ? moduleOf(snapshots[idx - 1].migrationName) : undefined;
        return { snap, module: mod, startsGroup: mod !== prevMod };
      }),
    [snapshots]
  );

  useEffect(() => {
    if (currentOrder === null) return;
    const el = stopRefs.current.get(currentOrder);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [currentOrder]);

  if (snapshots.length === 0) return null;

  function step(delta: number) {
    const nextIndex = Math.min(Math.max(activeIndex + delta, 0), snapshots.length - 1);
    const next = snapshots[nextIndex];
    if (next) onSelect(next.migrationOrder);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = snapshots[0];
      if (first) onSelect(first.migrationOrder);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = snapshots[snapshots.length - 1];
      if (last) onSelect(last.migrationOrder);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            Timeline
          </span>
          {activeIndex >= 0 ? (
            <span className="text-xs text-[var(--color-text-secondary)]">
              Migration {activeIndex + 1} de {snapshots.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={activeIndex <= 0}
            aria-label="Migration anterior"
            className="rounded-md border border-[var(--color-border-subtle)] p-1 text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[var(--color-border-subtle)] disabled:hover:text-[var(--color-text-secondary)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={activeIndex < 0 || activeIndex >= snapshots.length - 1}
            aria-label="Próxima migration"
            className="rounded-md border border-[var(--color-border-subtle)] p-1 text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[var(--color-border-subtle)] disabled:hover:text-[var(--color-text-secondary)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        role="listbox"
        aria-label="Linha do tempo de migrations"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="mt-3 overflow-x-auto pb-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-layer-1)]"
      >
        <div className="relative min-w-max" style={{ paddingTop: 18 }}>
          {/* trilha: percorrida (accent) + restante (sutil) */}
          <div
            className="pointer-events-none absolute top-[26px] h-px bg-[var(--color-border-subtle)]"
            style={{ left: STOP_WIDTH / 2, right: STOP_WIDTH / 2 }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute top-[26px] h-px bg-[var(--color-accent)] transition-[width] duration-300"
            style={{
              left: STOP_WIDTH / 2,
              width: activeIndex > 0 ? activeIndex * STOP_WIDTH : 0,
            }}
            aria-hidden
          />

          <div className="relative flex items-start">
            {groups.map(({ snap, module, startsGroup }) => {
              const active = currentOrder === snap.migrationOrder;
              const hasWarnings = snap.warnings.length > 0;
              return (
                <div
                  key={snap.migrationOrder}
                  className="relative flex shrink-0 flex-col items-center"
                  style={{ width: STOP_WIDTH }}
                >
                  <div className="mb-1 h-3 w-full px-1 text-center">
                    {startsGroup && module ? (
                      <span
                        className="truncate text-[9px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]"
                        title={module}
                      >
                        {module}
                      </span>
                    ) : null}
                  </div>

                  <button
                    ref={(el) => {
                      if (el) stopRefs.current.set(snap.migrationOrder, el);
                      else stopRefs.current.delete(snap.migrationOrder);
                    }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => onSelect(snap.migrationOrder)}
                    title={snap.migrationName}
                    className="group flex w-full flex-col items-center gap-1.5 px-1 text-center"
                  >
                    <span
                      className={`relative flex h-4 w-4 items-center justify-center rounded-full border-2 bg-[var(--color-bg-layer-1)] transition ${
                        active
                          ? "border-[var(--color-accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
                          : "border-[var(--color-border-strong)] group-hover:border-[var(--color-accent)]"
                      }`}
                    >
                      {active ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                      ) : null}
                      {hasWarnings ? (
                        <span
                          className="absolute -top-1.5 -right-1.5 flex h-3 w-3 items-center justify-center rounded-full border border-[var(--color-bg-layer-1)] bg-[var(--color-warning)]"
                          title={`${snap.warnings.length} aviso(s)`}
                        >
                          <TriangleAlert className="h-2 w-2 text-[var(--color-text-inverse)]" strokeWidth={3} />
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`font-mono text-[10px] transition ${
                        active ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]"
                      }`}
                    >
                      #{snap.migrationOrder}
                    </span>
                    <span
                      className={`line-clamp-2 w-full text-[11px] leading-tight transition ${
                        active ? "font-medium text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]"
                      }`}
                    >
                      {fileNameOf(snap.migrationName)}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export type { SnapshotSummary as MigrationTimelineSnapshot };

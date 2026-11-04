"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Filter,
  GitBranch,
  Pause,
  Play,
  Rows3,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { MigrationSnapshotStats } from "@/lib/types/migrations";

type TimelineSnapshot = {
  migrationOrder: number;
  migrationName: string;
  warnings: Array<{ statement: string; reason: string }>;
  /** Delta em relação ao snapshot anterior. Ausente em pacotes antigos (gravados antes da coluna). */
  stats?: MigrationSnapshotStats;
};

type Props = {
  snapshots: TimelineSnapshot[];
  currentOrder: number | null;
  onSelect: (order: number) => void;
  /** Tabela selecionada no canvas (id do nó). Destaca na timeline onde ela nasceu e onde mudou. */
  highlightTableId?: string | null;
};

type Layout = "horizontal" | "vertical";
type Density = "compact" | "comfortable" | "detailed";

const ADDED = "#34d399";
const ALTERED = "#fbbf24";
const REMOVED = "#fb7185";

const EMPTY_STATS: MigrationSnapshotStats = {
  tables: 0,
  columns: 0,
  edges: 0,
  addedTables: [],
  removedTables: [],
  alteredTables: [],
  addedEdges: 0,
  removedEdges: 0,
  schemaWarnings: 0,
  ignoredStatements: 0,
};

/** Largura de cada parada na faixa horizontal, por densidade. */
const STOP_WIDTH: Record<Density, number> = { compact: 64, comfortable: 132, detailed: 188 };

const PAD_TOP = 18; // respiro acima das barras (onde fica o rótulo da faixa de módulo)
const BAR_AREA = 48; // altura reservada para a barra de delta
const BAR_MAX = 44;
const DOT_MARGIN_TOP = 10; // mt-2.5 do dot
const DOT_SIZE = 16;
/** Centro vertical do dot, para a trilha passar exatamente por ele. */
const TRACK_TOP = PAD_TOP + BAR_AREA + DOT_MARGIN_TOP + DOT_SIZE / 2;

const PLAY_INTERVAL_MS = 900;

/** Extrai o segmento de módulo/pasta do nome exibido ("modulo/V1__x.sql" -> "modulo"). */
function moduleOf(migrationName: string): string {
  const lastSlash = migrationName.lastIndexOf("/");
  return lastSlash > 0 ? migrationName.slice(0, lastSlash) : "";
}

function fileNameOf(migrationName: string): string {
  const lastSlash = migrationName.lastIndexOf("/");
  return lastSlash >= 0 ? migrationName.slice(lastSlash + 1) : migrationName;
}

function statsOf(snapshot: TimelineSnapshot): MigrationSnapshotStats {
  return snapshot.stats ?? EMPTY_STATS;
}

/** Quantas tabelas a migration tocou (criou/alterou/removeu). */
function magnitude(stats: MigrationSnapshotStats): number {
  return stats.addedTables.length + stats.alteredTables.length + stats.removedTables.length;
}

/** true quando a migration muda a forma do schema (tabelas ou FKs). */
function changesSchema(snapshot: TimelineSnapshot): boolean {
  const stats = statsOf(snapshot);
  return (
    magnitude(stats) > 0 ||
    stats.addedEdges > 0 ||
    stats.removedEdges > 0 ||
    stats.schemaWarnings > 0
  );
}

/** Segmentos empilhados (adicionadas/alteradas/removidas) escalados pelo maior delta do pacote. */
function DeltaBar({ stats, maxMagnitude, height }: { stats: MigrationSnapshotStats; maxMagnitude: number; height: number }) {
  const segments = [
    { count: stats.addedTables.length, color: ADDED, label: "adicionadas" },
    { count: stats.alteredTables.length, color: ALTERED, label: "alteradas" },
    { count: stats.removedTables.length, color: REMOVED, label: "removidas" },
  ];
  const segHeight = (count: number) =>
    count === 0 ? 0 : Math.max(3, Math.round((count / Math.max(1, maxMagnitude)) * height));

  return (
    <div className="flex flex-col justify-end overflow-hidden rounded-sm" style={{ width: 10, height }}>
      {segments.map((segment) =>
        segment.count > 0 ? (
          <span
            key={segment.label}
            title={`${segment.count} ${segment.label}`}
            style={{ height: segHeight(segment.count), background: segment.color }}
          />
        ) : null
      )}
    </div>
  );
}

function DeltaChips({ stats, className = "" }: { stats: MigrationSnapshotStats; className?: string }) {
  const chip = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums";
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {stats.addedTables.length > 0 ? (
        <span className={chip} style={{ color: ADDED, background: `${ADDED}22` }}>
          +{stats.addedTables.length}
        </span>
      ) : null}
      {stats.alteredTables.length > 0 ? (
        <span className={chip} style={{ color: ALTERED, background: `${ALTERED}22` }}>
          ~{stats.alteredTables.length}
        </span>
      ) : null}
      {stats.removedTables.length > 0 ? (
        <span className={chip} style={{ color: REMOVED, background: `${REMOVED}22` }}>
          -{stats.removedTables.length}
        </span>
      ) : null}
      {stats.addedEdges + stats.removedEdges > 0 ? (
        <span className={`${chip} text-[var(--color-text-muted)]`} title="Relações (FK) adicionadas/removidas">
          FK {stats.addedEdges > 0 ? `+${stats.addedEdges}` : ""}
          {stats.removedEdges > 0 ? ` -${stats.removedEdges}` : ""}
        </span>
      ) : null}
    </span>
  );
}

export default function MigrationTimeline({ snapshots, currentOrder, onSelect, highlightTableId }: Props) {
  const [layout, setLayout] = useState<Layout>("horizontal");
  const [density, setDensity] = useState<Density>("comfortable");
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [playing, setPlaying] = useState(false);

  const stopWidth = STOP_WIDTH[density];

  const maxMagnitude = useMemo(
    () => Math.max(1, ...snapshots.map((snapshot) => magnitude(statsOf(snapshot)))),
    [snapshots]
  );

  const visible = useMemo(
    () => (onlyChanges ? snapshots.filter(changesSchema) : snapshots),
    [snapshots, onlyChanges]
  );

  const visibleIndex = useMemo(
    () => visible.findIndex((snapshot) => snapshot.migrationOrder === currentOrder),
    [visible, currentOrder]
  );

  /** Onde cada tabela nasceu e em quais migrations ela foi alterada. */
  const lineage = useMemo(() => {
    const map = new Map<string, { created: number; altered: number[] }>();
    for (const snapshot of snapshots) {
      const stats = statsOf(snapshot);
      for (const id of stats.addedTables) map.set(id, { created: snapshot.migrationOrder, altered: [] });
      for (const id of stats.alteredTables) map.get(id)?.altered.push(snapshot.migrationOrder);
    }
    return map;
  }, [snapshots]);

  const highlightLineage = highlightTableId ? lineage.get(highlightTableId) : undefined;

  // Faixas por módulo (grupos de paradas consecutivas da mesma pasta).
  const groups = useMemo(() => {
    const result: Array<{ moduleName: string; start: number; count: number }> = [];
    snapshots.forEach((snapshot, index) => {
      const moduleName = moduleOf(snapshot.migrationName);
      const current = result[result.length - 1];
      if (current && current.moduleName === moduleName && current.start + current.count === index) {
        current.count += 1;
      } else {
        result.push({ moduleName, start: index, count: 1 });
      }
    });
    return result;
  }, [snapshots]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stopRefs = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    if (layout !== "horizontal" || currentOrder === null) return;
    stopRefs.current.get(currentOrder)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [currentOrder, layout, density, onlyChanges]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const index = visible.findIndex((snapshot) => snapshot.migrationOrder === currentOrder);
      const next = visible[index + 1];
      if (!next) {
        setPlaying(false);
        return;
      }
      onSelect(next.migrationOrder);
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, visible, currentOrder, onSelect]);

  if (snapshots.length === 0) return null;

  function step(delta: number) {
    const list = visible.length > 0 ? visible : snapshots;
    const base = list.findIndex((snapshot) => snapshot.migrationOrder === currentOrder);
    const target = list[Math.min(Math.max(base + delta, 0), list.length - 1)];
    if (target) onSelect(target.migrationOrder);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = (visible[0] ?? snapshots[0]);
      if (first) onSelect(first.migrationOrder);
    } else if (event.key === "End") {
      event.preventDefault();
      const last = visible[visible.length - 1] ?? snapshots[snapshots.length - 1];
      if (last) onSelect(last.migrationOrder);
    }
  }

  const positionLabel =
    visibleIndex >= 0
      ? `Migration ${visibleIndex + 1} de ${visible.length}${onlyChanges ? ` (${snapshots.length} no total)` : ""}`
      : `${snapshots.length} migrations`;

  return (
    <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Timeline</span>
          <span className="text-xs text-[var(--color-text-secondary)]">{positionLabel}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOnlyChanges((value) => !value)}
            aria-pressed={onlyChanges}
            title="Mostrar só migrations que alteram o schema"
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
              onlyChanges
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            }`}
          >
            <Filter className="h-3 w-3" />
            só alterações
          </button>

          {layout === "horizontal" ? (
            <label className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
              <span className="sr-only">Densidade</span>
              <select
                value={density}
                onChange={(event) => setDensity(event.target.value as Density)}
                className="bg-transparent text-[11px] text-[var(--color-text-secondary)] focus:outline-none"
              >
                <option value="compact">compacto</option>
                <option value="comfortable">confortável</option>
                <option value="detailed">detalhado</option>
              </select>
            </label>
          ) : null}

          <button
            type="button"
            onClick={() => setLayout((value) => (value === "horizontal" ? "vertical" : "horizontal"))}
            title={layout === "horizontal" ? "Ver em lista (vertical)" : "Ver em trilha (horizontal)"}
            aria-label={layout === "horizontal" ? "Alternar para lista vertical" : "Alternar para trilha horizontal"}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] p-1.5 text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            {layout === "horizontal" ? <Rows3 className="h-4 w-4" /> : <Columns3 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            title={playing ? "Pausar avanço automático" : "Avançar automaticamente"}
            aria-label={playing ? "Pausar" : "Reproduzir"}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] p-1.5 text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => step(-1)}
            disabled={visibleIndex <= 0}
            aria-label="Migration anterior"
            className="rounded-md border border-[var(--color-border-subtle)] p-1 text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[var(--color-border-subtle)] disabled:hover:text-[var(--color-text-secondary)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={visibleIndex < 0 || visibleIndex >= visible.length - 1}
            aria-label="Próxima migration"
            className="rounded-md border border-[var(--color-border-subtle)] p-1 text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[var(--color-border-subtle)] disabled:hover:text-[var(--color-text-secondary)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {highlightTableId ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
          <GitBranch className="h-3 w-3 text-[var(--color-accent)]" />
          <span className="font-mono text-[var(--color-text-secondary)]">{highlightTableId}</span>
          {highlightLineage ? (
            <>
              criada em #{highlightLineage.created}
              {highlightLineage.altered.length > 0 ? ` · alterada em ${highlightLineage.altered.map((o) => `#${o}`).join(", ")}` : ""}
            </>
          ) : (
            "não aparece nas migrations deste pacote"
          )}
        </p>
      ) : null}

      {onlyChanges && visible.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          Nenhuma migration altera o schema neste pacote.
        </p>
      ) : layout === "horizontal" ? (
        <HorizontalTimeline
          snapshots={snapshots}
          visible={visible}
          groups={groups}
          stopWidth={stopWidth}
          density={density}
          currentOrder={currentOrder}
          maxMagnitude={maxMagnitude}
          highlightTableId={highlightTableId ?? null}
          lineage={lineage}
          scrollRef={scrollRef}
          stopRefs={stopRefs}
          onSelect={onSelect}
          onKeyDown={onKeyDown}
        />
      ) : (
        <VerticalTimeline
          visible={visible}
          currentOrder={currentOrder}
          maxMagnitude={maxMagnitude}
          highlightTableId={highlightTableId ?? null}
          lineage={lineage}
          onSelect={onSelect}
          onKeyDown={onKeyDown}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: ADDED }} /> tabela adicionada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: ALTERED }} /> tabela alterada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: REMOVED }} /> tabela removida
        </span>
        <span className="flex items-center gap-1.5">
          <TriangleAlert className="h-3 w-3 text-[var(--color-warning)]" /> avisos de parse
        </span>
      </div>
    </div>
  );
}

type LineageMap = Map<string, { created: number; altered: number[] }>;

function HorizontalTimeline({
  snapshots,
  visible,
  groups,
  stopWidth,
  density,
  currentOrder,
  maxMagnitude,
  highlightTableId,
  lineage,
  scrollRef,
  stopRefs,
  onSelect,
  onKeyDown,
}: {
  snapshots: TimelineSnapshot[];
  visible: TimelineSnapshot[];
  groups: Array<{ moduleName: string; start: number; count: number }>;
  stopWidth: number;
  density: Density;
  currentOrder: number | null;
  maxMagnitude: number;
  highlightTableId: string | null;
  lineage: LineageMap;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  stopRefs: React.MutableRefObject<Map<number, HTMLButtonElement>>;
  onSelect: (order: number) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const visibleOrders = useMemo(() => new Set(visible.map((snapshot) => snapshot.migrationOrder)), [visible]);

  return (
    <div className="mt-3">
      {/* Scrubber: visão geral comprimida de todas as paradas, clicável. */}
      <div className="flex items-end gap-px overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/50 p-1">
        {snapshots.map((snapshot) => {
          const stats = statsOf(snapshot);
          const mag = magnitude(stats);
          const active = snapshot.migrationOrder === currentOrder;
          const dimmed = !visibleOrders.has(snapshot.migrationOrder);
          const touched = highlightTableId
            ? lineage.get(highlightTableId)?.created === snapshot.migrationOrder ||
              lineage.get(highlightTableId)?.altered.includes(snapshot.migrationOrder)
            : false;
          return (
            <button
              key={snapshot.migrationOrder}
              type="button"
              onClick={() => onSelect(snapshot.migrationOrder)}
              title={`#${snapshot.migrationOrder} · ${fileNameOf(snapshot.migrationName)} · ${mag} tabela(s) tocada(s)`}
              aria-label={`Ir para migration ${snapshot.migrationOrder}`}
              className={`relative flex-1 rounded-sm transition ${dimmed ? "opacity-25" : ""}`}
              style={{ minWidth: 3, height: 30 }}
            >
              <span
                className="absolute inset-x-0 bottom-0 rounded-sm"
                style={{
                  height: mag === 0 ? 3 : Math.max(4, Math.round((mag / maxMagnitude) * 26)),
                  background:
                    stats.addedTables.length >= stats.alteredTables.length && stats.addedTables.length > 0
                      ? ADDED
                      : stats.alteredTables.length > 0
                        ? ALTERED
                        : stats.removedTables.length > 0
                          ? REMOVED
                          : "var(--color-border-strong)",
                }}
              />
              {active ? (
                <span className="absolute inset-y-0 -inset-x-px rounded-sm ring-2 ring-[var(--color-accent)]" />
              ) : null}
              {touched ? (
                <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--color-accent)]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        role="listbox"
        aria-label="Linha do tempo de migrations"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="mt-2 overflow-x-auto pb-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-layer-1)]"
      >
        <div className="relative min-w-max" style={{ paddingTop: PAD_TOP }}>
          {groups.map((group) => (
            <div
              key={`${group.moduleName}-${group.start}`}
              className="pointer-events-none absolute bottom-0 top-0 rounded-lg border border-dashed border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-accent)_4%,transparent)]"
              style={{ left: group.start * stopWidth, width: group.count * stopWidth }}
              aria-hidden
            >
              <span className="absolute left-2 top-0.5 truncate text-[9px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                {group.moduleName || "raiz"}
              </span>
            </div>
          ))}

          {/* trilha: percorrida (accent) + restante (sutil) */}
          <div
            className="pointer-events-none absolute h-px bg-[var(--color-border-subtle)]"
            style={{ top: TRACK_TOP, left: stopWidth / 2, right: stopWidth / 2 }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute h-px bg-[var(--color-accent)] transition-[width] duration-300"
            style={{
              top: TRACK_TOP,
              left: stopWidth / 2,
              width: currentOrder !== null ? snapshots.findIndex((s) => s.migrationOrder === currentOrder) * stopWidth : 0,
            }}
            aria-hidden
          />

          <div className="relative flex items-start">
            {snapshots.map((snapshot) => {
              const stats = statsOf(snapshot);
              const active = snapshot.migrationOrder === currentOrder;
              const hasWarnings = snapshot.warnings.length > 0;
              const dimmed = !visibleOrders.has(snapshot.migrationOrder);
              const lineageEntry = highlightTableId ? lineage.get(highlightTableId) : undefined;
              const isBirth = lineageEntry?.created === snapshot.migrationOrder;
              const isAlteredHere = lineageEntry?.altered.includes(snapshot.migrationOrder) ?? false;
              return (
                <div
                  key={snapshot.migrationOrder}
                  className={`relative flex shrink-0 flex-col items-center transition ${dimmed ? "opacity-30" : ""}`}
                  style={{ width: stopWidth }}
                >
                  <div className="flex items-end justify-center" style={{ height: BAR_AREA }}>
                    <DeltaBar stats={stats} maxMagnitude={maxMagnitude} height={BAR_MAX} />
                  </div>

                  <button
                    ref={(el) => {
                      if (el) stopRefs.current.set(snapshot.migrationOrder, el);
                      else stopRefs.current.delete(snapshot.migrationOrder);
                    }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => onSelect(snapshot.migrationOrder)}
                    title={snapshot.migrationName}
                    className="group flex w-full flex-col items-center gap-1.5 px-1 text-center"
                  >
                    <span
                      className={`relative mt-2.5 flex h-4 w-4 items-center justify-center rounded-full border-2 bg-[var(--color-bg-layer-1)] transition ${
                        active
                          ? "border-[var(--color-accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
                          : "border-[var(--color-border-strong)] group-hover:border-[var(--color-accent)]"
                      }`}
                    >
                      {active ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" /> : null}
                      {hasWarnings ? (
                        <span
                          className="absolute -right-1.5 -top-1.5 flex h-3 w-3 items-center justify-center rounded-full border border-[var(--color-bg-layer-1)] bg-[var(--color-warning)]"
                          title={`${snapshot.warnings.length} aviso(s)`}
                        >
                          <TriangleAlert className="h-2 w-2 text-[var(--color-text-inverse)]" strokeWidth={3} />
                        </span>
                      ) : null}
                      {isBirth || isAlteredHere ? (
                        <span
                          className="absolute -bottom-1.5 -left-1.5 h-2.5 w-2.5 rounded-full border border-[var(--color-bg-layer-1)] bg-[var(--color-accent)]"
                          title={isBirth ? "Tabela criada aqui" : "Tabela alterada aqui"}
                        />
                      ) : null}
                    </span>
                    <span
                      className={`font-mono text-[10px] transition ${
                        active
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]"
                      }`}
                    >
                      #{snapshot.migrationOrder}
                    </span>
                    {density !== "compact" ? (
                      <span
                        className={`line-clamp-2 w-full text-[11px] leading-tight transition ${
                          active
                            ? "font-medium text-[var(--color-text-primary)]"
                            : "text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]"
                        }`}
                      >
                        {fileNameOf(snapshot.migrationName)}
                      </span>
                    ) : null}
                    {density === "detailed" ? <DeltaChips stats={stats} className="justify-center" /> : null}
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

function VerticalTimeline({
  visible,
  currentOrder,
  maxMagnitude,
  highlightTableId,
  lineage,
  onSelect,
  onKeyDown,
}: {
  visible: TimelineSnapshot[];
  currentOrder: number | null;
  maxMagnitude: number;
  highlightTableId: string | null;
  lineage: LineageMap;
  onSelect: (order: number) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 58,
    overscan: 8,
  });

  const activeIndex = visible.findIndex((snapshot) => snapshot.migrationOrder === currentOrder);

  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Lista de migrations"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="mt-3 h-[420px] overflow-y-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const snapshot = visible[row.index];
          if (!snapshot) return null;
          const stats = statsOf(snapshot);
          const active = snapshot.migrationOrder === currentOrder;
          const lineageEntry = highlightTableId ? lineage.get(highlightTableId) : undefined;
          const isBirth = lineageEntry?.created === snapshot.migrationOrder;
          const isAlteredHere = lineageEntry?.altered.includes(snapshot.migrationOrder) ?? false;
          return (
            <div
              key={snapshot.migrationOrder}
              className="absolute left-0 top-0 w-full px-1"
              style={{ height: row.size, transform: `translateY(${row.start}px)` }}
            >
              <button
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onSelect(snapshot.migrationOrder)}
                title={snapshot.migrationName}
                className={`flex h-[52px] w-full items-center gap-3 rounded-lg border px-3 text-left transition ${
                  active
                    ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
                    : "border-transparent hover:border-[var(--color-border-strong)] hover:bg-[var(--color-panel-muted)]"
                }`}
              >
                <span className="w-10 shrink-0 font-mono text-[11px] text-[var(--color-text-muted)]">
                  #{snapshot.migrationOrder}
                </span>

                <DeltaBar stats={stats} maxMagnitude={maxMagnitude} height={40} />

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`truncate text-xs ${active ? "font-medium text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
                    >
                      {fileNameOf(snapshot.migrationName)}
                    </span>
                    {snapshot.warnings.length > 0 ? (
                      <TriangleAlert className="h-3 w-3 shrink-0 text-[var(--color-warning)]" />
                    ) : null}
                    {isBirth ? (
                      <span className="shrink-0 rounded bg-[var(--color-accent-soft)] px-1 text-[9px] uppercase tracking-wider text-[var(--color-accent)]">
                        nasce
                      </span>
                    ) : isAlteredHere ? (
                      <span className="shrink-0 rounded bg-[var(--color-panel-raised)] px-1 text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
                        altera
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--color-text-muted)]">
                    {moduleOf(snapshot.migrationName) || "raiz"} · {stats.tables} tabelas · {stats.edges} FKs
                  </span>
                </span>

                <DeltaChips stats={stats} className="shrink-0 justify-end" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { TimelineSnapshot as MigrationTimelineSnapshot };

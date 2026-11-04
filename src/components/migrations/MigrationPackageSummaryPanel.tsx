"use client";

import {
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import SummaryMarkdown from "@/components/migrations/SummaryMarkdown";
import {
  LLM_PROVIDER_LABELS,
  useLlmModels,
  type LlmModelInfo,
} from "@/lib/hooks/useLlmModels";
import type {
  MigrationChunkSummaryResult,
  MigrationPackageOverviewResult,
  MigrationPackageSummaryPlan,
} from "@/lib/types/migrations";

type Props = {
  connectionId: string;
  packageId: string;
  packageName: string;
};

type ChunkState =
  | { status: "pending" }
  | { status: "running" }
  | { status: "done"; result: MigrationChunkSummaryResult }
  | { status: "error"; error: string };

type CachedRun = {
  chunks: Record<number, MigrationChunkSummaryResult>;
  overview: MigrationPackageOverviewResult | null;
};

/** Chamadas simultâneas ao modelo — baixo o bastante para não estourar rate limit de planos gratuitos. */
const CONCURRENCY = 2;

function modelKey(model: Pick<LlmModelInfo, "provider" | "id">): string {
  return `${model.provider}::${model.id}`;
}

function cacheKey(packageId: string, checksum: string, model: string): string {
  return `migration-package-summary:${packageId}:${checksum}:${model}`;
}

// Cache só por conveniência (retomar após recarregar a página): falhar aqui nunca pode quebrar a tela.
function readCache(key: string): CachedRun | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CachedRun) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: CachedRun) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // cota cheia ou storage bloqueado — segue sem cache
  }
}

async function postStep<T>(
  url: string,
  body: unknown,
  signal: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error ?? `Falha (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Documento final: visão geral + detalhamento de cada lote, em ordem cronológica. */
export function buildPackageSummaryDocument(
  packageName: string,
  overview: MigrationPackageOverviewResult | null,
  chunks: MigrationChunkSummaryResult[],
): string {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const detail = ordered
    .map(
      (chunk) =>
        `### Migrations #${chunk.fromOrder} a #${chunk.toOrder}\n\n${chunk.summary.trim()}`,
    )
    .join("\n\n");
  return [
    `# Resumo das migrations — ${packageName}`,
    overview ? overview.overview.trim() : null,
    `## Detalhamento por migration\n\n${detail}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export default function MigrationPackageSummaryPanel({
  connectionId,
  packageId,
  packageName,
}: Props) {
  const {
    models,
    loading: loadingModels,
    refreshing,
    error: modelsError,
    refresh,
  } = useLlmModels();
  const [modelKeySelected, setModelKeySelected] = useState("");
  const [plan, setPlan] = useState<MigrationPackageSummaryPlan | null>(null);
  const [chunks, setChunks] = useState<Record<number, ChunkState>>({});
  const [overview, setOverview] =
    useState<MigrationPackageOverviewResult | null>(null);
  const [overviewState, setOverviewState] = useState<
    "idle" | "running" | "error"
  >("idle");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const effectiveModelKey =
    modelKeySelected || (models[0] ? modelKey(models[0]) : "");
  const groupedModels = useMemo(() => {
    const groups = new Map<string, LlmModelInfo[]>();
    for (const model of models) {
      if (!groups.has(model.provider)) groups.set(model.provider, []);
      groups.get(model.provider)!.push(model);
    }
    return Array.from(groups.entries());
  }, [models]);

  const doneResults = useMemo(
    () =>
      Object.values(chunks).flatMap((state) =>
        state.status === "done" ? [state.result] : [],
      ),
    [chunks],
  );
  const total = plan?.chunks.length ?? 0;
  const failed = Object.values(chunks).filter(
    (state) => state.status === "error",
  ).length;
  const progress =
    total > 0 ? Math.round((doneResults.length / total) * 100) : 0;
  const document_ = useMemo(
    () =>
      doneResults.length > 0
        ? buildPackageSummaryDocument(packageName, overview, doneResults)
        : "",
    [doneResults, overview, packageName],
  );

  const run = useCallback(async () => {
    if (running || !effectiveModelKey) return;
    const [provider, model] = effectiveModelKey.split("::");
    const base = `/api/migrations/${connectionId}/${packageId}/summary/package`;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);

    try {
      let currentPlan = plan;
      if (!currentPlan) {
        const res = await fetch(base, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? "Falha ao planejar o resumo");
        }
        currentPlan = (await res.json()) as MigrationPackageSummaryPlan;
        setPlan(currentPlan);
      }

      const key = cacheKey(packageId, currentPlan.checksum, effectiveModelKey);
      const cached = readCache(key);
      const results = new Map<number, MigrationChunkSummaryResult>();
      for (const [index, result] of Object.entries(cached?.chunks ?? {}))
        results.set(Number(index), result);
      // Estado em memória (retry de um lote que falhou) vence o cache.
      for (const [index, state] of Object.entries(chunks)) {
        if (state.status === "done") results.set(Number(index), state.result);
      }
      let finalOverview = overview ?? cached?.overview ?? null;

      const initial: Record<number, ChunkState> = {};
      for (const chunk of currentPlan.chunks) {
        const result = results.get(chunk.index);
        initial[chunk.index] = result
          ? { status: "done", result }
          : { status: "pending" };
      }
      setChunks(initial);
      setOverview(finalOverview);

      const persist = () =>
        writeCache(key, {
          chunks: Object.fromEntries(results),
          overview: finalOverview,
        });

      const queue = currentPlan.chunks.filter(
        (chunk) => !results.has(chunk.index),
      );
      let anyFailed = false;

      const worker = async () => {
        while (queue.length > 0 && !controller.signal.aborted) {
          const chunk = queue.shift()!;
          setChunks((prev) => ({
            ...prev,
            [chunk.index]: { status: "running" },
          }));
          try {
            const result = await postStep<MigrationChunkSummaryResult>(
              base,
              { phase: "chunk", index: chunk.index, provider, model },
              controller.signal,
            );
            results.set(chunk.index, result);
            persist();
            setChunks((prev) => ({
              ...prev,
              [chunk.index]: { status: "done", result },
            }));
            // Um lote novo invalida a visão geral anterior (ela não o conhecia).
            finalOverview = null;
            setOverview(null);
          } catch (err) {
            if (controller.signal.aborted) {
              setChunks((prev) => ({
                ...prev,
                [chunk.index]: { status: "pending" },
              }));
              return;
            }
            anyFailed = true;
            setChunks((prev) => ({
              ...prev,
              [chunk.index]: {
                status: "error",
                error: err instanceof Error ? err.message : "Erro",
              },
            }));
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      if (controller.signal.aborted || anyFailed) return;

      if (!finalOverview) {
        setOverviewState("running");
        try {
          finalOverview = await postStep<MigrationPackageOverviewResult>(
            base,
            {
              phase: "final",
              parts: [...results.values()].map(
                ({ index, fromOrder, toOrder, summary }) => ({
                  index,
                  fromOrder,
                  toOrder,
                  summary,
                }),
              ),
              provider,
              model,
            },
            controller.signal,
          );
          setOverview(finalOverview);
          persist();
          setOverviewState("idle");
        } catch (err) {
          if (!controller.signal.aborted) {
            setOverviewState("error");
            setError(
              err instanceof Error
                ? err.message
                : "Falha ao gerar a visão geral",
            );
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "Erro ao gerar o resumo");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [
    running,
    effectiveModelKey,
    connectionId,
    packageId,
    plan,
    chunks,
    overview,
  ]);

  /** Descarta o resultado (memória + cache do navegador) para a próxima execução refazer tudo. */
  function reset() {
    if (plan) {
      try {
        window.localStorage.removeItem(
          cacheKey(packageId, plan.checksum, effectiveModelKey),
        );
      } catch {
        // sem storage, nada a limpar
      }
    }
    setPlan(null);
    setChunks({});
    setOverview(null);
    setOverviewState("idle");
    setError(null);
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(document_);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar para a área de transferência");
    }
  }

  function download() {
    const blob = new Blob([document_], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${packageName.replace(/[^\w.-]+/g, "_") || "migrations"}-resumo.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const truncatedParts = doneResults.filter((part) => part.truncated).length;
  const complete =
    plan !== null && doneResults.length === total && overview !== null;
  const buttonLabel = running
    ? "Gerando..."
    : failed > 0
      ? "Tentar os que falharam"
      : doneResults.length > 0 && !complete
        ? "Continuar"
        : "Resumir todas as migrations";

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" />
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            Resumo detalhado do package
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={effectiveModelKey}
            onChange={(event) => {
              setModelKeySelected(event.target.value);
              // Outro modelo = outro resultado: recomeça do cache daquele modelo.
              setPlan(null);
              setChunks({});
              setOverview(null);
            }}
            disabled={loadingModels || running || models.length === 0}
            aria-label="Modelo de IA"
            className="max-w-[240px] rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          >
            {loadingModels ? (
              <option>Carregando modelos...</option>
            ) : models.length === 0 ? (
              <option>Nenhum provedor configurado</option>
            ) : (
              groupedModels.map(([provider, providerModels]) => (
                <optgroup
                  key={provider}
                  label={
                    LLM_PROVIDER_LABELS[
                      provider as keyof typeof LLM_PROVIDER_LABELS
                    ] ?? provider
                  }
                >
                  {providerModels.map((model) => (
                    <option key={modelKey(model)} value={modelKey(model)}>
                      {model.displayName}
                    </option>
                  ))}
                </optgroup>
              ))
            )}
          </select>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || loadingModels || running}
            title="Atualizar modelos das APIs disponíveis"
            aria-label="Atualizar modelos"
            className="rounded-md border border-[var(--color-border-subtle)] p-1 text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>

          {running ? (
            <button
              type="button"
              onClick={stop}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] transition hover:border-red-400 hover:text-red-400"
            >
              <Square className="h-3 w-3" /> Parar
            </button>
          ) : null}
          {!running && doneResults.length > 0 ? (
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              Refazer do zero
            </button>
          ) : null}
          {complete ? null : (
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || models.length === 0 || !effectiveModelKey}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {buttonLabel}
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        Lê todas as migrations em lotes, resume cada uma e consolida numa visão
        geral. O progresso fica salvo neste navegador — se parar ou falhar, é só
        continuar.
      </p>

      {modelsError ? (
        <p className="mt-2 text-xs text-red-500">{modelsError}</p>
      ) : null}
      {!loadingModels && models.length === 0 && !modelsError ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Nenhum provedor de LLM configurado. Defina GEMINI_API_KEY,
          OPENROUTER_API_KEY ou NVIDIA_API_KEY no ambiente.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}

      {plan ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-[var(--color-text-secondary)]">
            <span>
              {doneResults.length}/{total} lote(s) · {plan.totalFiles}{" "}
              migrations
              {overviewState === "running"
                ? " · consolidando visão geral..."
                : ""}
              {failed > 0 ? ` · ${failed} com erro` : ""}
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-layer-2)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          {failed > 0 ? (
            <ul className="space-y-0.5 text-[11px] text-red-500">
              {plan.chunks.flatMap((chunk) => {
                const state = chunks[chunk.index];
                return state?.status === "error"
                  ? [
                      <li key={chunk.index}>
                        #{chunk.fromOrder}–#{chunk.toOrder}: {state.error}
                      </li>,
                    ]
                  : [];
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {document_ ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
            <span>
              {complete ? "Resumo completo" : "Resumo parcial"} ·{" "}
              {doneResults[0]?.provider}/{doneResults[0]?.model}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-0.5 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? "copiado" : "copiar"}
              </button>
              <button
                type="button"
                onClick={download}
                className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-0.5 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                <Download className="h-3 w-3" /> baixar .md
              </button>
            </div>
          </div>

          {truncatedParts > 0 || overview?.truncated ? (
            <p className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] p-2 text-[11px] text-[var(--color-warning)]">
              <TriangleAlert className="h-3 w-3" />
              {truncatedParts > 0
                ? `${truncatedParts} lote(s)`
                : "A visão geral"}{" "}
              cortado(s) pelo limite de tokens do modelo — pode faltar parte do
              texto.
            </p>
          ) : null}

          <div className="max-h-[560px] overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/50 p-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            <SummaryMarkdown source={document_} />
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Gerado por IA a partir do SQL (cada migration truncada em ~3.000
            caracteres) — confira contra os arquivos antes de usar.
          </p>
        </div>
      ) : null}
    </div>
  );
}

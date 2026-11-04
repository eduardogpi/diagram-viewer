"use client";

import { Check, Copy, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import SummaryMarkdown from "@/components/migrations/SummaryMarkdown";
import { LLM_PROVIDER_LABELS, useLlmModels, type LlmModelInfo } from "@/lib/hooks/useLlmModels";
import type { MigrationSummaryResult } from "@/lib/types/migrations";

type Props = {
  connectionId: string;
  packageId: string;
  order: number;
  migrationName: string;
};

function modelKey(model: Pick<LlmModelInfo, "provider" | "id">): string {
  return `${model.provider}::${model.id}`;
}

const CONTEXT_OPTIONS = [0, 1, 2, 3, 5];

export default function MigrationSummaryPanel({ connectionId, packageId, order, migrationName }: Props) {
  const [before, setBefore] = useState(2);
  const [after, setAfter] = useState(2);
  const [modelKeySelected, setModelKeySelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MigrationSummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { models, loading: loadingModels, refreshing, error: modelsError, refresh } = useLlmModels();

  const effectiveModelKey = modelKeySelected || (models[0] ? modelKey(models[0]) : "");
  const groupedModels = useMemo(() => {
    const groups = new Map<string, LlmModelInfo[]>();
    for (const model of models) {
      if (!groups.has(model.provider)) groups.set(model.provider, []);
      groups.get(model.provider)!.push(model);
    }
    return Array.from(groups.entries());
  }, [models]);

  // Trocar de migration invalida o resumo anterior (ele era sobre outra migration).
  useEffect(() => {
    setResult(null);
    setError(null);
    setCopied(false);
  }, [order, packageId]);

  const canSubmit = !loading && models.length > 0 && effectiveModelKey.length > 0;

  async function generate() {
    if (!canSubmit) return;
    const [provider, model] = effectiveModelKey.split("::");
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/migrations/${connectionId}/${packageId}/summary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order, before, after, provider: provider || undefined, model: model || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha ao gerar o resumo");
      }
      setResult((await res.json()) as MigrationSummaryResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar o resumo");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar para a área de transferência");
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" />
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            Resumo com IA
          </span>
          <span className="hidden text-xs text-[var(--color-text-muted)] sm:inline">
            explica a migration #{order}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
            anteriores
            <select
              value={before}
              onChange={(event) => setBefore(Number(event.target.value))}
              disabled={loading}
              aria-label="Quantas migrations anteriores incluir no contexto"
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-1.5 py-1 text-[11px] text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
            >
              {CONTEXT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
            posteriores
            <select
              value={after}
              onChange={(event) => setAfter(Number(event.target.value))}
              disabled={loading}
              aria-label="Quantas migrations posteriores incluir no contexto"
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-1.5 py-1 text-[11px] text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
            >
              {CONTEXT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <select
            value={effectiveModelKey}
            onChange={(event) => setModelKeySelected(event.target.value)}
            disabled={loadingModels || loading || models.length === 0}
            aria-label="Modelo de IA"
            className="max-w-[220px] rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          >
            {loadingModels ? (
              <option>Carregando modelos...</option>
            ) : models.length === 0 ? (
              <option>Nenhum provedor configurado</option>
            ) : (
              groupedModels.map(([provider, providerModels]) => (
                <optgroup
                  key={provider}
                  label={LLM_PROVIDER_LABELS[provider as keyof typeof LLM_PROVIDER_LABELS] ?? provider}
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
            disabled={refreshing || loadingModels}
            title="Atualizar modelos das APIs disponíveis"
            aria-label="Atualizar modelos"
            className="rounded-md border border-[var(--color-border-subtle)] p-1 text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>

          <button
            type="button"
            onClick={() => void generate()}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading ? "Resumindo..." : "Resumir com IA"}
          </button>
        </div>
      </div>

      {modelsError ? <p className="mt-2 text-xs text-red-500">{modelsError}</p> : null}
      {!loadingModels && models.length === 0 && !modelsError ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Nenhum provedor de LLM configurado. Defina GEMINI_API_KEY, OPENROUTER_API_KEY ou NVIDIA_API_KEY no ambiente.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}

      {result ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
            <span>
              {result.provider}/{result.model} · contexto: {result.context.before} anterior(es),{" "}
              {result.context.after} posterior(es)
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-0.5 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "copiado" : "copiar"}
            </button>
          </div>

          {result.truncated ? (
            <p className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] p-2 text-[11px] text-[var(--color-warning)]">
              <TriangleAlert className="h-3 w-3" />
              A resposta foi cortada pelo limite de tokens — pode faltar parte do resumo.
            </p>
          ) : null}

          <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/50 p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            <SummaryMarkdown source={result.summary} />
          </div>

          <p className="text-[10px] text-[var(--color-text-muted)]">
            Resumo gerado sobre <span className="font-mono">{migrationName}</span> — confira contra o SQL antes de usar.
          </p>
        </div>
      ) : null}
    </div>
  );
}

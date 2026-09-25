"use client";

import { useCallback, useEffect, useState } from "react";

export type LlmProvider = "gemini" | "openrouter" | "nvidia";

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  nvidia: "NVIDIA",
};

export type LlmModelInfo = {
  id: string;
  displayName: string;
  description?: string;
  provider: LlmProvider;
};

async function fetchLlmModels(forceRefresh: boolean): Promise<LlmModelInfo[]> {
  const url = forceRefresh ? "/api/ai-modeling/models?refresh=1" : "/api/ai-modeling/models";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao listar modelos");
  const data = (await res.json()) as { models: LlmModelInfo[] };
  return data.models;
}

export function useLlmModels() {
  const [models, setModels] = useState<LlmModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLlmModels(false)
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao listar modelos");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Rebusca os modelos ignorando o cache do servidor (botão "atualizar modelos"). */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setModels(await fetchLlmModels(true));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar modelos");
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { models, loading, refreshing, error, refresh };
}

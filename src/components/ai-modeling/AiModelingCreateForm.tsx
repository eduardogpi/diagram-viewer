"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { LLM_PROVIDER_LABELS, useLlmModels, type LlmModelInfo } from "@/lib/hooks/useLlmModels";

function modelKey(m: Pick<LlmModelInfo, "provider" | "id">): string {
  return `${m.provider}::${m.id}`;
}

export default function AiModelingCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [modelKeySelected, setModelKeySelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { models, loading: loadingModels, refreshing, error: modelsError, refresh } = useLlmModels();

  // Se o usuário ainda não escolheu um modelo explicitamente, usa o primeiro da lista.
  const effectiveModelKey = modelKeySelected || (models[0] ? modelKey(models[0]) : "");
  const groupedModels = useMemo(() => {
    const groups = new Map<string, LlmModelInfo[]>();
    for (const m of models) {
      if (!groups.has(m.provider)) groups.set(m.provider, []);
      groups.get(m.provider)!.push(m);
    }
    return Array.from(groups.entries());
  }, [models]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 3) {
      setError("Nome deve ter ao menos 3 caracteres");
      return;
    }

    const [provider, model] = effectiveModelKey.split("::");

    startTransition(async () => {
      const res = await fetch("/api/ai-modeling/create-project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), model: model || undefined, provider: provider || undefined }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Falha ao criar modelagem");
        return;
      }

      const data = (await res.json()) as { connectionId: string; sessionId: string };
      router.push(`/workspace/${data.connectionId}?tab=ai-modeling&session=${data.sessionId}`);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-5 text-sm text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]"
    >
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">Modelagem com IA</p>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Descreva o schema que você quer em linguagem natural e desenhe o diagrama junto com uma LLM, sem precisar de
          uma conexão de banco ativa.
        </p>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome do projeto (ex: Loja online)"
        required
        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
      />

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">Modelo</label>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || loadingModels}
            title="Atualizar modelos das APIs disponíveis"
            aria-label="Atualizar modelos das APIs disponíveis"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] transition hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
        <select
          value={effectiveModelKey}
          onChange={(e) => setModelKeySelected(e.target.value)}
          disabled={loadingModels || models.length === 0}
          className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
        >
          {loadingModels ? (
            <option>Carregando modelos...</option>
          ) : models.length === 0 ? (
            <option>Nenhum provedor de LLM configurado</option>
          ) : (
            groupedModels.map(([provider, providerModels]) => (
              <optgroup key={provider} label={LLM_PROVIDER_LABELS[provider as keyof typeof LLM_PROVIDER_LABELS] ?? provider}>
                {providerModels.map((m) => (
                  <option key={modelKey(m)} value={modelKey(m)}>
                    {m.displayName}
                  </option>
                ))}
              </optgroup>
            ))
          )}
        </select>
        {modelsError ? <p className="text-xs text-red-500">{modelsError}</p> : null}
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Criando..." : "Criar nova modelagem"}
        </button>
      </div>
    </form>
  );
}

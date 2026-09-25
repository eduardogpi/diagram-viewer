"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type DevSessionFormProps = {
  currentUserId: string | null;
};

export default function DevSessionForm({ currentUserId }: DevSessionFormProps) {
  const router = useRouter();
  const [userId, setUserId] = useState(currentUserId ?? "demo-user");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await fetch("/api/auth/dev-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Não foi possível iniciar a sessão de desenvolvimento");
        return;
      }

      router.refresh();
    });
  }

  function handleLogout() {
    setError(null);

    startTransition(async () => {
      const res = await fetch("/api/auth/dev-session", {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Não foi possível encerrar a sessão");
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/70 p-4 text-sm text-[var(--color-text-primary)] shadow-[var(--shadow-floating)] sm:max-w-md">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">Sessão de desenvolvimento</p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Defina um identificador simples para testar o app sem um provedor real de autenticação.
        </p>
      </div>

      <form onSubmit={handleLogin} className="flex flex-col gap-3">
        <input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="Ex.: demo-user"
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={isPending || userId.trim().length === 0}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Entrando..." : currentUserId ? "Trocar usuário" : "Entrar"}
          </button>

          {currentUserId && (
            <button
              type="button"
              onClick={handleLogout}
              disabled={isPending}
              className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 font-semibold text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sair
            </button>
          )}
        </div>
      </form>

      {currentUserId && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-success)_35%,transparent)] bg-[var(--color-success-soft)] px-3 py-2 text-xs text-[var(--color-success)]">
          Usuário ativo: <span className="font-mono">{currentUserId}</span>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

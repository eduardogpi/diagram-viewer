"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PROVIDER_META, providerLabel } from "@/lib/db/provider-meta";
import { connectionProviders } from "@/lib/validators/connection";

type ConnectionHealth = {
  status: "ONLINE" | "OFFLINE" | "UNKNOWN";
  checkedAt: string | null;
  error: string | null;
};

type ConnectionItem = {
  id: string;
  name: string;
  provider: string;
  host: string;
  port: number;
  database: string;
  schema?: string | null;
  username: string;
  tags: string[];
  createdAt: string | Date;
  updatedAt: string | Date;
  health: ConnectionHealth;
};

type Props = {
  connections: ConnectionItem[];
};

function healthLabel(health: ConnectionHealth) {
  switch (health.status) {
    case "ONLINE":
      return "Online";
    case "OFFLINE":
      return "Offline";
    default:
      return "Não testada";
  }
}

function healthClasses(health: ConnectionHealth) {
  switch (health.status) {
    case "ONLINE":
      return "border-[color-mix(in_srgb,var(--color-success)_35%,transparent)] bg-[var(--color-success-soft)] text-[var(--color-success)]";
    case "OFFLINE":
      return "border-[color-mix(in_srgb,#ef4444_35%,transparent)] bg-[color-mix(in_srgb,#ef4444_10%,var(--color-bg-layer-1))] text-[#dc2626]";
    default:
      return "border-[var(--color-border-subtle)] bg-[var(--color-panel-muted)] text-[var(--color-text-secondary)]";
  }
}

export default function ConnectionsCatalog({ connections }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [activeTag, setActiveTag] = useState<string>("ALL");
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const availableTags = useMemo(() => {
    return Array.from(new Set(connections.flatMap((conn) => conn.tags))).sort((a, b) => a.localeCompare(b));
  }, [connections]);

  const visibleConnections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return connections.filter((conn) => {
      const matchesQuery =
        !normalizedQuery ||
        conn.name.toLowerCase().includes(normalizedQuery) ||
        conn.host.toLowerCase().includes(normalizedQuery) ||
        conn.database.toLowerCase().includes(normalizedQuery) ||
        conn.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));

      const matchesProvider = providerFilter === "ALL" || conn.provider === providerFilter;
      const matchesStatus = statusFilter === "ALL" || conn.health.status === statusFilter;
      const matchesTag = activeTag === "ALL" || conn.tags.includes(activeTag);

      return matchesQuery && matchesProvider && matchesStatus && matchesTag;
    });
  }, [activeTag, connections, providerFilter, query, statusFilter]);

  function retestConnection(connectionId: string) {
    setPendingActionId(connectionId);
    startTransition(async () => {
      await fetch(`/api/connections/${connectionId}/retest`, { method: "POST" });
      router.refresh();
      setPendingActionId(null);
    });
  }

  function deleteConnection(connectionId: string) {
    const confirmed = window.confirm("Deseja remover esta conexão?");
    if (!confirmed) {
      return;
    }

    setPendingActionId(connectionId);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          window.alert(body?.error ?? "Falha ao remover a conexão");
          return;
        }
        router.refresh();
      } finally {
        setPendingActionId(null);
      }
    });
  }

  function editConnection(connection: ConnectionItem) {
    const name = window.prompt("Novo nome da conexão", connection.name);
    if (!name) {
      return;
    }

    const tags = window.prompt("Tags separadas por vírgula", connection.tags.join(", "));
    const normalizedTags = (tags ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    setPendingActionId(connection.id);
    startTransition(async () => {
      await fetch(`/api/connections/${connection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tags: normalizedTags }),
      });
      router.refresh();
      setPendingActionId(null);
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/70 p-5 shadow-[var(--shadow-floating)]">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, host, database ou tag"
            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]"
          />

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]"
          >
            <option value="ALL">Todos providers</option>
            {connectionProviders.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_META[provider].label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]"
          >
            <option value="ALL">Todos status</option>
            <option value="ONLINE">Online</option>
            <option value="OFFLINE">Offline</option>
            <option value="UNKNOWN">Não testada</option>
          </select>
        </div>

        {availableTags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTag("ALL")}
              className={`rounded-full px-3 py-1 text-xs ${
                activeTag === "ALL"
                  ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)]"
                  : "bg-[var(--color-panel-muted)] text-[var(--color-text-secondary)]"
              }`}
            >
              Todas tags
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(tag)}
                className={`rounded-full px-3 py-1 text-xs ${
                  activeTag === tag
                    ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)]"
                    : "bg-[var(--color-panel-muted)] text-[var(--color-text-secondary)]"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        {visibleConnections.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-[var(--color-border-subtle)] p-8 text-center text-[var(--color-text-secondary)]">
            Nenhuma conexão encontrada com os filtros atuais.
          </div>
        )}

        {visibleConnections.map((conn) => {
          const busy = isPending && pendingActionId === conn.id;

          return (
            <article
              key={conn.id}
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-6 shadow-[var(--shadow-floating)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
                    {providerLabel(conn.provider)}
                  </p>
                  <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{conn.name}</h2>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {conn.host}:{conn.port} · {conn.database}
                    {conn.schema ? ` · ${conn.schema}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">Usuário: {conn.username}</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-medium ${healthClasses(conn.health)}`}>
                  {healthLabel(conn.health)}
                </span>
              </div>

              {conn.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {conn.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-[var(--color-panel-muted)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-5 grid gap-2 text-sm text-[var(--color-text-secondary)]">
                <p>Criada em {new Date(conn.createdAt).toLocaleDateString("pt-BR")}</p>
                <p>Atualizada em {new Date(conn.updatedAt).toLocaleDateString("pt-BR")}</p>
                <p>
                  Último teste:{" "}
                  {conn.health.checkedAt ? new Date(conn.health.checkedAt).toLocaleString("pt-BR") : "ainda não executado"}
                </p>
                {conn.health.error && <p className="text-red-500">Erro: {conn.health.error}</p>}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] pt-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => editConnection(conn)}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)] disabled:opacity-50"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => retestConnection(conn.id)}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)] disabled:opacity-50"
                  >
                    {busy ? "Testando..." : "Retestar"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => deleteConnection(conn.id)}
                    className="rounded-lg border border-[color-mix(in_srgb,#ef4444_35%,transparent)] px-4 py-2 text-sm text-[#dc2626] transition hover:border-[#ef4444] disabled:opacity-50"
                  >
                    Remover
                  </button>
                </div>

                <Link
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-accent)] hover:text-[color-mix(in_srgb,var(--color-accent)_80%,var(--color-text-primary))]"
                  href={`/workspace/${conn.id}`}
                >
                  Abrir workspace →
                </Link>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

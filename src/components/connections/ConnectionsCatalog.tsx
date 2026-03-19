"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "OFFLINE":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    default:
      return "border-slate-700 bg-slate-800/70 text-slate-300";
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
      await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
      router.refresh();
      setPendingActionId(null);
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
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, host, database ou tag"
            className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
          />

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
          >
            <option value="ALL">Todos providers</option>
            <option value="MYSQL">MYSQL</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
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
              className={`rounded-full px-3 py-1 text-xs ${activeTag === "ALL" ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}
            >
              Todas tags
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(tag)}
                className={`rounded-full px-3 py-1 text-xs ${activeTag === tag ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        {visibleConnections.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-800 p-8 text-center text-slate-400">
            Nenhuma conexão encontrada com os filtros atuais.
          </div>
        )}

        {visibleConnections.map((conn) => {
          const busy = isPending && pendingActionId === conn.id;

          return (
            <article
              key={conn.id}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-cyan-500/10"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{conn.provider}</p>
                  <h2 className="text-xl font-semibold text-slate-100">{conn.name}</h2>
                  <p className="text-sm text-slate-400">
                    {conn.host}:{conn.port} · {conn.database}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Usuário: {conn.username}</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-medium ${healthClasses(conn.health)}`}>
                  {healthLabel(conn.health)}
                </span>
              </div>

              {conn.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {conn.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-5 grid gap-2 text-sm text-slate-400">
                <p>Criada em {new Date(conn.createdAt).toLocaleDateString("pt-BR")}</p>
                <p>Atualizada em {new Date(conn.updatedAt).toLocaleDateString("pt-BR")}</p>
                <p>
                  Último teste:{" "}
                  {conn.health.checkedAt ? new Date(conn.health.checkedAt).toLocaleString("pt-BR") : "ainda não executado"}
                </p>
                {conn.health.error && <p className="text-red-300">Erro: {conn.health.error}</p>}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => editConnection(conn)}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-400 disabled:opacity-50"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => retestConnection(conn.id)}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-400 disabled:opacity-50"
                  >
                    {busy ? "Testando..." : "Retestar"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => deleteConnection(conn.id)}
                    className="rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-300 transition hover:border-red-400 disabled:opacity-50"
                  >
                    Remover
                  </button>
                </div>

                <Link
                  className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200"
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

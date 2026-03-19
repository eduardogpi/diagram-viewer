import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentUserId } from "@/lib/auth/session";
import { listRecentConnectionEvents, getWorkspaceConnectionForUser } from "@/lib/services/workspace";

export default async function WorkspaceLayout({
  children,
  params,
  searchParams,
}: {
  children: React.ReactNode;
  params: Promise<{ connectionId: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { connectionId } = await params;
  const ownerId = await requireCurrentUserId();
  const connection = await getWorkspaceConnectionForUser(connectionId, ownerId);

  if (!connection) {
    notFound();
  }

  const events = await listRecentConnectionEvents(connection.id);
  const sp = searchParams ? await searchParams : {};
  const activeTab = (sp as { tab?: string }).tab ?? "editor";
  const isDiagram = activeTab === "diagram";

  const healthLabel =
    connection.health.status === "ONLINE"
      ? "Online"
      : connection.health.status === "OFFLINE"
        ? "Offline"
        : "Não testada";

  const healthClass =
    connection.health.status === "ONLINE"
      ? "bg-emerald-500/10 text-emerald-300"
      : connection.health.status === "OFFLINE"
        ? "bg-red-500/10 text-red-300"
        : "bg-slate-800 text-slate-300";

  if (isDiagram) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/90 px-6 py-3 backdrop-blur-md">
          <nav className="text-sm text-slate-500">
            <Link className="hover:text-cyan-300" href="/">
              Workspaces
            </Link>
            <span className="px-2 text-slate-600">/</span>
            <span className="text-slate-300">{connection.name}</span>
            <span className="px-2 text-slate-600">/</span>
            <span className="text-slate-300">Diagramas</span>
          </nav>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${healthClass}`}>{healthLabel}</span>
        </div>
        <div className="w-full">{children}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full flex-col px-6 py-10">
        <nav className="text-sm text-slate-500">
          <Link className="hover:text-cyan-300" href="/">
            Workspaces
          </Link>
          <span className="px-2 text-slate-600">/</span>
          <span className="text-slate-300">{connection.name}</span>
          <span className="px-2 text-slate-600">/</span>
          <span className="text-slate-300 capitalize">{activeTab}</span>
        </nav>

        <header className="mt-6 flex flex-col gap-4 border-b border-slate-800 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-500">{connection.provider}</p>
            <h1 className="mt-2 text-2xl font-semibold">{connection.name}</h1>
            <p className="mt-2 text-sm text-slate-400">
              {connection.host}:{connection.port} · {connection.database}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {connection.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-slate-800/80 px-3 py-1 text-xs text-slate-300">
                {tag}
              </span>
            ))}
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${healthClass}`}>{healthLabel}</span>
          </div>
        </header>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0 rounded-2xl border border-slate-900 bg-slate-950/40 p-3 md:p-4">
            {children}
          </section>

          <aside className="space-y-5 rounded-2xl border border-slate-900 bg-slate-950/60 p-4 xl:sticky xl:top-6 xl:self-start">
            <section>
              <h2 className="text-sm font-semibold text-slate-300">Resumo</h2>
              <dl className="mt-4 space-y-3 text-sm text-slate-400">
                <div className="flex justify-between gap-3">
                  <dt>Host</dt>
                  <dd className="text-right text-slate-200">{connection.host}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Usuário</dt>
                  <dd className="text-right text-slate-200">{connection.username}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Database</dt>
                  <dd className="text-right text-slate-200">{connection.database}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Último teste</dt>
                  <dd className="text-right text-slate-200">
                    {connection.health.checkedAt
                      ? new Date(connection.health.checkedAt).toLocaleString("pt-BR")
                      : "Sem teste"}
                  </dd>
                </div>
              </dl>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-300">Eventos recentes</h2>
              <div className="mt-4 space-y-3">
                {events.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-800 p-4 text-sm text-slate-500">
                    Nenhum evento recente para esta conexão.
                  </div>
                )}

                {events.map((event) => (
                  <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-sm font-medium text-slate-100">{event.action}</p>
                    {event.context && <p className="mt-1 text-xs text-slate-400">{event.context}</p>}
                    <p className="mt-2 text-[11px] text-slate-500">
                      {new Date(event.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

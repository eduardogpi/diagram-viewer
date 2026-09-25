import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentUserId } from "@/lib/auth/session";
import { getWorkspaceConnectionForUser } from "@/lib/services/workspace";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ connectionId: string }>;
}) {
  const { connectionId } = await params;
  const ownerId = await requireCurrentUserId();
  const connection = await getWorkspaceConnectionForUser(connectionId, ownerId);

  if (!connection) {
    notFound();
  }

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full flex-col px-4 py-6 md:px-6 md:py-8">
        <nav className="text-sm text-slate-500">
          <Link className="hover:text-cyan-300" href="/">
            Workspaces
          </Link>
          <span className="px-2 text-slate-600">/</span>
          <span className="text-slate-300">{connection.name}</span>
        </nav>

        <header className="mt-4 flex flex-col gap-4 border-b border-slate-800 pb-6 lg:flex-row lg:items-center lg:justify-between">
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

        <main className="mt-6 w-full min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}

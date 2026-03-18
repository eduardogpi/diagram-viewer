import Link from "next/link";

type ConnectionMeta = {
  name: string;
  provider: string;
  host: string;
  tags: string[];
  status: string;
};

const demoConnections: Record<string, ConnectionMeta> = {
  "demo-mysql": {
    name: "Produção - MySQL",
    provider: "MySQL",
    host: "prod.db.internal",
    tags: ["critico", "financeiro"],
    status: "Online",
  },
  "demo-pg": {
    name: "Data Lake - Postgres",
    provider: "Postgres",
    host: "analytics.cluster",
    tags: ["read-only"],
    status: "Read only",
  },
};

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
  const sp = searchParams ? await searchParams : {};
  const isDiagram = (sp as { tab?: string }).tab === "diagram";
  const connection = demoConnections[connectionId] ?? {
    name: connectionId,
    provider: "Desconhecido",
    host: "—",
    tags: [],
    status: "Indefinido",
  };

  if (isDiagram) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        {/* Barra superior compacta */}
        <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-950/90 px-6 py-3 backdrop-blur-md">
          <nav className="text-sm text-slate-500">
            <Link className="hover:text-cyan-300" href="/">Workspaces</Link>
            <span className="px-2 text-slate-600">/</span>
            <span className="text-slate-300">{connection.name}</span>
          </nav>
          <span className="text-slate-700">·</span>
          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            {connection.status}
          </span>
        </div>
        {/* Canvas ocupa todo o restante */}
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
        </nav>

        <header className="mt-6 flex flex-col gap-4 border-b border-slate-800 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-lg uppercase tracking-[0.4em] text-slate-500">
              {connection.provider}
            </p>
            <h1 className="text-lg font-semibold">{connection.name}</h1>
            <p className="text-sm text-slate-400">{connection.host}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {connection.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-800/80 px-3 py-1 text-xs text-slate-300"
              >
                {tag}
              </span>
            ))}
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              {connection.status}
            </span>
          </div>
        </header>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
          <section className="min-w-0 rounded-2xl border border-slate-900 bg-slate-950/40 p-3 md:p-4">
            {children}
          </section>

          <aside className="rounded-2xl border border-slate-900 bg-slate-950/60 p-4 xl:sticky xl:top-6 xl:self-start">
            <h2 className="text-sm font-semibold text-slate-300">Detalhes</h2>
            <dl className="mt-4 space-y-3 text-sm text-slate-400">
              <div className="flex justify-between">
                <dt>Host</dt>
                <dd className="text-slate-200">{connection.host}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Usuário padrão</dt>
                <dd className="text-slate-200">ops_admin</dd>
              </div>
              <div className="flex justify-between">
                <dt>Última atualização</dt>
                <dd className="text-slate-200">há 5 min</dd>
              </div>
              <div className="flex justify-between">
                <dt>Checksum de schema</dt>
                <dd className="text-slate-200">7a92e1</dd>
              </div>
            </dl>

            <div className="mt-6 space-y-2">
              <button className="w-full rounded-lg border border-slate-800 px-4 py-2 text-sm text-slate-200 hover:border-slate-600">
                Atualizar schema
              </button>
              <button className="w-full rounded-lg border border-slate-800 px-4 py-2 text-sm text-slate-200 hover:border-slate-600">
                Ver histórico de auditoria
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

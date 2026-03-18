import Link from "next/link";
import { headers } from "next/headers";

import ConnectionForm from "@/components/connections/ConnectionForm";

type ConnectionDTO = {
  id: string;
  name: string;
  provider: string;
  host: string;
  port: number;
  tags: string[];
};

async function fetchConnections(): Promise<ConnectionDTO[]> {
  const headersList = await headers();
  const protocolFromHeaders = headersList.get("x-forwarded-proto") ?? undefined;
  const hostFromHeaders = headersList.get("host") ?? undefined;
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (protocolFromHeaders && hostFromHeaders
      ? `${protocolFromHeaders}://${hostFromHeaders}`
      : `http://localhost:3000`);
  const url = `${baseUrl.replace(/\/$/, "")}/api/connections`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error("Falha ao carregar conexões", await res.text());
    return [];
  }
  return res.json();
}

export default async function Home() {
  const connections = await fetchConnections();
  return (
    <div className="min-h-screen min-w-screen border-2 border-slate-800 bg-slate-950 px-6 py-12 text-slate-100">
      <header className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-cyan-400">
            Workbench Web
          </p>
          <h1 className="text-3xl font-semibold">Suas conexões e workspaces</h1>
          <p className="text-sm text-slate-400">
            Centralize conexões, diagramas e históricos SQL em um único ambiente seguro.
          </p>
        </div>
        <ConnectionForm />
      </header>

      <main className="mx-auto mt-12 grid max-w-6xl gap-6 md:grid-cols-2">
        {connections.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-800 p-8 text-center text-slate-400">
            Nenhuma conexão cadastrada ainda. Use o formulário acima para criar a primeira.
          </div>
        )}
        {connections.map((conn) => (
          <article
            key={conn.id}
            className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-cyan-500/10"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {conn.provider}
                </p>
                <h2 className="text-xl font-semibold">{conn.name}</h2>
                <p className="text-sm text-slate-400">
                  {conn.host}:{conn.port}
                </p>
              </div>
              <div className="flex gap-2">
                {conn.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-4">
              <p className="text-sm text-slate-400">Último acesso há 2h</p>
              <Link
                className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                href={`/workspace/${conn.id}`}
              >
                Abrir workspace →
              </Link>
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}

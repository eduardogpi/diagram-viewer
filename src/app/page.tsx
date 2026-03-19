import ConnectionsCatalog from "@/components/connections/ConnectionsCatalog";
import ConnectionForm from "@/components/connections/ConnectionForm";
import { requireCurrentUserId } from "@/lib/auth/session";
import { listConnectionsForUser } from "@/lib/services/connections";

type ConnectionDTO = Awaited<ReturnType<typeof listConnectionsForUser>>[number];

async function fetchConnections(): Promise<ConnectionDTO[]> {
  const ownerId = await requireCurrentUserId();
  return listConnectionsForUser(ownerId);
}

export default async function Home() {
  const connections = await fetchConnections();

  return (
    <div className="min-h-screen min-w-screen border-2 border-slate-800 bg-slate-950 px-6 py-12 text-slate-100">
      <header className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-cyan-400">Workbench Web</p>
          <h1 className="text-3xl font-semibold">Suas conexões e workspaces</h1>
          <p className="text-sm text-slate-400">
            Centralize conexões, diagramas e históricos SQL em um único ambiente seguro.
          </p>
        </div>
        <ConnectionForm />
      </header>

      <main className="mx-auto mt-12 max-w-6xl">
        <ConnectionsCatalog connections={connections} />
      </main>
    </div>
  );
}

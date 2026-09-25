import AiModelingCreateForm from "@/components/ai-modeling/AiModelingCreateForm";
import ConnectionsCatalog from "@/components/connections/ConnectionsCatalog";
import ConnectionForm from "@/components/connections/ConnectionForm";
import DevSessionForm from "@/components/auth/DevSessionForm";
import MigrationImportForm from "@/components/migrations/MigrationImportForm";
import GettingStarted from "@/components/onboarding/GettingStarted";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { getCurrentUserId } from "@/lib/auth/session";
import { listConnectionsForUser } from "@/lib/services/connections";
import Link from "next/link";

type ConnectionDTO = Awaited<ReturnType<typeof listConnectionsForUser>>[number];

async function fetchConnections(): Promise<ConnectionDTO[]> {
  const ownerId = await getCurrentUserId();
  if (!ownerId) {
    return [];
  }
  return listConnectionsForUser(ownerId);
}

export default async function Home() {
  const userId = await getCurrentUserId();
  const connections = await fetchConnections();

  return (
    <div className="min-h-screen w-full bg-[var(--color-bg-canvas)] px-6 py-12 text-[var(--color-text-primary)]">
      <header className="mx-auto flex max-w-6xl flex-col gap-4 rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/70 px-6 py-6 shadow-[var(--shadow-floating)] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--color-accent)]">Workbench Web</p>
          <h1 className="text-3xl font-semibold text-[var(--color-text-primary)]">Suas conexões e workspaces</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Centralize conexões, diagramas e históricos SQL em um único ambiente seguro.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/help"
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]"
          >
            Ajuda
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto mt-12 max-w-6xl">
        {userId ? (
          <div className="space-y-10">
            {connections.length === 0 ? <GettingStarted /> : null}

            <section className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
                Começar rápido — sem precisar de um banco ativo
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <AiModelingCreateForm />
                <MigrationImportForm />
              </div>
            </section>

            <section className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
                Conectar a um banco real
              </p>
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <ConnectionForm />
                <DevSessionForm currentUserId={userId} />
              </div>
            </section>

            <ConnectionsCatalog connections={connections} />
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-6 text-sm text-[var(--color-text-secondary)]">
            <div className="space-y-4">
              <p>Nenhum usuário autenticado foi encontrado via cookie `workbench_user_id` ou header `x-user-id`.</p>
              <DevSessionForm currentUserId={userId} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

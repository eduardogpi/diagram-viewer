import AiModelingWorkbench from "@/components/ai-modeling/AiModelingWorkbench";
import DiagramScopeView from "@/components/diagrams/DiagramScopeView";
import ExplorerWorkbench from "@/components/explorer/ExplorerWorkbench";
import MigrationsWorkbench from "@/components/migrations/MigrationsWorkbench";
import SqlEditorWorkbench from "@/components/sql/SqlEditorWorkbench";
import WorkspaceTabs from "@/components/workspace/WorkspaceTabs";
import { requireCurrentUserId } from "@/lib/auth/session";
import {
  getWorkspaceConnectionForUser,
  getWorkspacePreference,
  listRecentConnectionEvents,
} from "@/lib/services/workspace";

const tabs = [
  { id: "editor", label: "Editor SQL", description: "Consultas, snippets e historico operacional." },
  { id: "explorer", label: "Explorer", description: "Navegacao de schema, tabelas e relacionamentos." },
  { id: "diagram", label: "Diagramas", description: "Visao relacional e filtros por escopo." },
  { id: "migrations", label: "Migrations", description: "Importar migrations e gerar diagramas do schema." },
  { id: "ai-modeling", label: "Modelagem IA", description: "Desenhe e altere o schema conversando com uma LLM." },
  { id: "admin", label: "Admin", description: "Auditoria, jobs e saude operacional." },
];

type WorkspacePageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ tab?: string; session?: string; sql?: string }>;
};

function EmptyModule({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-2 rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-6 text-sm text-[var(--color-text-secondary)]">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export default async function WorkspacePage({ params, searchParams }: WorkspacePageProps) {
  const { connectionId } = await params;
  const userId = await requireCurrentUserId();
  const connection = await getWorkspaceConnectionForUser(connectionId, userId);
  const preference = await getWorkspacePreference(userId, connectionId);
  const resolvedSearchParams = await searchParams;
  const activeTab = resolvedSearchParams?.tab ?? preference.favoriteTabs[0] ?? "editor";

  if (!connection) {
    return null;
  }

  const isMigrationsConnection = connection.provider === "MIGRATIONS";

  if (activeTab === "diagram" && !isMigrationsConnection) {
    return (
      <div className="space-y-6">
        <WorkspaceTabs
          connectionId={connectionId}
          activeTab={activeTab}
          favoriteTab={preference.favoriteTabs[0] ?? null}
          tabs={tabs}
        />
        <DiagramScopeView connectionId={connectionId} />
      </div>
    );
  }

  const shouldShowMigrationsWorkbench =
    activeTab === "migrations" || (isMigrationsConnection && (activeTab === "diagram" || activeTab === "editor"));

  if (shouldShowMigrationsWorkbench) {
    return (
      <div className="space-y-6">
        <WorkspaceTabs
          connectionId={connectionId}
          activeTab={activeTab}
          favoriteTab={preference.favoriteTabs[0] ?? null}
          tabs={tabs}
        />
        <MigrationsWorkbench connectionId={connectionId} />
      </div>
    );
  }

  const events = activeTab === "admin" ? await listRecentConnectionEvents(connection.id) : [];

  return (
    <div className="space-y-6">
      <WorkspaceTabs
        connectionId={connectionId}
        activeTab={activeTab}
        favoriteTab={preference.favoriteTabs[0] ?? null}
        tabs={tabs}
      />

      {activeTab === "editor" ? (
        <SqlEditorWorkbench
          connectionId={connectionId}
          connectionName={connection.name}
          databaseName={connection.database}
          provider={connection.provider}
          initialSql={resolvedSearchParams?.sql}
        />
      ) : null}

      {activeTab === "ai-modeling" ? (
        <AiModelingWorkbench connectionId={connectionId} initialSessionId={resolvedSearchParams?.session} />
      ) : null}

      {activeTab === "explorer" ? (
        isMigrationsConnection ? (
          <EmptyModule
            title="Explorer indisponível para conexões de migrations"
            description="Conexões baseadas em migrations não têm banco real por trás. Use a aba Migrations para navegar pelos snapshots."
          />
        ) : (
          <ExplorerWorkbench connectionId={connectionId} />
        )
      ) : null}

      {activeTab === "admin" ? (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="text-sm font-semibold text-slate-200">Resumo da Conexão</h3>
              <dl className="mt-4 space-y-3 text-sm text-slate-400">
                <div className="flex justify-between border-b border-slate-800/60 pb-2">
                  <dt>Host / Porta</dt>
                  <dd className="font-mono text-slate-200">{connection.host}:{connection.port}</dd>
                </div>
                <div className="flex justify-between border-b border-slate-800/60 pb-2">
                  <dt>Database</dt>
                  <dd className="font-mono text-slate-200">{connection.database}</dd>
                </div>
                <div className="flex justify-between border-b border-slate-800/60 pb-2">
                  <dt>Usuário</dt>
                  <dd className="font-mono text-slate-200">{connection.username}</dd>
                </div>
                <div className="flex justify-between pb-1">
                  <dt>Status</dt>
                  <dd className={connection.health.status === "ONLINE" ? "text-emerald-400" : "text-amber-400"}>
                    {connection.health.status}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="text-sm font-semibold text-slate-200">Eventos Recentes de Auditoria</h3>
              <div className="mt-4 space-y-3 max-h-72 overflow-auto pr-1">
                {events.length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhum evento registrado ainda.</p>
                ) : (
                  events.map((evt) => (
                    <div key={evt.id} className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-cyan-300">{evt.action}</span>
                        <span className="text-slate-500">{new Date(evt.createdAt).toLocaleString("pt-BR")}</span>
                      </div>
                      {evt.context ? <p className="mt-1 text-slate-400 line-clamp-2">{evt.context}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import DiagramScopeView from "@/components/diagrams/DiagramScopeView";
import SqlEditorWorkbench from "@/components/sql/SqlEditorWorkbench";
import WorkspaceTabs from "@/components/workspace/WorkspaceTabs";
import { requireCurrentUserId } from "@/lib/auth/session";
import { getWorkspaceConnectionForUser, getWorkspacePreference } from "@/lib/services/workspace";

const tabs = [
  { id: "editor", label: "Editor SQL", description: "Consultas, snippets e historico operacional." },
  { id: "explorer", label: "Explorer", description: "Navegacao de schema, tabelas e relacionamentos." },
  { id: "diagram", label: "Diagramas", description: "Visao relacional e filtros por escopo." },
  { id: "admin", label: "Admin", description: "Auditoria, jobs e saude operacional." },
];

type WorkspacePageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

function Placeholder({
  eyebrow,
  title,
  description,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <div className="space-y-5 rounded-2xl border border-slate-900 bg-slate-950/60 p-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{eyebrow}</p>
        <h2 className="mt-2 text-lg font-semibold text-slate-100">{title}</h2>
        <p className="mt-2 text-sm text-slate-400">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <div key={item} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
            {item}
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-dashed border-slate-800 p-4 text-sm text-slate-500">
        Modulo preparado para receber implementacao funcional nas proximas fases, ja conectado ao workspace real.
      </div>
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

  if (activeTab === "diagram") {
    return <DiagramScopeView connectionId={connectionId} />;
  }

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
        />
      ) : null}

      {activeTab === "explorer" ? (
        <Placeholder
          eyebrow="Workspace / Explorer"
          title="Explorer preparado para dados reais"
          description="A navegacao do workspace agora ja sustenta um explorer conectado ao metadata real da conexao."
          items={[
            "Area reservada para schemas, tabelas e colunas.",
            "Estado vazio padronizado para listas e detalhes.",
            "Espaco para busca incremental e atalhos por schema.",
            "Integracao natural com diagrama e editor nas proximas fases.",
          ]}
        />
      ) : null}

      {activeTab === "admin" ? (
        <Placeholder
          eyebrow="Workspace / Admin"
          title="Admin integrado ao contexto da conexao"
          description="O modulo administrativo agora ja nasce dentro de uma shell consistente, com espaco para auditoria e operacoes reais."
          items={[
            "Bloco para auditoria operacional da conexao.",
            "Espaco para jobs e tarefas futuras.",
            "Area para status de manutencao e eventos recentes.",
            "Base pronta para controles por usuario e permissoes.",
          ]}
        />
      ) : null}
    </div>
  );
}

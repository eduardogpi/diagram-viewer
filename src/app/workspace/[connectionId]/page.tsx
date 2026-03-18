import Link from "next/link";

import DiagramScopeView from "@/components/diagrams/DiagramScopeView";

const tabs = [
  { id: "editor", label: "Editor SQL", description: "Autocomplete, histórico e múltiplas abas" },
  { id: "explorer", label: "Explorer", description: "Schemas, tabelas e dados" },
  { id: "diagram", label: "Diagramas", description: "Layout por escopo com React Flow" },
  { id: "admin", label: "Admin", description: "Usuários, índices, backups" },
];

type WorkspacePageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function WorkspacePage({
  params,
  searchParams,
}: WorkspacePageProps) {
  const { connectionId } = await params;
  const resolvedSearchParams = await searchParams;
  const activeTab = resolvedSearchParams?.tab ?? "editor";
  const isDiagramTab = activeTab === "diagram";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={`/workspace/${connectionId}?tab=${tab.id}`}
            className={`rounded-xl border px-4 py-2 text-sm transition ${
              activeTab === tab.id
                ? "border-cyan-400 bg-cyan-400/10 text-cyan-200"
                : "border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <section
        className={`rounded-2xl border border-slate-900 bg-slate-950/60 ${isDiagramTab ? "p-2 md:p-3" : "p-6"}`}
      >
        {activeTab === "editor" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-100">Editor SQL</h2>
            <p className="text-sm text-slate-400">
              Monaco Editor com snippets, autocomplete baseado no schema e histórico sincronizado.
            </p>
            <div className="rounded-xl border border-cyan-900/40 bg-slate-900/80 p-4 font-mono text-sm text-cyan-200">
              <p>SELECT * FROM pedidos WHERE status = &lsquo;PENDENTE&rsquo; ORDER BY atualizado_em DESC;</p>
            </div>
          </div>
        )}

        {activeTab === "explorer" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-100">Schema Explorer</h2>
            <ul className="space-y-2 text-sm text-slate-300">
              <li>• Tabelas com filtros e busca incremental</li>
              <li>• Data grid virtualizado (TanStack) com edição inline</li>
              <li>• Acesso rápido a FKs e dados relacionados</li>
            </ul>
          </div>
        )}

        {activeTab === "diagram" && <DiagramScopeView connectionId={connectionId} />}

        {activeTab === "admin" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-100">Administração</h2>
            <ul className="space-y-2 text-sm text-slate-300">
              <li>• Gestão de usuários/roles com templates de permissões</li>
              <li>• Monitor com locks, sessões ativas e métricas de performance</li>
              <li>• Job center para backups lógicos e manutenção</li>
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

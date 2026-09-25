import Link from "next/link";

import { ThemeToggle } from "@/components/theme/ThemeToggle";

const concepts = [
  {
    title: "Conexões",
    body: "Cadastre MySQL/MariaDB, PostgreSQL ou uma conexão baseada em migrations (sem banco). O teste de conexão roda antes de salvar.",
  },
  {
    title: "Diagramas",
    body: "Visualize o schema com React Flow: filtros por escopo, layout TB/LR, fullscreen, snapshots nomeados, exportação JSON e FK manual por dois cliques.",
  },
  {
    title: "Explorer",
    body: "Navegue por schemas, tabelas, colunas, PKs/FKs e índices, veja preview de dados e abra a tabela no editor SQL ou no diagrama.",
  },
  {
    title: "Editor SQL",
    body: "Consultas somente leitura com limite de linhas, timeout, abas, favoritos, EXPLAIN, formatação e export CSV/JSON.",
  },
  {
    title: "Migrations",
    body: "Importe uma pasta de migrations (Flyway/SQL puro), navegue pela timeline de snapshots e veja o schema final.",
  },
  {
    title: "Modelagem IA",
    body: "Desenhe o schema conversando com uma LLM (Gemini/OpenRouter/NVIDIA), com edição manual, checkpoints e export para SQL/migrations.",
  },
  {
    title: "MCP",
    body: "Exponha a Modelagem IA como servidor MCP (stdio ou HTTP) para Claude Code, Codex ou Devin dirigirem sessões compartilhadas com a UI.",
  },
];

const shortcuts = [
  { keys: "Dois cliques no canvas (Diagramas)", action: "Cria uma FK manual entre duas tabelas." },
  { keys: "Duplo clique no nome da aba (Editor SQL)", action: "Renomeia a aba." },
  { keys: "Ctrl/⌘ + F (Diagramas)", action: "Busca com destaque no canvas." },
  { keys: "Esc (fullscreen do diagrama)", action: "Sai do modo fullscreen." },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen w-full bg-[var(--color-bg-canvas)] px-6 py-12 text-[var(--color-text-primary)]">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-[var(--color-accent)]">Ajuda</p>
            <h1 className="mt-1 text-3xl font-semibold">Como usar o Workbench</h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Um resumo dos módulos e dos atalhos disponíveis.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/"
              className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm transition hover:border-[var(--color-accent)]"
            >
              Voltar
            </Link>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {concepts.map((concept) => (
            <article
              key={concept.title}
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-5 shadow-[var(--shadow-floating)]"
            >
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{concept.title}</h2>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{concept.body}</p>
            </article>
          ))}
        </section>

        <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-5 shadow-[var(--shadow-floating)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Atalhos</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.keys} className="flex flex-col gap-1 border-b border-[var(--color-border-subtle)] pb-2 last:border-none sm:flex-row sm:items-center sm:justify-between">
                <span className="font-mono text-[var(--color-text-primary)]">{shortcut.keys}</span>
                <span className="text-[var(--color-text-secondary)]">{shortcut.action}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

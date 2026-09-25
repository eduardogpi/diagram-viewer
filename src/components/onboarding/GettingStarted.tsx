import Link from "next/link";

const steps = [
  {
    title: "1. Crie uma conexão",
    body: "Use um template ou preencha host, porta, database e credenciais. O teste de conexão roda antes de salvar.",
  },
  {
    title: "2. Gere o diagrama",
    body: "Abra o workspace e veja o schema real com filtros por escopo, layout e snapshots.",
  },
  {
    title: "3. Explore e consulte",
    body: "Navegue por tabelas e índices no Explorer e rode consultas somente leitura no Editor SQL.",
  },
  {
    title: "4. Modele com IA",
    body: "Sem banco ativo? Descreva o schema em linguagem natural e desenhe junto com uma LLM.",
  },
];

export default function GettingStarted() {
  return (
    <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/70 p-6 shadow-[var(--shadow-floating)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">Comece por aqui</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">Primeiros passos</h2>
        </div>
        <Link href="/help" className="text-sm font-semibold text-[var(--color-accent)] hover:underline">
          Ver ajuda e atalhos →
        </Link>
      </div>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <li key={step.title} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] p-4">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{step.title}</p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

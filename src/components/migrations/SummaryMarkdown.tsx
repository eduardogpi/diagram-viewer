"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Mapeamento dos elementos Markdown para o visual do workbench. Não usamos o plugin
 * `@tailwindcss/typography` porque o tema do projeto é feito com CSS variables (claro/escuro),
 * e as cores do `prose` não acompanhariam.
 *
 * `react-markdown` renderiza para elementos React (não usa innerHTML), então HTML cru no texto
 * da LLM já é escapado por padrão — não precisa de sanitização extra.
 */
const components: Components = {
  h1: ({ children }) => (
    <h3 className="mb-1.5 mt-4 text-sm font-semibold text-[var(--color-text-primary)] first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h4 className="mb-1.5 mt-3.5 text-[13px] font-semibold text-[var(--color-text-primary)] first:mt-0">{children}</h4>
  ),
  h3: ({ children }) => (
    <h5 className="mb-1 mt-3 text-xs font-semibold text-[var(--color-text-primary)] first:mt-0">{children}</h5>
  ),
  h4: ({ children }) => (
    <h6 className="mb-1 mt-2.5 text-xs font-semibold text-[var(--color-text-primary)] first:mt-0">{children}</h6>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="marker:text-[var(--color-text-muted)]">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-[var(--color-text-primary)]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--color-accent)] underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-[var(--color-border-strong)] pl-3 text-[var(--color-text-muted)] last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[var(--color-border-subtle)]" />,
  // O código inline vira "pílula"; dentro de <pre> o container neutraliza (ver wrapper abaixo).
  code: ({ children }) => (
    <code className="rounded bg-[var(--color-panel-raised)] px-1 py-0.5 font-mono text-[11px] text-[var(--color-text-primary)]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] p-2.5 text-[11px] leading-relaxed last:mb-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--color-border-subtle)] bg-[var(--color-panel-muted)] px-2 py-1 text-left font-semibold text-[var(--color-text-primary)]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--color-border-subtle)] px-2 py-1 align-top">{children}</td>
  ),
};

export default function SummaryMarkdown({ source }: { source: string }) {
  return (
    <div className="[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

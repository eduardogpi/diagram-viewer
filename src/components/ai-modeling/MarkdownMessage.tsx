"use client";

import { Check, Copy } from "lucide-react";
import React, { useState } from "react";

type Props = {
  content: string;
  className?: string;
};

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/90">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/70 px-2.5 py-1 text-[10px] text-[var(--color-text-muted)]">
        <span className="font-mono uppercase">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-layer-1)] hover:text-[var(--color-accent)]"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copiar
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed text-[var(--color-text-primary)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Renderiza formatação inline segura (`code`, **bold**, *italic*) sem dangerouslySetInnerHTML.
 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Tokeniza `inline code`, **bold** e *italic*
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`inline-${key++}`}
          className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/80 px-1 py-0.5 font-mono text-[11px] text-[var(--color-accent)]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`inline-${key++}`} className="font-semibold text-[var(--color-text-primary)]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={`inline-${key++}`} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else {
      nodes.push(token);
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.split("|").length >= 3;
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!isTableRow(trimmed)) return false;
  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

function renderTextBlocks(blockText: string, blockSeed: number): React.ReactNode[] {
  const lines = blockText.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      elements.push(
        <hr key={`hr-${blockSeed}-${i}`} className="my-2 border-[var(--color-border-subtle)]" />
      );
      i++;
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInline(headingMatch[2]);
      const cls =
        level === 1
          ? "mt-2.5 mb-1 text-sm font-bold text-[var(--color-text-primary)]"
          : level === 2
            ? "mt-2 mb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-accent)]"
            : "mt-1.5 mb-0.5 text-xs font-semibold text-[var(--color-text-primary)]";
      elements.push(
        <div key={`h-${blockSeed}-${i}`} className={cls}>
          {content}
        </div>
      );
      i++;
      continue;
    }

    // Markdown table
    if (i + 1 < lines.length && isTableRow(line) && isTableSeparator(lines[i + 1])) {
      const headers = parseTableCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableCells(lines[i]));
        i++;
      }
      elements.push(
        <div
          key={`tbl-${blockSeed}-${i}`}
          className="my-2 overflow-x-auto rounded-lg border border-[var(--color-border-subtle)]"
        >
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/80 text-[var(--color-text-secondary)]">
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="px-2.5 py-1.5 font-semibold">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {rows.map((r, rIdx) => (
                <tr key={rIdx} className="bg-[var(--color-bg-layer-1)]/40">
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="px-2.5 py-1.5 text-[var(--color-text-primary)]">
                      {renderInline(r[cIdx] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      elements.push(
        <blockquote
          key={`q-${blockSeed}-${i}`}
          className="my-1.5 border-l-2 border-[var(--color-accent)] bg-[var(--color-bg-layer-2)]/50 py-1 pl-2.5 pr-2 text-[11px] italic text-[var(--color-text-secondary)]"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx}>{renderInline(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${blockSeed}-${i}`} className="my-1.5 list-disc space-y-1 pl-4">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${blockSeed}-${i}`} className="my-1.5 list-decimal space-y-1 pl-4">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Regular paragraph (consume consecutive regular lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4}\s+|[-*•]\s+|\d+\.\s+|>\s?|(-{3,}|\*{3,})$)/.test(lines[i].trim()) &&
      !(i + 1 < lines.length && isTableRow(lines[i]) && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    elements.push(
      <p key={`p-${blockSeed}-${i}`} className="my-1 leading-relaxed whitespace-pre-wrap">
        {renderInline(paraLines.join("\n"))}
      </p>
    );
  }

  return elements;
}

export default function MarkdownMessage({ content, className = "" }: Props) {
  // Divide em blocos de código cercados (```lang ... ```) e blocos de texto normal
  const segments: React.ReactNode[] = [];
  const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let blockIdx = 0;

  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textChunk = content.slice(lastIndex, match.index);
      segments.push(...renderTextBlocks(textChunk, blockIdx++));
    }
    const language = match[1] || "sql";
    const code = match[2].replace(/\n$/, "");
    segments.push(<CodeBlock key={`code-${blockIdx++}`} language={language} code={code} />);
    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    segments.push(...renderTextBlocks(remaining, blockIdx++));
  }

  return <div className={`space-y-1 ${className}`}>{segments}</div>;
}

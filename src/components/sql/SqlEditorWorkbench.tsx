"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  connectionId: string;
  connectionName: string;
  databaseName: string;
  provider: string;
};

type QueryResult = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
};

type QueryHistoryItem = {
  id: string;
  action: string;
  createdAt: string;
  sql: string;
  durationMs: number | null;
  rowCount: number | null;
  error: string | null;
};

const SNIPPETS = [
  {
    id: "tables",
    label: "Listar tabelas",
    sql: "SHOW TABLES",
  },
  {
    id: "columns",
    label: "Information schema",
    sql: `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE\nFROM INFORMATION_SCHEMA.COLUMNS\nWHERE TABLE_SCHEMA = DATABASE()\nORDER BY TABLE_NAME, ORDINAL_POSITION\nLIMIT 200`,
  },
  {
    id: "preview",
    label: "Preview generico",
    sql: "SELECT *\nFROM nome_da_tabela\nLIMIT 100",
  },
];

export default function SqlEditorWorkbench({
  connectionId,
  connectionName,
  databaseName,
  provider,
}: Props) {
  const [sql, setSql] = useState(SNIPPETS[0].sql);
  const [rowLimit, setRowLimit] = useState(200);
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      const response = await fetch(`/api/sql/query/${connectionId}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as QueryHistoryItem[];
      if (!cancelled) {
        setHistory(payload);
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const previewRows = useMemo(() => result?.rows ?? [], [result]);

  async function runQuery() {
    setStatus("loading");
    setMessage(null);

    try {
      const response = await fetch(`/api/sql/query/${connectionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql, rowLimit }),
      });

      const payload = (await response.json()) as QueryResult | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Falha ao executar consulta.");
      }

      setResult(payload);
      setStatus("idle");
      setMessage(`Consulta executada em ${payload.durationMs} ms.`);

      const historyResponse = await fetch(`/api/sql/query/${connectionId}`, { cache: "no-store" });
      if (historyResponse.ok) {
        setHistory((await historyResponse.json()) as QueryHistoryItem[]);
      }
    } catch (error) {
      setStatus("error");
      setResult(null);
      setMessage(error instanceof Error ? error.message : "Falha ao executar consulta.");
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
      <section className="space-y-5 rounded-3xl border border-slate-900 bg-slate-950/60 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Workspace / Editor</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-100">Editor SQL operacional</h2>
            <p className="mt-2 text-sm text-slate-400">
              Execucao somente leitura com limite de linhas, timeout e historico por conexao.
            </p>
          </div>
          <div className="grid gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-400">
            <span>Conexao: {connectionName}</span>
            <span>Database: {databaseName}</span>
            <span>Provider: {provider}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {SNIPPETS.map((snippet) => (
            <button
              key={snippet.id}
              onClick={() => setSql(snippet.sql)}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-600 hover:text-white"
            >
              {snippet.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <textarea
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            spellCheck={false}
            className="min-h-[300px] w-full rounded-3xl border border-slate-800 bg-[#07111c] px-4 py-4 font-mono text-sm leading-6 text-slate-100 outline-none transition focus:border-cyan-400/40"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                <span>Limite</span>
                <select
                  value={rowLimit}
                  onChange={(event) => setRowLimit(Number(event.target.value))}
                  className="bg-transparent text-slate-100 outline-none"
                >
                  {[50, 100, 200, 500].map((value) => (
                    <option key={value} value={value} className="bg-slate-950">
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-slate-500">
                Leitura apenas: `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN` e `WITH`.
              </span>
            </div>

            <button
              onClick={runQuery}
              disabled={status === "loading"}
              className="rounded-2xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "loading" ? "Executando..." : "Executar consulta"}
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-900 bg-slate-950/70">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-900 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-100">Resultado</p>
              <p className="mt-1 text-xs text-slate-500">
                {message ?? "Execute uma consulta para ver o resultado tabular."}
              </p>
            </div>
            {result ? (
              <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                <span className="rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1">
                  {result.rowCount} linhas
                </span>
                <span className="rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1">
                  {result.durationMs} ms
                </span>
              </div>
            ) : null}
          </div>

          {status === "error" ? (
            <div className="px-5 py-6 text-sm text-red-200">{message}</div>
          ) : result ? (
            <div className="overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-900/70 text-xs uppercase tracking-[0.2em] text-slate-500">
                  <tr>
                    {result.columns.map((column) => (
                      <th key={column} className="px-4 py-3 font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={`${index}-${Object.values(row).join("-")}`} className="border-t border-slate-900 text-slate-200">
                      {result.columns.map((column) => (
                        <td key={`${index}-${column}`} className="max-w-[280px] truncate px-4 py-3 align-top">
                          {renderCellValue(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 py-10 text-sm text-slate-500">
              O resultado vai aparecer aqui com colunas, linhas e tempo de execucao.
            </div>
          )}

          {result?.truncated ? (
            <div className="border-t border-slate-900 px-5 py-3 text-xs text-amber-300">
              O resultado pode estar truncado pelo limite configurado para esta execucao.
            </div>
          ) : null}
        </div>
      </section>

      <aside className="space-y-5">
        <section className="rounded-3xl border border-slate-900 bg-slate-950/60 p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Guardrails</p>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
              Apenas uma consulta por vez.
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
              Somente leitura nesta fase, sem `UPDATE`, `DELETE`, `DROP` ou `ALTER`.
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
              Timeout e limite de linhas aplicados no backend.
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-900 bg-slate-950/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Historico</p>
              <h3 className="mt-2 text-sm font-semibold text-slate-100">Ultimas consultas</h3>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 p-4 text-sm text-slate-500">
                Ainda nao ha consultas registradas para esta conexao.
              </div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSql(item.sql)}
                  className="w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-left transition hover:border-slate-700 hover:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-3 font-mono text-xs text-slate-200">{item.sql}</p>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        item.action === "SQL_QUERY_SUCCEEDED"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : "bg-red-500/10 text-red-300"
                      }`}
                    >
                      {item.action === "SQL_QUERY_SUCCEEDED" ? "ok" : "erro"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                    <span>{new Date(item.createdAt).toLocaleString("pt-BR")}</span>
                    {item.durationMs !== null ? <span>{item.durationMs} ms</span> : null}
                    {item.rowCount !== null ? <span>{item.rowCount} linhas</span> : null}
                  </div>
                  {item.error ? <p className="mt-2 text-xs text-red-300">{item.error}</p> : null}
                </button>
              ))
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function renderCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="text-slate-500">null</span>;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

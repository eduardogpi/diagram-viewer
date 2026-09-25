"use client";

import { Download, Play, Plus, Save, Star, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";

import { downloadText, formatSql, toCsv } from "@/lib/sql/editor-utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type Props = {
  connectionId: string;
  connectionName: string;
  databaseName: string;
  provider: string;
  initialSql?: string;
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

type Tab = { id: string; name: string; sql: string };
type Favorite = { id: string; name: string; sql: string };

const PAGE_SIZE = 50;
const FAVORITES_KEY = (connectionId: string) => `sql-favorites:${connectionId}`;

function getSnippets(provider: string) {
  const isPostgres = provider.toUpperCase().includes("POSTGRES");
  if (isPostgres) {
    return [
      {
        id: "tables",
        label: "Listar tabelas",
        sql: `SELECT table_name\nFROM information_schema.tables\nWHERE table_schema = current_schema()\nORDER BY table_name`,
      },
      {
        id: "columns",
        label: "Information schema",
        sql: `SELECT table_name, column_name, data_type\nFROM information_schema.columns\nWHERE table_schema = current_schema()\nORDER BY table_name, ordinal_position\nLIMIT 200`,
      },
      {
        id: "preview",
        label: "Preview genérico",
        sql: "SELECT *\nFROM nome_da_tabela\nLIMIT 100",
      },
    ];
  }

  return [
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
      label: "Preview genérico",
      sql: "SELECT *\nFROM nome_da_tabela\nLIMIT 100",
    },
  ];
}

function newTab(sql: string, name: string): Tab {
  return { id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, sql };
}

export default function SqlEditorWorkbench({
  connectionId,
  connectionName,
  databaseName,
  provider,
  initialSql,
}: Props) {
  const snippets = useMemo(() => getSnippets(provider), [provider]);
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(initialSql ?? snippets[0].sql, "Consulta 1")]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");
  const [rowLimit, setRowLimit] = useState(200);
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [completionWords, setCompletionWords] = useState<string[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const completionDisposable = useRef<{ dispose(): void } | null>(null);
  const completionWordsRef = useRef<string[]>([]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const sql = activeTab?.sql ?? "";

  const setSql = useCallback(
    (value: string) => {
      setTabs((current) => current.map((tab) => (tab.id === activeTabId ? { ...tab, sql: value } : tab)));
    },
    [activeTabId]
  );

  useEffect(() => {
    completionWordsRef.current = completionWords;
  }, [completionWords]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      const response = await fetch(`/api/sql/query/${connectionId}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as QueryHistoryItem[];
      if (!cancelled) setHistory(payload);
    }

    async function loadCompletionWords() {
      try {
        const response = await fetch(`/api/explorer/${connectionId}`, { cache: "no-store" });
        if (!response.ok) return;
        const catalog = (await response.json()) as { tables: Array<{ name: string; columns: Array<{ name: string }> }> };
        const words = new Set<string>();
        for (const table of catalog.tables ?? []) {
          words.add(table.name);
          for (const column of table.columns ?? []) words.add(column.name);
        }
        if (!cancelled) setCompletionWords(Array.from(words));
      } catch {
        // autocomplete é best-effort
      }
    }

    void loadHistory();
    void loadCompletionWords();

    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FAVORITES_KEY(connectionId));
      if (stored) setFavorites(JSON.parse(stored) as Favorite[]);
    } catch {
      // localStorage indisponível
    }
  }, [connectionId]);

  const persistFavorites = useCallback(
    (next: Favorite[]) => {
      setFavorites(next);
      try {
        window.localStorage.setItem(FAVORITES_KEY(connectionId), JSON.stringify(next));
      } catch {
        // ignora
      }
    },
    [connectionId]
  );

  async function refreshHistory() {
    const response = await fetch(`/api/sql/query/${connectionId}`, { cache: "no-store" });
    if (response.ok) setHistory((await response.json()) as QueryHistoryItem[]);
  }

  async function runQuery(sqlOverride?: string) {
    const query = sqlOverride ?? sql;
    if (!query.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    setMessage(null);
    setPage(0);

    try {
      const response = await fetch(`/api/sql/query/${connectionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: query, rowLimit }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as QueryResult | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Falha ao executar consulta.");
      }

      setResult(payload);
      setStatus("idle");
      setMessage(`Consulta executada em ${payload.durationMs} ms.`);
      await refreshHistory();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("idle");
        setMessage("Consulta cancelada.");
        return;
      }
      setStatus("error");
      setResult(null);
      setMessage(error instanceof Error ? error.message : "Falha ao executar consulta.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function cancelQuery() {
    abortRef.current?.abort();
  }

  function addTab() {
    const tab = newTab("SELECT 1", `Consulta ${tabs.length + 1}`);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(tabId: string) {
    setTabs((current) => {
      if (current.length === 1) return current;
      const next = current.filter((tab) => tab.id !== tabId);
      if (tabId === activeTabId) setActiveTabId(next[0].id);
      return next;
    });
  }

  function renameTab(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const name = window.prompt("Nome da aba", tab.name);
    if (!name) return;
    setTabs((current) => current.map((t) => (t.id === tabId ? { ...t, name } : t)));
  }

  function saveFavorite() {
    const name = window.prompt("Nome do favorito", activeTab?.name ?? "Consulta");
    if (!name) return;
    persistFavorites([...favorites, { id: `fav-${Date.now()}`, name, sql }]);
  }

  function removeFavorite(id: string) {
    persistFavorites(favorites.filter((favorite) => favorite.id !== id));
  }

  const handleEditorMount = useCallback<NonNullable<ComponentProps<typeof MonacoEditor>["onMount"]>>(
    (_editor, monaco) => {
      completionDisposable.current?.dispose();
      completionDisposable.current = monaco.languages.registerCompletionItemProvider("sql", {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const suggestions = completionWordsRef.current.map((text) => ({
            label: text,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: text,
            range,
          }));
          return { suggestions };
        },
      });
    },
    []
  );

  useEffect(() => () => completionDisposable.current?.dispose(), []);

  const pageRows = useMemo(() => {
    if (!result) return [];
    return result.rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  }, [result, page]);
  const pageCount = result ? Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE)) : 1;

  function exportResult(kind: "csv" | "json") {
    if (!result) return;
    if (kind === "csv") {
      downloadText(`consulta-${Date.now()}.csv`, toCsv(result.columns, result.rows), "text/csv;charset=utf-8");
    } else {
      downloadText(`consulta-${Date.now()}.json`, JSON.stringify(result.rows, null, 2), "application/json");
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
      <section className="space-y-5 rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] p-6 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-text-muted)]">Workspace / Editor</p>
            <h2 className="mt-2 text-xl font-semibold">Editor SQL operacional</h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Execução somente leitura com limite de linhas, timeout, abas e histórico por conexão.
            </p>
          </div>
          <div className="grid gap-1 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
            <span>Conexão: {connectionName}</span>
            <span>Database: {databaseName}</span>
            <span>Provider: {provider}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                tab.id === activeTabId
                  ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-text-primary)]"
                  : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
              }`}
            >
              <button type="button" onClick={() => setActiveTabId(tab.id)} onDoubleClick={() => renameTab(tab.id)}>
                {tab.name}
              </button>
              {tabs.length > 1 ? (
                <button type="button" onClick={() => closeTab(tab.id)} title="Fechar aba" className="text-[var(--color-text-muted)] hover:text-red-400">
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={addTab}
            title="Nova aba"
            className="rounded-lg border border-dashed border-[var(--color-border-subtle)] p-1.5 text-[var(--color-text-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {snippets.map((snippet) => (
            <button
              key={snippet.id}
              onClick={() => setSql(snippet.sql)}
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-bg-layer-2)_92%,var(--color-accent)_8%)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]"
            >
              {snippet.label}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-3xl border border-[var(--color-border-subtle)]">
          <MonacoEditor
            height="320px"
            language="sql"
            theme="vs-dark"
            value={sql}
            onChange={(value) => setSql(value ?? "")}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
              <span>Limite</span>
              <select
                value={rowLimit}
                onChange={(event) => setRowLimit(Number(event.target.value))}
                className="bg-transparent text-[var(--color-text-primary)] outline-none"
              >
                {[50, 100, 200, 500].map((value) => (
                  <option key={value} value={value} className="bg-[var(--color-bg-layer-1)] text-[var(--color-text-primary)]">
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-[var(--color-text-muted)]">
              Leitura apenas: `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN` e `WITH`.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSql(formatSql(sql))}
              className="rounded-2xl border border-[var(--color-border-subtle)] px-4 py-2.5 text-sm text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]"
            >
              Formatar
            </button>
            <button
              type="button"
              onClick={() => void runQuery(`EXPLAIN ${sql}`)}
              disabled={status === "loading" || !sql.trim()}
              className="rounded-2xl border border-[var(--color-border-subtle)] px-4 py-2.5 text-sm text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              EXPLAIN
            </button>
            <button
              type="button"
              onClick={saveFavorite}
              className="flex items-center gap-1.5 rounded-2xl border border-[var(--color-border-subtle)] px-4 py-2.5 text-sm text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]"
            >
              <Star className="h-3.5 w-3.5" /> Favoritar
            </button>
            {status === "loading" ? (
              <button
                type="button"
                onClick={cancelQuery}
                className="rounded-2xl border border-red-500/50 px-4 py-2.5 text-sm text-red-400 transition hover:border-red-400"
              >
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void runQuery()}
                disabled={!sql.trim()}
                className="flex items-center gap-2 rounded-2xl bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="h-4 w-4" />
                Executar consulta
              </button>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Resultado</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {message ?? "Execute uma consulta para ver o resultado tabular."}
              </p>
            </div>
            {result ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-3 py-1">
                  {result.rowCount} linhas
                </span>
                <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-3 py-1">
                  {result.durationMs} ms
                </span>
                <button
                  type="button"
                  onClick={() => exportResult("csv")}
                  className="flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-3 py-1 transition hover:border-[var(--color-accent)]"
                >
                  <Download className="h-3 w-3" /> CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportResult("json")}
                  className="flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-3 py-1 transition hover:border-[var(--color-accent)]"
                >
                  <Download className="h-3 w-3" /> JSON
                </button>
              </div>
            ) : null}
          </div>

          {status === "error" ? (
            <div className="px-5 py-6 text-sm text-red-500">{message}</div>
          ) : result ? (
            <>
              <div className="overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[var(--color-bg-layer-1)] text-xs uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column} className="px-4 py-3 font-medium">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, index) => (
                      <tr
                        key={`${page}-${index}`}
                        className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                      >
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

              {pageCount > 1 ? (
                <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-5 py-3 text-xs text-[var(--color-text-secondary)]">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1 disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span>
                    Página {page + 1} de {pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={page >= pageCount - 1}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1 disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">
              O resultado vai aparecer aqui com colunas, linhas e tempo de execução.
            </div>
          )}

          {result?.truncated ? (
            <div className="border-t border-[var(--color-border-subtle)] px-5 py-3 text-xs text-[var(--color-warning)]">
              O resultado pode estar truncado pelo limite configurado para esta execução.
            </div>
          ) : null}
        </div>
      </section>

      <aside className="space-y-5">
        {favorites.length > 0 ? (
          <section className="rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] p-5 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-text-muted)]">Favoritas</p>
            <div className="mt-4 space-y-2">
              {favorites.map((favorite) => (
                <div key={favorite.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSql(favorite.sql)}
                    className="flex-1 truncate rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-left text-xs transition hover:border-[var(--color-accent)]"
                    title={favorite.sql}
                  >
                    <Save className="mr-1.5 inline h-3 w-3" />
                    {favorite.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFavorite(favorite.id)}
                    title="Remover favorito"
                    className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-2 text-xs text-[var(--color-text-muted)] transition hover:border-rose-400 hover:text-rose-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] p-5 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-text-muted)]">Guardrails</p>
          <div className="mt-4 space-y-3 text-sm text-[var(--color-text-secondary)]">
            <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] p-3">
              Apenas uma consulta por vez.
            </div>
            <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] p-3">
              Somente leitura nesta fase, sem `UPDATE`, `DELETE`, `DROP` ou `ALTER`.
            </div>
            <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] p-3">
              Timeout e limite de linhas aplicados no backend.
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] p-5 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-text-muted)]">Histórico</p>
              <h3 className="mt-2 text-sm font-semibold">Últimas consultas</h3>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--color-border-subtle)] p-4 text-sm text-[var(--color-text-muted)]">
                Ainda não há consultas registradas para esta conexão.
              </div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSql(item.sql)}
                  className="w-full rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] p-4 text-left transition hover:border-[var(--color-accent)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-3 font-mono text-xs text-[var(--color-text-primary)]">{item.sql}</p>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        item.action === "SQL_QUERY_SUCCEEDED"
                          ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                          : "bg-red-500/10 text-red-500"
                      }`}
                    >
                      {item.action === "SQL_QUERY_SUCCEEDED" ? "ok" : "erro"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-text-muted)]">
                    <span>{new Date(item.createdAt).toLocaleString("pt-BR")}</span>
                    {item.durationMs !== null ? <span>{item.durationMs} ms</span> : null}
                    {item.rowCount !== null ? <span>{item.rowCount} linhas</span> : null}
                  </div>
                  {item.error ? <p className="mt-2 text-xs text-red-500">{item.error}</p> : null}
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

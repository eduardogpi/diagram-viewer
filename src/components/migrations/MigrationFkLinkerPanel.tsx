"use client";

import { ArrowRight, Check, Copy, Filter, Link2, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LLM_PROVIDER_LABELS, useLlmModels, type LlmModelInfo } from "@/lib/hooks/useLlmModels";
import {
  suggestHeuristicForeignKeys,
  type AddFkInput,
  type ForeignKeySuggestion,
} from "@/lib/services/migration-fks";
import type { DiagramNodeDTO, DiagramResponse, DiagramScopeDTO } from "@/lib/types/diagram";

const SCOPE_COLORS = ["#22d3ee", "#34d399", "#f97316", "#facc15", "#fb7185", "#a78bfa"];

function colorFor(scopeId: string) {
  const index = Array.from(scopeId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % SCOPE_COLORS.length;
  const color = SCOPE_COLORS[index];
  return { color, border: `${color}88`, fill: `${color}18` };
}

function humanizeScope(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function isSystemControlTable(node: DiagramNodeDTO): boolean {
  const lower = node.label.toLowerCase();
  return (
    lower === "flyway_schema_history" ||
    lower === "schema_version" ||
    lower.endsWith("_dadossys") ||
    lower === "dadossys"
  );
}

function modelKey(m: Pick<LlmModelInfo, "provider" | "id">): string {
  return `${m.provider}::${m.id}`;
}

type Props = {
  connectionId: string;
  packageId: string;
  currentOrder: number;
  fileCount: number;
  diagram: DiagramResponse;
  onPreviewFksChange: (fks: AddFkInput[]) => void;
  onPackageUpdated: () => Promise<void>;
};

export default function MigrationFkLinkerPanel({
  connectionId,
  packageId,
  currentOrder,
  fileCount,
  diagram,
  onPreviewFksChange,
  onPackageUpdated,
}: Props) {
  const { models, loading: loadingModels } = useLlmModels();
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const effectiveModelKey = selectedModelKey || (models[0] ? modelKey(models[0]) : "");

  const groupedModels = useMemo(() => {
    const groups = new Map<string, LlmModelInfo[]>();
    for (const m of models) {
      if (!groups.has(m.provider)) groups.set(m.provider, []);
      groups.get(m.provider)!.push(m);
    }
    return Array.from(groups.entries());
  }, [models]);

  // Oculta por padrão tabelas de controle de versão (ex: *_DADOSSYS, flyway_schema_history) e tabelas sem colunas
  const [hideControlTables, setHideControlTables] = useState(true);
  // Conjunto de escopos selecionados nos chips (vazio = Todos os escopos ativos)
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [srcFilterText, setSrcFilterText] = useState("");
  const [tgtFilterText, setTgtFilterText] = useState("");

  // Nós válidos (com pelo menos 1 coluna e respeitando o filtro de tabelas de controle)
  const baseNodes = useMemo(() => {
    return diagram.nodes
      .filter((n) => n.columns.length > 0 && (!hideControlTables || !isSystemControlTable(n)))
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
  }, [diagram.nodes, hideControlTables]);

  // Chips de escopo calculados sobre baseNodes (igual ao ReactFlow)
  const scopes = useMemo<DiagramScopeDTO[]>(() => {
    const counts = new Map<string, number>();
    for (const node of baseNodes) {
      counts.set(node.scope, (counts.get(node.scope) ?? 0) + 1);
    }
    const labelMap = new Map(diagram.scopes.map((s) => [s.id, s]));
    const result: DiagramScopeDTO[] = [];
    for (const [scopeId, tables] of counts.entries()) {
      const meta = labelMap.get(scopeId);
      result.push({
        id: scopeId,
        label: meta?.label ?? humanizeScope(scopeId),
        description: meta?.description ?? `Módulo ${humanizeScope(scopeId)}`,
        tables,
      });
    }
    return result;
  }, [baseNodes, diagram.scopes]);

  const scopeLabelMap = useMemo(() => new Map(scopes.map((s) => [s.id, s.label])), [scopes]);

  // Limpa escopos selecionados que deixaram de existir
  useEffect(() => {
    setSelectedScopes((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(scopes.map((s) => s.id));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [scopes]);

  const toggleScopeChip = useCallback((scopeId: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scopeId)) next.delete(scopeId);
      else next.add(scopeId);
      return next;
    });
  }, []);

  // Nós visíveis após aplicar o filtro de chips de escopo
  const scopeFilteredNodes = useMemo(() => {
    if (selectedScopes.size === 0) return baseNodes;
    return baseNodes.filter((n) => selectedScopes.has(n.scope));
  }, [baseNodes, selectedScopes]);

  const srcNodes = useMemo(() => {
    const q = srcFilterText.trim().toLowerCase();
    if (!q) return scopeFilteredNodes;
    return scopeFilteredNodes.filter((n) => n.label.toLowerCase().includes(q));
  }, [scopeFilteredNodes, srcFilterText]);

  const tgtNodes = useMemo(() => {
    const q = tgtFilterText.trim().toLowerCase();
    if (!q) return scopeFilteredNodes;
    return scopeFilteredNodes.filter((n) => n.label.toLowerCase().includes(q));
  }, [scopeFilteredNodes, tgtFilterText]);

  const groupNodesByScope = useCallback(
    (nodes: DiagramNodeDTO[]) => {
      const map = new Map<string, DiagramNodeDTO[]>();
      for (const n of nodes) {
        if (!map.has(n.scope)) map.set(n.scope, []);
        map.get(n.scope)!.push(n);
      }
      return Array.from(map.entries()).map(([scopeId, list]) => ({
        scopeId,
        scopeLabel: scopeLabelMap.get(scopeId) ?? humanizeScope(scopeId),
        nodes: list,
      }));
    },
    [scopeLabelMap]
  );

  const srcGroups = useMemo(() => groupNodesByScope(srcNodes), [groupNodesByScope, srcNodes]);
  const tgtGroups = useMemo(() => groupNodesByScope(tgtNodes), [groupNodesByScope, tgtNodes]);

  // Estado de ligação manual
  const [srcTable, setSrcTable] = useState<string>("");
  const [srcCol, setSrcCol] = useState<string>("");
  const [tgtTable, setTgtTable] = useState<string>("");
  const [tgtCol, setTgtCol] = useState<string>("");
  const [onDelete, setOnDelete] = useState<string>("");
  const [manualFks, setManualFks] = useState<AddFkInput[]>([]);

  // Sugestões (heurística instantânea + IA sob demanda)
  const heuristicSuggestions = useMemo(() => suggestHeuristicForeignKeys(diagram), [diagram]);
  const [aiSuggestions, setAiSuggestions] = useState<ForeignKeySuggestion[]>([]);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [promptHint, setPromptHint] = useState("");

  const nodeById = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram.nodes]);

  const allSuggestions = useMemo(() => {
    const map = new Map<string, ForeignKeySuggestion>();
    for (const s of heuristicSuggestions) map.set(`${s.table}.${s.column}`, s);
    for (const s of aiSuggestions) map.set(`${s.table}.${s.column}`, s);
    return Array.from(map.values());
  }, [heuristicSuggestions, aiSuggestions]);

  // Filtra também as sugestões exibidas pelos chips de escopo ativos (se houver chip selecionado)
  const visibleSuggestions = useMemo(() => {
    if (selectedScopes.size === 0) return allSuggestions;
    return allSuggestions.filter((s) => {
      const srcScope = nodeById.get(s.table)?.scope;
      const tgtScope = nodeById.get(s.referencesTable)?.scope;
      return (srcScope && selectedScopes.has(srcScope)) || (tgtScope && selectedScopes.has(tgtScope));
    });
  }, [allSuggestions, selectedScopes, nodeById]);

  const [checkedSuggestionIds, setCheckedSuggestionIds] = useState<Set<string>>(new Set());

  // Ao abrir ou trocar de diagrama, pré-seleciona as sugestões heurísticas
  useEffect(() => {
    setCheckedSuggestionIds(new Set(heuristicSuggestions.map((s) => s.id)));
  }, [heuristicSuggestions]);

  // Inicializa e mantém defaults dos selects manuais sincronizados com as tabelas filtradas
  useEffect(() => {
    if (srcNodes.length > 0 && (!srcTable || !srcNodes.some((n) => n.id === srcTable))) {
      const first = srcNodes[0];
      setSrcTable(first.id);
      const nonPkCol = first.columns.find((c) => !c.isPrimary) ?? first.columns[0];
      setSrcCol(nonPkCol?.name ?? "");
    }
  }, [srcNodes, srcTable]);

  useEffect(() => {
    if (tgtNodes.length > 0 && (!tgtTable || !tgtNodes.some((n) => n.id === tgtTable))) {
      const second = tgtNodes.find((n) => n.id !== srcTable) ?? tgtNodes[0];
      setTgtTable(second.id);
      const pk = second.columns.find((c) => c.isPrimary) ?? second.columns[0];
      setTgtCol(pk?.name ?? "");
    }
  }, [tgtNodes, tgtTable, srcTable]);

  const srcTableObj = useMemo(
    () => diagram.nodes.find((n) => n.id === srcTable),
    [diagram.nodes, srcTable]
  );
  const tgtTableObj = useMemo(
    () => diagram.nodes.find((n) => n.id === tgtTable),
    [diagram.nodes, tgtTable]
  );

  // Ordena as colunas de destino colocando PKs no topo
  const sortedTgtColumns = useMemo(() => {
    const cols = tgtTableObj?.columns ?? [];
    return cols.slice().sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR", { numeric: true });
    });
  }, [tgtTableObj]);

  // Ao escolher uma coluna de origem (ex: bloco_id ou id_estado), tenta pré-selecionar automaticamente a tabela destino correspondente
  const handleSelectSrcColumn = useCallback(
    (colName: string) => {
      setSrcCol(colName);
      const lower = colName.toLowerCase();
      const stem = lower.endsWith("_id")
        ? lower.slice(0, -3)
        : lower.startsWith("id_")
          ? lower.slice(3)
          : lower.startsWith("fk_")
            ? lower.slice(3)
            : "";
      if (!stem || stem.length < 2) return;
      const candidate = tgtNodes.find((n) => {
        if (n.id === srcTable) return false;
        const tbl = n.label.toLowerCase();
        return tbl === stem || tbl === `${stem}s` || tbl.endsWith(`_${stem}`) || tbl.endsWith(`_${stem}s`);
      });
      if (candidate) {
        setTgtTable(candidate.id);
        const pk = candidate.columns.find((c) => c.isPrimary) ?? candidate.columns[0];
        setTgtCol(pk?.name ?? "");
      }
    },
    [tgtNodes, srcTable]
  );

  const formatNodeLabel = useCallback(
    (tableId: string) => {
      const node = nodeById.get(tableId);
      if (!node) return tableId;
      return node.label;
    },
    [nodeById]
  );

  // Combina FKs manuais + sugestões marcadas e avisa o pai para desenhar no diagrama em tempo real
  const activeFks = useMemo<AddFkInput[]>(() => {
    const list: AddFkInput[] = [...manualFks];
    const seen = new Set(manualFks.map((f) => `${f.table}.${f.column}`));
    for (const s of allSuggestions) {
      if (!checkedSuggestionIds.has(s.id)) continue;
      const key = `${s.table}.${s.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        table: s.table,
        column: s.column,
        referencesTable: s.referencesTable,
        referencesColumn: s.referencesColumn,
      });
    }
    return list;
  }, [manualFks, allSuggestions, checkedSuggestionIds]);

  const [previewInDiagram, setPreviewInDiagram] = useState(true);

  useEffect(() => {
    onPreviewFksChange(previewInDiagram ? activeFks : []);
    return () => onPreviewFksChange([]);
  }, [activeFks, previewInDiagram, onPreviewFksChange]);

  const handleAddManualFk = useCallback(() => {
    if (!srcTable || !srcCol || !tgtTable || !tgtCol) return;
    setManualFks((prev) => {
      const filtered = prev.filter((f) => !(f.table === srcTable && f.column === srcCol));
      return [
        ...filtered,
        {
          table: srcTable,
          column: srcCol,
          referencesTable: tgtTable,
          referencesColumn: tgtCol,
          ...(onDelete ? { onDelete } : {}),
        },
      ];
    });
  }, [srcTable, srcCol, tgtTable, tgtCol, onDelete]);

  const handleSuggestWithAi = useCallback(async () => {
    if (loadingAi) return;
    setLoadingAi(true);
    setAiError(null);
    try {
      const [provider, model] = effectiveModelKey.split("::");
      const res = await fetch(`/api/migrations/${connectionId}/${packageId}/fks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "suggest",
          order: currentOrder,
          useAi: true,
          provider: provider || undefined,
          model: model || undefined,
          promptHint: promptHint.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        reply?: string;
        suggestions?: ForeignKeySuggestion[];
      } | null;
      if (!res.ok || !body) {
        throw new Error(body?.error ?? "Falha ao consultar IA para sugestões de FK");
      }
      const list = body.suggestions ?? [];
      setAiSuggestions(list);
      setAiReply(body.reply ?? null);
      setCheckedSuggestionIds((prev) => {
        const next = new Set(prev);
        for (const item of list) next.add(item.id);
        return next;
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Erro ao sugerir FKs com IA");
    } finally {
      setLoadingAi(false);
    }
  }, [loadingAi, effectiveModelKey, connectionId, packageId, currentOrder, promptHint]);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [generatedSql, setGeneratedSql] = useState<{ filename: string; sql: string } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const handleApplyFks = useCallback(
    async (saveToPackage: boolean) => {
      if (activeFks.length === 0 || saving) return;
      setSaving(true);
      setSaveMessage(null);
      try {
        const res = await fetch(`/api/migrations/${connectionId}/${packageId}/fks`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "apply",
            fks: activeFks,
            saveToPackage,
          }),
        });
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          filename?: string;
          sql?: string;
          saved?: boolean;
        } | null;
        if (!res.ok || !body) {
          throw new Error(body?.error ?? "Falha ao aplicar Foreign Keys");
        }
        if (body.sql && body.filename) {
          setGeneratedSql({ filename: body.filename, sql: body.sql });
        }
        if (saveToPackage) {
          setSaveMessage(
            `Migration "${body.filename}" gravada no package com ${activeFks.length} FK(s)!`
          );
          setManualFks([]);
          await onPackageUpdated();
        } else {
          setSaveMessage(`SQL gerado (${body.filename}). Veja abaixo para copiar.`);
        }
      } catch (err) {
        setSaveMessage(err instanceof Error ? err.message : "Erro ao aplicar FKs");
      } finally {
        setSaving(false);
      }
    },
    [activeFks, saving, connectionId, packageId, onPackageUpdated]
  );

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            <Link2 className="h-3.5 w-3.5" />
            Ligar Foreign Keys (Manual &amp; Sugestão por IA)
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Filtre por módulo nos chips abaixo, escolha a tabela e a coluna de origem/destino, ou peça sugestões à IA.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={hideControlTables}
              onChange={(e) => setHideControlTables(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Ocultar tabelas de controle (*_DADOSSYS / Flyway)
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={previewInDiagram}
              onChange={(e) => setPreviewInDiagram(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Pré-visualizar no diagrama ({activeFks.length} ativa{activeFks.length === 1 ? "" : "s"})
          </label>
        </div>
      </div>

      {/* Filtro de Chips de Escopo / Módulo (igual ao ReactFlow) */}
      {scopes.length > 1 ? (
        <div className="space-y-1.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/50 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
              <Filter className="h-3 w-3 text-[var(--color-accent)]" />
              Filtrar tabelas por módulo / escopo (clique em 1 ou mais chips):
            </span>
            {selectedScopes.size > 0 ? (
              <button
                type="button"
                onClick={() => setSelectedScopes(new Set())}
                className="text-[11px] text-[var(--color-accent)] hover:underline"
              >
                Mostrar todos ({baseNodes.length})
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedScopes(new Set())}
              className="rounded-lg border px-2.5 py-1 text-xs font-medium transition"
              style={
                selectedScopes.size === 0
                  ? { borderColor: "#22d3ee88", background: "#22d3ee18", color: "#22d3ee" }
                  : { borderColor: "#1e293b", color: "#64748b" }
              }
            >
              Todos <span className="opacity-70">({baseNodes.length})</span>
            </button>
            {scopes.map((scope) => {
              const active = selectedScopes.has(scope.id);
              const tone = colorFor(scope.id);
              return (
                <button
                  key={scope.id}
                  type="button"
                  onClick={() => toggleScopeChip(scope.id)}
                  title={scope.description || scope.label}
                  className="rounded-lg border px-2.5 py-1 text-xs transition"
                  style={
                    active
                      ? { borderColor: tone.border, background: tone.fill, color: tone.color }
                      : { borderColor: "#1e293b", color: "#64748b" }
                  }
                >
                  {scope.label} <span className="opacity-70">({scope.tables})</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 1. Ligação Manual — 2 cartões separados (Origem FK -> Destino PK) */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            1. Ligar Foreign Key Manualmente ({scopeFilteredNodes.length} tabelas no filtro atual)
          </p>
          {srcTableObj && tgtTableObj ? (
            <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
              Preview:{" "}
              <span className="text-cyan-300">
                {srcTableObj.label}.{srcCol || "?"}
              </span>{" "}
              →{" "}
              <span className="text-emerald-300">
                {tgtTableObj.label}.{tgtCol || "?"}
              </span>
            </span>
          ) : null}
        </div>

        <div className="mt-2.5 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto]">
          {/* Bloco Origem (FK) */}
          <div className="space-y-2 rounded-xl border border-cyan-500/25 bg-cyan-950/10 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300">
                Origem (Tabela com a coluna FK)
              </span>
              <input
                type="text"
                value={srcFilterText}
                onChange={(e) => setSrcFilterText(e.target.value)}
                placeholder="Buscar tabela origem..."
                className="w-40 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2 py-0.5 text-[11px] text-[var(--color-text-primary)]"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-[var(--color-text-muted)]">
                1º · Tabela Origem ({srcNodes.length})
                <select
                  value={srcTable}
                  onChange={(e) => {
                    const nextTable = e.target.value;
                    setSrcTable(nextTable);
                    const node = diagram.nodes.find((n) => n.id === nextTable);
                    const firstFkCandidate = node?.columns.find((c) => !c.isPrimary) ?? node?.columns[0];
                    if (firstFkCandidate) {
                      handleSelectSrcColumn(firstFkCandidate.name);
                    } else {
                      setSrcCol("");
                    }
                  }}
                  className="mt-1 block w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2 py-1.5 font-mono text-xs text-[var(--color-text-primary)]"
                >
                  {srcGroups.length <= 1
                    ? srcNodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                        </option>
                      ))
                    : srcGroups.map((g) => (
                        <optgroup key={g.scopeId} label={`Módulo: ${g.scopeLabel}`}>
                          {g.nodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                </select>
              </label>

              <label className="text-[11px] text-[var(--color-text-muted)]">
                2º · Coluna Origem (FK)
                <select
                  value={srcCol}
                  onChange={(e) => handleSelectSrcColumn(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2 py-1.5 font-mono text-xs text-cyan-200"
                >
                  {(srcTableObj?.columns ?? []).map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.type}{c.isPrimary ? " · PK" : ""})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="hidden items-center justify-center text-[var(--color-text-muted)] lg:flex">
            <ArrowRight className="h-4 w-4 text-[var(--color-accent)]" />
          </div>

          {/* Bloco Destino (PK) */}
          <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                Destino (Tabela referenciada / PK)
              </span>
              <input
                type="text"
                value={tgtFilterText}
                onChange={(e) => setTgtFilterText(e.target.value)}
                placeholder="Buscar tabela destino..."
                className="w-40 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2 py-0.5 text-[11px] text-[var(--color-text-primary)]"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-[var(--color-text-muted)]">
                3º · Tabela Destino ({tgtNodes.length})
                <select
                  value={tgtTable}
                  onChange={(e) => {
                    const nextTable = e.target.value;
                    setTgtTable(nextTable);
                    const node = diagram.nodes.find((n) => n.id === nextTable);
                    const pk = node?.columns.find((c) => c.isPrimary) ?? node?.columns[0];
                    setTgtCol(pk?.name ?? "");
                  }}
                  className="mt-1 block w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2 py-1.5 font-mono text-xs text-[var(--color-text-primary)]"
                >
                  {tgtGroups.length <= 1
                    ? tgtNodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                        </option>
                      ))
                    : tgtGroups.map((g) => (
                        <optgroup key={g.scopeId} label={`Módulo: ${g.scopeLabel}`}>
                          {g.nodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                </select>
              </label>

              <label className="text-[11px] text-[var(--color-text-muted)]">
                4º · Coluna Destino (PK)
                <select
                  value={tgtCol}
                  onChange={(e) => setTgtCol(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2 py-1.5 font-mono text-xs text-emerald-200"
                >
                  {sortedTgtColumns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.isPrimary ? `★ ${c.name} (PK · ${c.type})` : `${c.name} (${c.type})`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Ação ON DELETE + Botão Ligar */}
          <div className="flex flex-col justify-between gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-2.5">
            <label className="text-[11px] text-[var(--color-text-muted)]">
              ON DELETE
              <select
                value={onDelete}
                onChange={(e) => setOnDelete(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
              >
                <option value="">Padrão</option>
                <option value="CASCADE">CASCADE</option>
                <option value="SET NULL">SET NULL</option>
                <option value="RESTRICT">RESTRICT</option>
              </select>
            </label>
            <button
              type="button"
              onClick={handleAddManualFk}
              disabled={!srcTable || !srcCol || !tgtTable || !tgtCol}
              className="flex h-[32px] items-center justify-center gap-1 rounded-lg bg-[var(--color-accent)] px-3.5 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Ligar FK
            </button>
          </div>
        </div>

        {manualFks.length > 0 ? (
          <div className="mt-3 space-y-1 border-t border-[var(--color-border-subtle)] pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Ligações manuais adicionadas ({manualFks.length})
            </p>
            <ul className="space-y-1 text-xs">
              {manualFks.map((fk, idx) => (
                <li
                  key={`${fk.table}.${fk.column}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2.5 py-1 font-mono"
                >
                  <span className="text-cyan-300">
                    {formatNodeLabel(fk.table)}.{fk.column}{" "}
                    <span className="text-[var(--color-text-muted)]">→</span>{" "}
                    <span className="text-emerald-300">
                      {formatNodeLabel(fk.referencesTable)}.{fk.referencesColumn}
                    </span>
                    {fk.onDelete ? (
                      <span className="ml-2 text-[10px] text-[var(--color-text-muted)]">
                        (ON DELETE {fk.onDelete})
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => setManualFks((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-rose-400 hover:text-rose-300"
                    title="Remover esta ligação manual"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* 2. Sugestões por Heurística + IA */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            2. Sugestões Automáticas de Foreign Keys ({visibleSuggestions.length}
            {selectedScopes.size > 0 ? ` de ${allSuggestions.length} no módulo filtrado` : ""})
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              value={promptHint}
              onChange={(e) => setPromptHint(e.target.value)}
              placeholder="Dica opcional p/ IA (ex: ligar cod_cli a clientes)..."
              className="w-56 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2.5 py-1 text-xs text-[var(--color-text-primary)]"
            />
            <select
              value={effectiveModelKey}
              onChange={(e) => setSelectedModelKey(e.target.value)}
              disabled={loadingModels || models.length === 0 || loadingAi}
              className="max-w-[190px] truncate rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2 py-1 text-xs text-[var(--color-text-secondary)]"
            >
              {loadingModels ? (
                <option>Carregando modelos...</option>
              ) : models.length === 0 ? (
                <option>Sem LLM configurada</option>
              ) : (
                groupedModels.map(([provider, list]) => (
                  <optgroup
                    key={provider}
                    label={LLM_PROVIDER_LABELS[provider as keyof typeof LLM_PROVIDER_LABELS] ?? provider}
                  >
                    {list.map((m) => (
                      <option key={modelKey(m)} value={modelKey(m)}>
                        {m.displayName}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={() => void handleSuggestWithAi()}
              disabled={loadingAi || models.length === 0}
              className="flex items-center gap-1 rounded-lg bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {loadingAi ? "Analisando schema..." : "Sugerir com IA"}
            </button>
          </div>
        </div>

        {aiError ? <p className="mt-2 text-xs text-rose-400">{aiError}</p> : null}
        {aiReply ? (
          <p className="mt-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/70 px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)]">
            <strong className="text-[var(--color-accent)]">IA:</strong> {aiReply}
          </p>
        ) : null}

        {visibleSuggestions.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            Nenhuma FK implícita pendente detectada por nome de coluna neste filtro. Clique em{" "}
            <strong>Sugerir com IA</strong> para buscar relações semânticas entre as tabelas.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
              <button
                type="button"
                onClick={() =>
                  setCheckedSuggestionIds((prev) => {
                    const next = new Set(prev);
                    for (const s of visibleSuggestions) next.add(s.id);
                    return next;
                  })
                }
                className="hover:text-[var(--color-accent)] hover:underline"
              >
                Marcar visíveis ({visibleSuggestions.length})
              </button>
              <button
                type="button"
                onClick={() =>
                  setCheckedSuggestionIds((prev) => {
                    const next = new Set(prev);
                    for (const s of visibleSuggestions) next.delete(s.id);
                    return next;
                  })
                }
                className="hover:text-[var(--color-accent)] hover:underline"
              >
                Desmarcar visíveis
              </button>
            </div>
            <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 text-xs">
              {visibleSuggestions.map((s) => {
                const checked = checkedSuggestionIds.has(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-2.5 py-1.5"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setCheckedSuggestionIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.id)) next.delete(s.id);
                            else next.add(s.id);
                            return next;
                          });
                        }}
                        className="accent-[var(--color-accent)]"
                      />
                      <span className="truncate font-mono text-cyan-300">
                        {formatNodeLabel(s.table)}.{s.column}{" "}
                        <span className="text-[var(--color-text-muted)]">→</span>{" "}
                        <span className="text-emerald-300">
                          {formatNodeLabel(s.referencesTable)}.{s.referencesColumn}
                        </span>
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          s.source === "ai"
                            ? "bg-violet-500/20 text-violet-300"
                            : "bg-cyan-500/15 text-cyan-300"
                        }`}
                      >
                        {s.source === "ai" ? "IA" : "Heurística"}
                      </span>
                      {s.crossScope ? (
                        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                          Cross-scope
                        </span>
                      ) : null}
                    </label>
                    <span className="text-[11px] text-[var(--color-text-muted)]">{s.reason}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* 3. Barra de Ação: Gravar Migration V{N+1} ou Gerar SQL */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-xs text-[var(--color-text-secondary)]">
          Total selecionado para aplicar: <strong>{activeFks.length}</strong> foreign key(s)
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={activeFks.length === 0 || saving}
            onClick={() => void handleApplyFks(false)}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Gerar SQL (sem gravar)
          </button>
          <button
            type="button"
            disabled={activeFks.length === 0 || saving}
            onClick={() => void handleApplyFks(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Gravar no Package (Anexar V{fileCount + 1})
          </button>
        </div>
      </div>

      {saveMessage ? (
        <p className="text-xs font-medium text-emerald-400">{saveMessage}</p>
      ) : null}

      {generatedSql ? (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-slate-950 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-cyan-300">{generatedSql.filename}</span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(generatedSql.sql).then(() => {
                  setCopiedSql(true);
                  setTimeout(() => setCopiedSql(false), 1800);
                });
              }}
              className="flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
            >
              {copiedSql ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copiedSql ? "Copiado" : "Copiar SQL"}
            </button>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] text-slate-200">
            {generatedSql.sql}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

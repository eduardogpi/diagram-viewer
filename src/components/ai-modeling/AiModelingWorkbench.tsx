"use client";

import { Database, Loader2, Maximize2, Minimize2, RefreshCw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SchemaEditor, { SchemaEditorTypesDatalist } from "@/components/ai-modeling/SchemaEditor";
import MigrationDiagram, { type MigrationDiagramPayload } from "@/components/migrations/MigrationDiagram";
import { computeDiagramDiff } from "@/lib/diagram-diff";
import { LLM_PROVIDER_LABELS, useLlmModels, type LlmModelInfo } from "@/lib/hooks/useLlmModels";
import type { SchemaOp } from "@/lib/services/schema-ops";
import type { DiagramResponse } from "@/lib/types/diagram";

function modelKey(m: Pick<LlmModelInfo, "provider" | "id">): string {
  return `${m.provider}::${m.id}`;
}

type Props = { connectionId: string; initialSessionId?: string };

type AiModelingSessionDTO = {
  id: string;
  name: string;
  provider: string;
  model: string;
  /** Turno para o qual a sessão foi revertida; null quando está na ponta do histórico. */
  checkpointOrder: number | null;
  memoryEnabled: boolean;
  memoryProjectId: string | null;
  /** Falso quando o servidor não tem o MCP de memória configurado. */
  memoryAvailable: boolean;
  createdAt: string;
  updatedAt: string;
};

type AiModelingTurnDTO = {
  id: string;
  order: number;
  role: "user" | "assistant";
  message: string;
  operations: SchemaOp[];
  diagram: DiagramResponse;
  createdAt: string;
};

type SessionDetail = {
  session: AiModelingSessionDTO;
  diagram: DiagramResponse;
  turns: AiModelingTurnDTO[];
};

function opSummary(op: SchemaOp): string {
  switch (op.op) {
    case "createTable":
      return `Criar tabela "${op.table}" (${op.columns.length} coluna(s))`;
    case "addColumn":
      return `Adicionar coluna "${op.newColumn.name}" em "${op.table}"`;
    case "alterColumn":
      return `Alterar coluna "${op.column}" em "${op.table}"`;
    case "dropColumn":
      return `Remover coluna "${op.column}" de "${op.table}"`;
    case "renameColumn":
      return `Renomear coluna "${op.column}" para "${op.newName}" em "${op.table}"`;
    case "addForeignKey":
      return `Ligar "${op.table}.${op.column}" → "${op.referencesTable}.${op.referencesColumn}"`;
    case "dropForeignKey":
      return `Remover FK de "${op.table}.${op.column}"`;
    case "dropTable":
      return `Remover tabela "${op.table}"`;
    case "renameTable":
      return `Renomear tabela "${op.table}" para "${op.newName}"`;
    default:
      return "Operação";
  }
}

export default function AiModelingWorkbench({ connectionId, initialSessionId }: Props) {
  const [sessions, setSessions] = useState<AiModelingSessionDTO[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionModelKey, setNewSessionModelKey] = useState("");
  const [creating, setCreating] = useState(false);
  const { models, loading: loadingModels, refreshing, error: modelsError, refresh } = useLlmModels();

  // Se o usuário ainda não escolheu um modelo explicitamente, usa o primeiro da lista.
  const effectiveNewSessionModelKey = newSessionModelKey || (models[0] ? modelKey(models[0]) : "");
  const groupedModels = useMemo(() => {
    const groups = new Map<string, LlmModelInfo[]>();
    for (const m of models) {
      if (!groups.has(m.provider)) groups.set(m.provider, []);
      groups.get(m.provider)!.push(m);
    }
    return Array.from(groups.entries());
  }, [models]);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialSessionId ?? null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [discussOnly, setDiscussOnly] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportDialect, setExportDialect] = useState<"mysql" | "postgres">("mysql");
  const [exportDatabase, setExportDatabase] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Mensagem já enviada mas ainda sem turno persistido — exibida no chat enquanto a LLM responde. */
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [updatingModel, setUpdatingModel] = useState(false);
  const [revertingOrder, setRevertingOrder] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === fullscreenContainerRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!fullscreenContainerRef.current) return;
    if (document.fullscreenElement === fullscreenContainerRef.current) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    await fullscreenContainerRef.current.requestFullscreen().catch(() => undefined);
  }, []);

  const refreshList = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingList(true);
      setListError(null);
      try {
        const res = await fetch(`/api/ai-modeling/${connectionId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Falha ao listar sessões");
        const data = (await res.json()) as AiModelingSessionDTO[];
        setSessions(data);
      } catch (err) {
        if (!silent) setListError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        if (!silent) setLoadingList(false);
      }
    },
    [connectionId]
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // Sessões criadas por outros clientes (ex: agente via MCP) aparecem na lista sozinhas.
  useEffect(() => {
    const timer = setInterval(() => void refreshList(true), 8000);
    return () => clearInterval(timer);
  }, [refreshList]);

  const loadDetail = useCallback(
    async (sessionId: string) => {
      setLoadingDetail(true);
      setDetailError(null);
      try {
        const res = await fetch(`/api/ai-modeling/${connectionId}/${sessionId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Falha ao carregar sessão");
        const data = (await res.json()) as SessionDetail;
        setDetail(data);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        setLoadingDetail(false);
      }
    },
    [connectionId]
  );

  useEffect(() => {
    if (!selectedSessionId) {
      setDetail(null);
      setSelectedTableId(null);
      return;
    }
    setSelectedTableId(null);
    void loadDetail(selectedSessionId);
  }, [selectedSessionId, loadDetail]);

  // Sincronização em tempo real: quando outro cliente (ex: Claude Code via MCP) altera a sessão
  // aberta, o diagrama e o chat atualizam sozinhos. Polling leve, pausado durante envio próprio.
  useEffect(() => {
    if (!selectedSessionId) return;
    const timer = setInterval(async () => {
      if (document.visibilityState === "hidden" || sending || revertingOrder !== null) return;
      try {
        const res = await fetch(`/api/ai-modeling/${connectionId}/${selectedSessionId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as SessionDetail;
        setDetail((current) =>
          current && current.session.updatedAt === data.session.updatedAt ? current : data
        );
      } catch {
        // Falha de rede no polling não derruba a tela — tenta de novo no próximo ciclo.
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [selectedSessionId, connectionId, sending, revertingOrder]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [detail?.turns.length, pendingMessage, streamingReply]);

  const createSession = useCallback(async () => {
    if (newSessionName.trim().length < 3) return;
    setCreating(true);
    try {
      const [provider, model] = effectiveNewSessionModelKey.split("::");
      const res = await fetch(`/api/ai-modeling/${connectionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newSessionName.trim(), model: model || undefined, provider: provider || undefined }),
      });
      if (!res.ok) throw new Error("Falha ao criar sessão");
      const created = (await res.json()) as AiModelingSessionDTO;
      setNewSessionName("");
      await refreshList();
      setSelectedSessionId(created.id);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Erro ao criar sessão");
    } finally {
      setCreating(false);
    }
  }, [connectionId, newSessionName, effectiveNewSessionModelKey, refreshList]);

  const removeSession = useCallback(
    async (sessionId: string) => {
      if (!confirm("Remover esta sessão de modelagem?")) return;
      const res = await fetch(`/api/ai-modeling/${connectionId}/${sessionId}`, { method: "DELETE" });
      if (res.ok) {
        if (selectedSessionId === sessionId) setSelectedSessionId(null);
        await refreshList();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(body?.error ?? "Falha ao remover a sessão");
      }
    },
    [connectionId, selectedSessionId, refreshList]
  );

  const exportQuery = useCallback(() => {
    const params = new URLSearchParams({ dialect: exportDialect });
    if (exportDatabase.trim()) params.set("database", exportDatabase.trim());
    return params.toString();
  }, [exportDialect, exportDatabase]);

  const downloadSql = useCallback(() => {
    if (!selectedSessionId) return;
    // Navegação direta: a rota já responde com Content-Disposition: attachment.
    window.location.href = `/api/ai-modeling/${connectionId}/${selectedSessionId}/export?${exportQuery()}`;
    setExportMessage("Download iniciado.");
  }, [connectionId, selectedSessionId, exportQuery]);

  const saveAsPackage = useCallback(async () => {
    if (!selectedSessionId || exporting) return;
    setExporting(true);
    setExportMessage(null);
    try {
      const res = await fetch(`/api/ai-modeling/${connectionId}/${selectedSessionId}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dialect: exportDialect, database: exportDatabase.trim() || undefined }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; name?: string; fileCount?: number } | null;
      if (!res.ok) throw new Error(body?.error ?? "Falha ao salvar como migrations");
      setExportMessage(`Salvo como package "${body?.name}" — abra a aba Migrations para ver a timeline.`);
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Erro ao salvar como migrations");
    } finally {
      setExporting(false);
    }
  }, [connectionId, selectedSessionId, exporting, exportDialect, exportDatabase]);

  const toggleMemory = useCallback(
    async (enabled: boolean) => {
      if (!selectedSessionId) return;
      const res = await fetch(`/api/ai-modeling/${connectionId}/${selectedSessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memoryEnabled: enabled }),
      });
      if (res.ok) {
        await loadDetail(selectedSessionId);
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(body?.error ?? "Falha ao atualizar a memória da sessão");
      }
    },
    [connectionId, selectedSessionId, loadDetail]
  );

  const switchSessionModel = useCallback(
    async (key: string) => {
      if (!selectedSessionId || updatingModel) return;
      const [provider, model] = key.split("::");
      if (!provider || !model) return;
      setUpdatingModel(true);
      try {
        const res = await fetch(`/api/ai-modeling/${connectionId}/${selectedSessionId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, model }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Falha ao trocar modelo");
        }
        await loadDetail(selectedSessionId);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Falha ao trocar modelo");
      } finally {
        setUpdatingModel(false);
      }
    },
    [connectionId, selectedSessionId, updatingModel, loadDetail]
  );

  const sendMessage = useCallback(async () => {
    if (!selectedSessionId || message.trim().length === 0 || sending) return;
    const text = message.trim();
    setSending(true);
    setSendError(null);
    setMessage("");
    setPendingMessage(text);
    setStreamingReply("");
    try {
      const res = await fetch(`/api/ai-modeling/${connectionId}/${selectedSessionId}/turns/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, discussOnly }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha ao enviar mensagem");
      }

      if (!res.body) {
        throw new Error("Sem resposta em stream do servidor");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;
          let eventType = "message";
          let dataStr = "";

          const lines = rawEvent.split("\n");
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataStr = line.slice(5).trim();
            }
          }

          if (!dataStr) continue;

          if (eventType === "delta") {
            try {
              const { delta } = JSON.parse(dataStr);
              if (delta) {
                setStreamingReply((prev) => (prev ?? "") + delta);
              }
            } catch {
              // ignore
            }
          } else if (eventType === "done") {
            await loadDetail(selectedSessionId);
            setStreamingReply(null);
          } else if (eventType === "error") {
            try {
              const { error } = JSON.parse(dataStr);
              throw new Error(error || "Erro no processamento da IA");
            } catch (parseErr) {
              throw parseErr instanceof Error ? parseErr : new Error("Erro no processamento da IA");
            }
          }
        }
      }

      await loadDetail(selectedSessionId);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Erro ao enviar mensagem");
      setMessage(text);
    } finally {
      setSending(false);
      setPendingMessage(null);
      setStreamingReply(null);
    }
  }, [connectionId, selectedSessionId, message, sending, discussOnly, loadDetail]);

  const applyManualOps = useCallback(
    async (operations: SchemaOp[], note: string) => {
      if (!selectedSessionId || sending || revertingOrder !== null) return;
      const res = await fetch(`/api/ai-modeling/${connectionId}/${selectedSessionId}/ops`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operations, message: note }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; warnings?: Array<{ reason: string }> }
        | SessionDetail
        | null;
      if (!res.ok) {
        throw new Error((body as { error?: string } | null)?.error ?? "Falha ao aplicar edição");
      }
      await loadDetail(selectedSessionId);
    },
    [connectionId, selectedSessionId, sending, revertingOrder, loadDetail]
  );

  const revertToTurn = useCallback(
    async (turnOrder: number) => {
      if (!selectedSessionId || sending || revertingOrder !== null) return;
      setRevertingOrder(turnOrder);
      setSendError(null);
      try {
        const res = await fetch(`/api/ai-modeling/${connectionId}/${selectedSessionId}/revert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ turnOrder }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Falha ao voltar para o checkpoint");
        }
        setDetail((await res.json()) as SessionDetail);
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Erro ao voltar para o checkpoint");
      } finally {
        setRevertingOrder(null);
      }
    },
    [connectionId, selectedSessionId, sending, revertingOrder]
  );

  const activeDiagram: MigrationDiagramPayload = detail?.diagram ?? { nodes: [], edges: [], scopes: [] };
  const checkpointOrder = detail?.session.checkpointOrder ?? null;
  const lastTurnOrder = detail?.turns.at(-1)?.order ?? null;

  /**
   * Turno que corresponde ao diagrama exibido: o checkpoint ativo quando a sessão foi revertida,
   * senão a última resposta da IA. É a base do diff destacado no diagrama.
   */
  const activeTurn = useMemo(() => {
    if (!detail) return undefined;
    if (checkpointOrder !== null) {
      return detail.turns.find((t) => t.order === checkpointOrder);
    }
    return [...detail.turns].reverse().find((t) => t.role === "assistant");
  }, [detail, checkpointOrder]);

  const diffMap = useMemo(() => {
    if (!detail || !activeTurn) return undefined;
    const turnIndex = detail.turns.findIndex((t) => t.id === activeTurn.id);
    const previousDiagram = turnIndex > 0 ? detail.turns[turnIndex - 1].diagram : null;
    return computeDiagramDiff(previousDiagram, activeTurn.diagram);
  }, [detail, activeTurn]);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <section className="space-y-4">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-4 shadow-[var(--shadow-floating)]">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Modelagem com IA</p>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            Descreva o schema em linguagem natural ou edite direto no inspector — as duas formas entram no mesmo histórico.
          </p>
          <div className="mt-3 space-y-2">
            <input
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              placeholder="Nome da sessão (ex: Loja online)"
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
            <div className="flex items-center gap-1.5">
              <select
                value={effectiveNewSessionModelKey}
                onChange={(e) => setNewSessionModelKey(e.target.value)}
                disabled={loadingModels || models.length === 0}
                className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
              >
                {loadingModels ? (
                  <option>Carregando modelos...</option>
                ) : models.length === 0 ? (
                  <option>Nenhum provedor de LLM configurado</option>
                ) : (
                  groupedModels.map(([provider, providerModels]) => (
                    <optgroup key={provider} label={LLM_PROVIDER_LABELS[provider as keyof typeof LLM_PROVIDER_LABELS] ?? provider}>
                      {providerModels.map((m) => (
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
                onClick={() => void refresh()}
                disabled={refreshing || loadingModels}
                title="Atualizar modelos das APIs disponíveis"
                aria-label="Atualizar modelos das APIs disponíveis"
                className="shrink-0 rounded-lg border border-[var(--color-border-subtle)] p-2 text-[var(--color-text-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
            {modelsError ? <p className="text-xs text-red-500">{modelsError}</p> : null}
            <button
              type="button"
              onClick={() => void createSession()}
              disabled={creating || newSessionName.trim().length < 3}
              className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Criando..." : "Nova modelagem"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-4 shadow-[var(--shadow-floating)]">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Sessões</p>
          {loadingList ? (
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">Carregando...</p>
          ) : listError ? (
            <p className="mt-3 text-xs text-red-500">{listError}</p>
          ) : sessions.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">Nenhuma sessão ainda.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedSessionId(s.id)}
                    className={`flex-1 truncate rounded-lg border px-3 py-2 text-left text-xs transition ${
                      selectedSessionId === s.id
                        ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)] text-[var(--color-text-primary)]"
                        : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
                    }`}
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeSession(s.id)}
                    title="Remover sessão"
                    className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-2 text-xs text-[var(--color-text-muted)] transition hover:border-rose-400 hover:text-rose-400"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {detail ? (
          <SchemaEditor
            diagram={detail.diagram}
            disabled={sending || revertingOrder !== null}
            selectedTableId={selectedTableId}
            onSelectTable={setSelectedTableId}
            onApply={applyManualOps}
          />
        ) : null}
      </section>

      <section className="space-y-4">
        {!selectedSessionId ? (
          <div className="flex h-[400px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
            Crie ou selecione uma sessão de modelagem pra começar a conversar com a IA.
          </div>
        ) : loadingDetail && !detail ? (
          <div className="flex h-[400px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
            Carregando sessão...
          </div>
        ) : detailError ? (
          <p className="text-sm text-red-500">{detailError}</p>
        ) : detail ? (
          (() => {
            const chatCard = (floating: boolean) => (
              <div
                className={
                  floating
                    ? "absolute bottom-4 right-4 top-4 z-20 flex w-[360px] flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/90 p-4 shadow-2xl backdrop-blur-md"
                    : "flex h-[560px] flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-4 shadow-[var(--shadow-floating)]"
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    {detail.session.name}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {updatingModel ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--color-accent)]" />
                    ) : null}
                    <select
                      value={`${detail.session.provider}::${detail.session.model}`}
                      onChange={(e) => void switchSessionModel(e.target.value)}
                      disabled={updatingModel || sending || loadingModels || models.length === 0}
                      title="Trocar modelo desta sessão"
                      className="max-w-[200px] truncate rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
                    >
                      {!models.some((m) => m.provider === detail.session.provider && m.id === detail.session.model) ? (
                        <option value={`${detail.session.provider}::${detail.session.model}`}>
                          {LLM_PROVIDER_LABELS[detail.session.provider as keyof typeof LLM_PROVIDER_LABELS] ?? detail.session.provider} · {detail.session.model}
                        </option>
                      ) : null}
                      {groupedModels.map(([provider, list]) => (
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
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void refresh()}
                      disabled={refreshing || loadingModels}
                      title="Atualizar modelos das APIs disponíveis"
                      aria-label="Atualizar modelos das APIs disponíveis"
                      className="shrink-0 rounded-full border border-[var(--color-border-subtle)] p-1 text-[var(--color-text-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
                  {detail.turns.length === 0 && !pendingMessage ? (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Descreva o que você quer modelar — ex: &quot;crie tabelas de clientes e pedidos, um cliente pode ter vários pedidos&quot;.
                    </p>
                  ) : (
                    detail.turns.map((turn) => {
                      const isCheckpoint = checkpointOrder === turn.order;
                      // Turnos à frente do checkpoint continuam gravados (dá pra refazer), mas
                      // serão descartados se o usuário enviar uma nova mensagem daqui.
                      const isDiscardable = checkpointOrder !== null && turn.order > checkpointOrder;
                      // Só faz sentido restaurar o estado *depois* de uma resposta da IA.
                      const canRevert = turn.role === "assistant" && !isCheckpoint && !(checkpointOrder === null && turn.order === lastTurnOrder);

                      return (
                        <div
                          key={turn.id}
                          className={`group rounded-xl border px-3 py-2 text-xs transition ${
                            turn.role === "user"
                              ? "border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] text-[var(--color-text-primary)]"
                              : "border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] text-[var(--color-text-primary)]"
                          } ${isCheckpoint ? "ring-1 ring-[var(--color-accent)]" : ""} ${isDiscardable ? "opacity-40" : ""}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                              {turn.role === "user" ? "Você" : "IA"}
                              {isCheckpoint ? " · estado atual" : ""}
                            </p>
                            {canRevert ? (
                              <button
                                type="button"
                                onClick={() => void revertToTurn(turn.order)}
                                disabled={sending || revertingOrder !== null}
                                title="Voltar o diagrama para o estado logo após esta resposta"
                                className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] opacity-0 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus:opacity-100 disabled:cursor-not-allowed group-hover:opacity-100"
                              >
                                {revertingOrder === turn.order ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Undo2 className="h-3 w-3" />
                                )}
                                Voltar aqui
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap">{turn.message}</p>
                          {turn.operations.length > 0 ? (
                            <ul className="mt-2 space-y-1 border-t border-[var(--color-border-subtle)] pt-2">
                              {turn.operations.map((op, idx) => (
                                <li key={idx} className="font-mono text-[10px] text-[var(--color-accent)]">
                                  {opSummary(op)}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                  {pendingMessage ? (
                    <>
                      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-xs text-[var(--color-text-primary)] opacity-70">
                        <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Você</p>
                        <p className="mt-1 whitespace-pre-wrap">{pendingMessage}</p>
                      </div>
                      <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] px-3 py-2 text-xs text-[var(--color-text-primary)]">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">IA</p>
                          <span className="flex items-center gap-1 text-[10px] text-[var(--color-accent)]">
                            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[var(--color-accent)]" />
                            {streamingReply ? "gerando..." : "pensando..."}
                          </span>
                        </div>
                        {streamingReply ? (
                          <div className="mt-1 whitespace-pre-wrap">
                            {streamingReply}
                            <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-[var(--color-accent)]" />
                          </div>
                        ) : (
                          <p className="mt-1 flex items-center gap-2 text-[var(--color-text-secondary)]">
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-accent)]" />
                            <span className="animate-pulse">
                              {discussOnly ? "Pensando na resposta..." : "Analisando o modelo e montando as mudanças..."}
                            </span>
                          </p>
                        )}
                      </div>
                    </>
                  ) : null}
                  <div ref={chatEndRef} />
                </div>
                <div className="mt-3 space-y-2">
                  {sendError ? <p className="text-xs text-red-500">{sendError}</p> : null}
                  {checkpointOrder !== null && lastTurnOrder !== null ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-[var(--color-text-secondary)]">
                      <span>
                        Você voltou a um ponto anterior. Enviar agora <strong>descarta</strong> as respostas à frente.
                      </span>
                      <button
                        type="button"
                        onClick={() => void revertToTurn(lastTurnOrder)}
                        disabled={sending || revertingOrder !== null}
                        title="Voltar para o estado mais recente"
                        className="shrink-0 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Refazer tudo
                      </button>
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
                    <input
                      type="checkbox"
                      checked={discussOnly}
                      onChange={(e) => setDiscussOnly(e.target.checked)}
                      className="accent-[var(--color-accent)]"
                    />
                    Só discutir (não altera o diagrama)
                  </label>
                  {detail.session.memoryAvailable ? (
                    <label
                      className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]"
                      title={
                        detail.session.memoryProjectId
                          ? `Memória no projeto "${detail.session.memoryProjectId}" do CodeGraph`
                          : "Decisões desta modelagem ficam guardadas e voltam nas próximas sessões deste projeto"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={detail.session.memoryEnabled}
                        onChange={(e) => void toggleMemory(e.target.checked)}
                        disabled={sending}
                        className="accent-[var(--color-accent)]"
                      />
                      Memória do projeto
                    </label>
                  ) : null}
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder={sending ? "Aguardando a resposta da IA..." : "Descreva a tabela ou mudança que você quer..."}
                    rows={2}
                    disabled={sending}
                    className="w-full resize-none rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={sending || message.trim().length === 0}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Pensando...
                      </>
                    ) : discussOnly ? (
                      "Perguntar"
                    ) : (
                      "Enviar"
                    )}
                  </button>
                </div>
              </div>
            );

            return (
              <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
                {!isFullscreen ? chatCard(false) : null}

                <div
                  ref={fullscreenContainerRef}
                  className={isFullscreen ? "fixed inset-0 z-40 overflow-auto bg-[var(--color-bg-canvas)] p-4" : "relative space-y-2"}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
                      Diagrama do modelo
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {activeDiagram.nodes.length} tabelas · {activeDiagram.edges.length} relações
                      </p>
                      <button
                        type="button"
                        onClick={() => setExportOpen((v) => !v)}
                        disabled={activeDiagram.nodes.length === 0}
                        title="Gerar SQL a partir deste modelo"
                        className="flex h-7 items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 text-[11px] text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Database className="h-3.5 w-3.5" /> Exportar
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleFullscreen()}
                        title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                      >
                        {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {exportOpen && activeDiagram.nodes.length > 0 ? (
                    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-3">
                      <label className="text-[11px] text-[var(--color-text-secondary)]">
                        Banco
                        <select
                          value={exportDialect}
                          onChange={(e) => setExportDialect(e.target.value as "mysql" | "postgres")}
                          className="mt-1 block rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                        >
                          <option value="mysql">MySQL</option>
                          <option value="postgres">PostgreSQL</option>
                        </select>
                      </label>
                      <label className="text-[11px] text-[var(--color-text-secondary)]">
                        Nome do banco (opcional)
                        <input
                          type="text"
                          value={exportDatabase}
                          onChange={(e) => setExportDatabase(e.target.value)}
                          placeholder={exportDialect === "mysql" ? "CREATE DATABASE..." : "CREATE SCHEMA..."}
                          className="mt-1 block w-48 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={downloadSql}
                        className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
                      >
                        Baixar .sql
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveAsPackage()}
                        disabled={exporting}
                        className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {exporting ? "Salvando..." : "Salvar como migrations"}
                      </button>
                      {exportMessage ? (
                        <p className="w-full text-[11px] text-[var(--color-text-secondary)]">{exportMessage}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="relative mt-2" style={{ height: isFullscreen ? "calc(100vh - 6rem)" : 560 }}>
                    <MigrationDiagram
                      diagram={activeDiagram}
                      diffMap={diffMap}
                      height="100%"
                      showFullscreenButton={false}
                      selectedNodeId={selectedTableId}
                      onSelectedNodeChange={setSelectedTableId}
                    />
                    {isFullscreen ? chatCard(true) : null}
                  </div>
                  {!isFullscreen && diffMap && diffMap.size > 0 ? (
                    <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-secondary)]">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" /> adicionada
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-amber-400" /> alterada
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-rose-400" /> removida
                      </span>
                      <span>(desde a última resposta da IA)</span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })()
        ) : null}
      </section>
      <SchemaEditorTypesDatalist />
    </div>
  );
}

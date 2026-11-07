"use client";

import { BookText, ChevronDown, ChevronLeft, ChevronRight, Columns2, Database, History, Loader2, Maximize2, MessageSquare, Minimize2, PencilRuler, Plus, Redo2, RefreshCw, ShieldAlert, Sparkles, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MarkdownMessage from "@/components/ai-modeling/MarkdownMessage";
import SchemaEditor, { SchemaEditorTypesDatalist } from "@/components/ai-modeling/SchemaEditor";
import MigrationDiagram, { type MigrationDiagramPayload } from "@/components/migrations/MigrationDiagram";
import { computeDiagramDiff } from "@/lib/diagram-diff";
import { LLM_PROVIDER_LABELS, useLlmModels, type LlmModelInfo } from "@/lib/hooks/useLlmModels";
import { documentationCoverage } from "@/lib/schema-documentation";
import { lintDiagram } from "@/lib/schema-linter";
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

/** Largura fixa de cada passo da linha do tempo — base do cálculo de quantos cabem sem scroll. */
const TIMELINE_CHIP_W = 84;
const TIMELINE_GAP = 6;

/** Altura do canvas: acompanha a janela para não empurrar a página, dentro de limites legíveis. */
const DIAGRAM_HEIGHT = "clamp(340px, calc(100vh - 360px), 560px)";
/** Chat lateral: altura do canvas + barra de ações e linha do tempo acima dele. */
const CHAT_HEIGHT = `calc(${DIAGRAM_HEIGHT} + 96px)`;

function opSummary(op: SchemaOp): string {
  switch (op.op) {
    case "createTable":
      return `Criar tabela "${op.table}" (${op.columns.length} coluna(s))`;
    case "addColumn":
      return `Adicionar coluna "${op.newColumn.name}" em "${op.table}"`;
    case "alterColumn":
      return op.newName && op.newName !== op.column
        ? `Renomear/alterar coluna "${op.column}" → "${op.newName}" em "${op.table}"`
        : `Alterar coluna "${op.column}" em "${op.table}"`;
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
    case "createIndex":
      return `Criar índice ${op.isUnique ? "UNIQUE " : ""}"${op.name || op.columns.join("_")}" (${op.columns.join(", ")}) em "${op.table}"`;
    case "dropIndex":
      return `Remover índice "${op.name}" de "${op.table}"`;
    case "setComment":
      return `${op.comment.trim() ? "Comentar" : "Remover comentário de"} ${op.column ? `coluna "${op.table}.${op.column}"` : `tabela "${op.table}"`}`;
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
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportDialect, setExportDialect] = useState<"mysql" | "postgres">("mysql");
  const [exportMode, setExportMode] = useState<"full" | "delta" | "last_turn">("full");
  const [exportDatabase, setExportDatabase] = useState("");
  const [exportDescription, setExportDescription] = useState("");
  const [exportTargetPackageId, setExportTargetPackageId] = useState<string>("");
  const [availablePackages, setAvailablePackages] = useState<Array<{ id: string; name: string; fileCount: number }>>([]);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [lintOpen, setLintOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [documenting, setDocumenting] = useState(false);
  const [docNotice, setDocNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  /** Mensagem já enviada mas ainda sem turno persistido — exibida no chat enquanto a LLM responde. */
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [updatingModel, setUpdatingModel] = useState(false);
  const [revertingOrder, setRevertingOrder] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  /** Gaveta do editor de schema, sobreposta à direita do diagrama (não bloqueia o canvas). */
  const [editorOpen, setEditorOpen] = useState(false);
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

  const createSession = useCallback(async (): Promise<boolean> => {
    if (newSessionName.trim().length < 3) return false;
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
      return true;
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Erro ao criar sessão");
      return false;
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

  useEffect(() => {
    if (!exportOpen) return;
    let active = true;
    fetch(`/api/migrations/${connectionId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((pkgs: Array<{ id: string; name: string; fileCount: number }>) => {
        if (!active || !Array.isArray(pkgs)) return;
        setAvailablePackages(pkgs);
        setExportTargetPackageId((prev) => (prev || (pkgs[0]?.id ?? "")));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [exportOpen, connectionId]);

  const exportQuery = useCallback(() => {
    const params = new URLSearchParams({ dialect: exportDialect, mode: exportMode });
    if (exportDatabase.trim()) params.set("database", exportDatabase.trim());
    if (exportDescription.trim()) params.set("description", exportDescription.trim());
    return params.toString();
  }, [exportDialect, exportMode, exportDatabase, exportDescription]);

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
      const targetPackageId =
        exportMode !== "full" && exportTargetPackageId ? exportTargetPackageId : undefined;
      const res = await fetch(`/api/ai-modeling/${connectionId}/${selectedSessionId}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dialect: exportDialect,
          mode: exportMode,
          database: exportDatabase.trim() || undefined,
          description: exportDescription.trim() || undefined,
          targetPackageId,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        name?: string;
        fileCount?: number;
        appendedFile?: string;
      } | null;
      if (!res.ok) throw new Error(body?.error ?? "Falha ao salvar como migrations");
      if (targetPackageId) {
        setExportMessage(
          `Migration "${body?.appendedFile}" anexada ao package "${body?.name}" (total: ${body?.fileCount} arquivos).`
        );
      } else {
        setExportMessage(`Salvo como package "${body?.name}" (${body?.appendedFile ?? "V1"}) — abra a aba Migrations para ver a timeline.`);
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Erro ao salvar como migrations");
    } finally {
      setExporting(false);
    }
  }, [
    connectionId,
    selectedSessionId,
    exporting,
    exportDialect,
    exportMode,
    exportDatabase,
    exportDescription,
    exportTargetPackageId,
  ]);

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

  const sendMessage = useCallback(async (overrideMessage?: string) => {
    const rawText = typeof overrideMessage === "string" ? overrideMessage : message;
    if (!selectedSessionId || rawText.trim().length === 0 || sending) return;
    const text = rawText.trim();
    setSending(true);
    setSendError(null);
    if (typeof overrideMessage !== "string") {
      setMessage("");
    }
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

  const activeDiagram: MigrationDiagramPayload = useMemo(
    () => detail?.diagram ?? { nodes: [], edges: [], scopes: [] },
    [detail?.diagram]
  );
  const checkpointOrder = detail?.session.checkpointOrder ?? null;
  const lastTurnOrder = detail?.turns.at(-1)?.order ?? null;

  /**
   * Lista de turnos que geraram snapshots de diagrama (respostas da IA ou edições manuais/MCP).
   */
  const checkpointTurns = useMemo(
    () => detail?.turns.filter((t) => t.role === "assistant") ?? [],
    [detail]
  );

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

  const activeCheckpointIdx = useMemo(() => {
    if (!activeTurn) return -1;
    return checkpointTurns.findIndex((t) => t.id === activeTurn.id);
  }, [checkpointTurns, activeTurn]);

  // Linha do tempo sem scroll: mostra só os passos que cabem, ancorada no último. `timelineEnd`
  // null = seguindo o fim (novos passos aparecem sozinhos); número = índice exclusivo do último
  // passo visível enquanto o usuário navega para trás.
  const [timelineCapacity, setTimelineCapacity] = useState(8);
  const [timelineEnd, setTimelineEnd] = useState<number | null>(null);
  const timelineObserverRef = useRef<ResizeObserver | null>(null);
  const timelineChipsRef = useCallback((el: HTMLDivElement | null) => {
    timelineObserverRef.current?.disconnect();
    timelineObserverRef.current = null;
    if (!el) return;
    const measure = () => setTimelineCapacity(Math.max(1, Math.floor((el.clientWidth + TIMELINE_GAP) / (TIMELINE_CHIP_W + TIMELINE_GAP))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    timelineObserverRef.current = observer;
  }, []);

  const totalSteps = checkpointTurns.length;
  let timelineVisibleEnd = Math.min(timelineEnd ?? totalSteps, totalSteps);
  let timelineVisibleStart = Math.max(0, timelineVisibleEnd - timelineCapacity);

  // Mantém o passo ativo visível quando ele muda (desfazer/refazer, novo turno): ajuste feito
  // durante o render, sem efeito, comparando com o último passo ativo visto.
  const [lastSeenActiveIdx, setLastSeenActiveIdx] = useState(activeCheckpointIdx);
  if (lastSeenActiveIdx !== activeCheckpointIdx) {
    setLastSeenActiveIdx(activeCheckpointIdx);
    if (activeCheckpointIdx === totalSteps - 1) {
      setTimelineEnd(null);
    } else if (activeCheckpointIdx >= 0 && activeCheckpointIdx < timelineVisibleStart) {
      setTimelineEnd(Math.min(totalSteps, activeCheckpointIdx + timelineCapacity));
    } else if (activeCheckpointIdx >= timelineVisibleEnd) {
      setTimelineEnd(activeCheckpointIdx + 1 >= totalSteps ? null : activeCheckpointIdx + 1);
    }
  }
  timelineVisibleEnd = Math.max(timelineVisibleEnd, Math.min(totalSteps, timelineCapacity));
  timelineVisibleStart = Math.max(0, timelineVisibleEnd - timelineCapacity);

  const timelineBack = () => setTimelineEnd(Math.max(Math.min(totalSteps, timelineCapacity), timelineVisibleEnd - 1));
  const timelineForward = () => setTimelineEnd(timelineVisibleEnd + 1 >= totalSteps ? null : timelineVisibleEnd + 1);

  const canUndo = activeCheckpointIdx > 0;
  const canRedo = activeCheckpointIdx >= 0 && activeCheckpointIdx < checkpointTurns.length - 1;

  const undoTurn = useCallback(() => {
    if (!canUndo) return;
    const prev = checkpointTurns[activeCheckpointIdx - 1];
    if (prev) void revertToTurn(prev.order);
  }, [canUndo, checkpointTurns, activeCheckpointIdx, revertToTurn]);

  const redoTurn = useCallback(() => {
    if (!canRedo) return;
    const next = checkpointTurns[activeCheckpointIdx + 1];
    if (next) void revertToTurn(next.order);
  }, [canRedo, checkpointTurns, activeCheckpointIdx, revertToTurn]);

  const previousDiagram = useMemo(() => {
    if (!detail || !activeTurn) return undefined;
    const turnIndex = detail.turns.findIndex((t) => t.id === activeTurn.id);
    return turnIndex > 0 ? detail.turns[turnIndex - 1].diagram : null;
  }, [detail, activeTurn]);

  const diffMap = useMemo(() => {
    if (!detail || !activeTurn || previousDiagram === undefined) return undefined;
    return computeDiagramDiff(previousDiagram, activeTurn.diagram);
  }, [detail, activeTurn, previousDiagram]);

  const lintIssues = useMemo(() => lintDiagram(activeDiagram), [activeDiagram]);
  const docCoverage = useMemo(() => documentationCoverage(activeDiagram), [activeDiagram]);

  const documentUndocumented = useCallback(async () => {
    if (!selectedSessionId || sending || documenting || revertingOrder !== null) return;
    setDocumenting(true);
    setDocNotice(null);
    try {
      const res = await fetch(`/api/ai-modeling/${connectionId}/${selectedSessionId}/document`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            error?: string;
            assistantTurn?: unknown;
            commented?: { tables: number; columns: number };
            remainingTables?: number;
            failedBatches?: number;
          }
        | null;
      if (!res.ok) throw new Error(body?.error ?? "Falha ao documentar o modelo");
      if (!body?.assistantTurn) {
        setDocNotice({ tone: "ok", text: "Nada a documentar: todas as tabelas e colunas já têm comentário." });
      } else {
        const parts = [
          `${body.commented?.tables ?? 0} tabela(s) e ${body.commented?.columns ?? 0} coluna(s) documentadas.`,
          body.remainingTables ? `Faltam ${body.remainingTables} tabela(s) — clique de novo para continuar.` : null,
          body.failedBatches ? `${body.failedBatches} lote(s) falharam.` : null,
        ];
        setDocNotice({ tone: "ok", text: parts.filter(Boolean).join(" ") });
      }
      await loadDetail(selectedSessionId);
    } catch (err) {
      setDocNotice({ tone: "error", text: err instanceof Error ? err.message : "Falha ao documentar o modelo" });
    } finally {
      setDocumenting(false);
    }
  }, [connectionId, selectedSessionId, sending, documenting, revertingOrder, loadDetail]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 px-3 py-2 shadow-[var(--shadow-floating)]">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
          <Sparkles className="h-3.5 w-3.5" /> Modelagem IA
        </span>

        <div className="relative">
          <button
            type="button"
            onClick={() => setSessionMenuOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={sessionMenuOpen}
            className="flex h-8 max-w-[280px] items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2.5 text-xs text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
          >
            <span className="text-[var(--color-text-muted)]">Sessão:</span>
            <span className="truncate font-medium">
              {sessions.find((x) => x.id === selectedSessionId)?.name ?? (loadingList ? "carregando..." : "nenhuma")}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
          </button>
          {sessionMenuOpen ? (
            <>
              {/* Camada invisível: clicar fora fecha o menu. */}
              <div className="fixed inset-0 z-40" onClick={() => setSessionMenuOpen(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 w-[320px] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] p-2 shadow-2xl">
                {listError ? <p className="p-2 text-xs text-red-500">{listError}</p> : null}
                {sessions.length === 0 ? (
                  <p className="p-2 text-xs text-[var(--color-text-muted)]">Nenhuma sessão ainda.</p>
                ) : (
                  <ul role="listbox" className="max-h-72 space-y-1 overflow-y-auto">
                    {sessions.map((s) => (
                      <li key={s.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedSessionId === s.id}
                          onClick={() => {
                            setSelectedSessionId(s.id);
                            setSessionMenuOpen(false);
                          }}
                          className={`flex-1 truncate rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                            selectedSessionId === s.id
                              ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)] text-[var(--color-text-primary)]"
                              : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
                          }`}
                        >
                          {s.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeSession(s.id)}
                          title="Remover sessão"
                          aria-label={`Remover sessão ${s.name}`}
                          className="rounded-lg px-2 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:text-rose-400"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setNewSessionOpen(true)}
          className="flex h-8 items-center gap-1 rounded-lg bg-[var(--color-accent)] px-2.5 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))]"
        >
          <Plus className="h-3.5 w-3.5" /> Nova
        </button>

        <p className="ml-auto hidden text-[11px] text-[var(--color-text-muted)] md:block">
          Converse com a IA ou edite direto pelo botão Editar: tudo entra no mesmo histórico.
        </p>
      </header>

      {newSessionOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) setNewSessionOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !creating) setNewSessionOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-session-title"
            className="w-full max-w-sm rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p id="new-session-title" className="text-sm font-semibold text-[var(--color-text-primary)]">
                Nova modelagem
              </p>
              <button
                type="button"
                onClick={() => setNewSessionOpen(false)}
                disabled={creating}
                aria-label="Fechar"
                className="rounded-md p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
              <div className="mt-3 space-y-2">
                <input
                  autoFocus
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !creating && newSessionName.trim().length >= 3) {
                      void createSession().then((ok) => {
                        if (ok) setNewSessionOpen(false);
                      });
                    }
                  }}
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
                  onClick={() =>
                    void createSession().then((ok) => {
                      if (ok) setNewSessionOpen(false);
                    })
                  }
                  disabled={creating || newSessionName.trim().length < 3}
                  className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creating ? "Criando..." : "Nova modelagem"}
                </button>
              </div>
            {listError ? <p className="mt-2 text-xs text-red-500">{listError}</p> : null}
          </div>
        </div>
      ) : null}

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
            const timelineBar =
              checkpointTurns.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/80 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                    <History className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                    <span>Linha do tempo</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={undoTurn}
                      disabled={!canUndo || sending || revertingOrder !== null}
                      title="Desfazer (voltar uma modificação)"
                      className="flex h-6 items-center gap-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 text-[10px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Undo2 className="h-3 w-3" /> Desfazer
                    </button>
                    <button
                      type="button"
                      onClick={redoTurn}
                      disabled={!canRedo || sending || revertingOrder !== null}
                      title="Refazer (avançar uma modificação)"
                      className="flex h-6 items-center gap-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 text-[10px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Redo2 className="h-3 w-3" /> Refazer
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={timelineBack}
                    disabled={timelineVisibleStart === 0}
                    title={
                      timelineVisibleStart > 0
                        ? `Mostrar passo anterior (${timelineVisibleStart} oculto(s) antes)`
                        : "Início da linha do tempo"
                    }
                    aria-label="Mostrar passo anterior da linha do tempo"
                    className="flex h-6 shrink-0 items-center gap-0.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-1.5 text-[10px] text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    {timelineVisibleStart > 0 ? <span>{timelineVisibleStart}</span> : null}
                  </button>
                  <div ref={timelineChipsRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-0.5">
                    {checkpointTurns.slice(timelineVisibleStart, timelineVisibleEnd).map((step, sliceIdx) => {
                      const idx = timelineVisibleStart + sliceIdx;
                      const isActiveStep = activeTurn?.id === step.id;
                      const isFutureStep = checkpointOrder !== null && step.order > checkpointOrder;
                      const opCount = step.operations.length;
                      const stepTooltip =
                        opCount > 0
                          ? `Passo #${idx + 1}: ${step.operations.map(opSummary).join(" · ")}`
                          : `Passo #${idx + 1}: Discussão (sem alterações no schema)`;
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => {
                            if (!isActiveStep) void revertToTurn(step.order);
                          }}
                          disabled={sending || revertingOrder !== null}
                          title={stepTooltip}
                          style={{ width: TIMELINE_CHIP_W }}
                          className={`flex shrink-0 items-center justify-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition ${
                            isActiveStep
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-text-inverse)] shadow-sm"
                              : isFutureStep
                                ? "border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/40 text-[var(--color-text-muted)] opacity-60 hover:opacity-100"
                                : "border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                          }`}
                        >
                          {revertingOrder === step.order ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : null}
                          <span>#{idx + 1}</span>
                          <span className="opacity-80">
                            {opCount > 0 ? `(${opCount} op${opCount > 1 ? "s" : ""})` : "(chat)"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={timelineForward}
                    disabled={timelineVisibleEnd >= totalSteps}
                    title={
                      timelineVisibleEnd < totalSteps
                        ? `Mostrar próximo passo (${totalSteps - timelineVisibleEnd} oculto(s) depois)`
                        : "Último passo visível"
                    }
                    aria-label="Mostrar próximo passo da linha do tempo"
                    className="flex h-6 shrink-0 items-center gap-0.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-1.5 text-[10px] text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {timelineVisibleEnd < totalSteps ? <span>{totalSteps - timelineVisibleEnd}</span> : null}
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              ) : null;

            const chatCard = (mode: "sidebar" | "floating" | "modal") => (
              <div
                className={
                  mode === "modal"
                    ? "flex h-full w-full flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] p-5 shadow-2xl"
                    : mode === "floating"
                      ? "absolute bottom-4 right-4 top-4 z-20 flex w-[360px] flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/90 p-4 shadow-2xl backdrop-blur-md"
                      : "flex flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-4 shadow-[var(--shadow-floating)]"
                }
                style={mode === "sidebar" ? { height: CHAT_HEIGHT } : undefined}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                      {detail.session.name}
                    </p>
                    {discussOnly ? (
                      <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
                        Modo discussão
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
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
                    {mode === "modal" ? (
                      <button
                        type="button"
                        onClick={() => setChatModalOpen(false)}
                        title="Voltar ao chat lateral para visualizar modificações no diagrama"
                        className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:opacity-90"
                      >
                        <Columns2 className="h-3.5 w-3.5" />
                        Voltar ao chat lateral / Ver modificações
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setChatModalOpen(true)}
                        title="Expandir chat em tela ampla (ideal para leitura em Markdown e modo discussão)"
                        className="flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                      >
                        <Maximize2 className="h-3 w-3" />
                        Expandir chat
                      </button>
                    )}
                  </div>
                </div>
                {mode === "modal" && timelineBar ? <div className="mt-3">{timelineBar}</div> : null}
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
                          className={`group rounded-xl border px-3 py-2 ${mode === "modal" ? "text-sm" : "text-xs"} transition ${
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
                          {turn.role === "assistant" ? (
                            <MarkdownMessage content={turn.message} className="mt-1" />
                          ) : (
                            <p className="mt-1 whitespace-pre-wrap">{turn.message}</p>
                          )}
                          {turn.operations.length > 0 ? (
                            <div className="mt-2 space-y-1 border-t border-[var(--color-border-subtle)] pt-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                                  Modificações aplicadas ({turn.operations.length})
                                </span>
                                {mode === "modal" ? (
                                  <button
                                    type="button"
                                    onClick={() => setChatModalOpen(false)}
                                    className="text-[10px] font-medium text-[var(--color-accent)] hover:underline"
                                  >
                                    Ver no diagrama →
                                  </button>
                                ) : null}
                              </div>
                              <ul className="space-y-1">
                                {turn.operations.map((op, idx) => (
                                  <li key={idx} className="font-mono text-[10px] text-[var(--color-accent)]">
                                    {opSummary(op)}
                                  </li>
                                ))}
                              </ul>
                            </div>
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
                          <div className="mt-1">
                            <MarkdownMessage content={streamingReply} />
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={discussOnly}
                        onChange={(e) => setDiscussOnly(e.target.checked)}
                        className="accent-[var(--color-accent)]"
                      />
                      Só discutir (não altera o diagrama)
                    </label>
                    {discussOnly && mode !== "modal" ? (
                      <button
                        type="button"
                        onClick={() => setChatModalOpen(true)}
                        className="flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300 transition hover:border-cyan-400"
                      >
                        <MessageSquare className="h-3 w-3" />
                        Abrir discussão em modal amplo
                      </button>
                    ) : null}
                  </div>
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
                    rows={mode === "modal" ? 3 : 2}
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
              <>
                {chatModalOpen ? (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm md:p-6">
                    <div className="h-[92vh] w-full max-w-6xl">{chatCard("modal")}</div>
                  </div>
                ) : null}
                <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
                  {!isFullscreen ? chatCard("sidebar") : null}

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
                        {activeDiagram.nodes.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setLintOpen((v) => !v)}
                            title="Analisar qualidade estrutural do schema (PKs, FKs, tipos e nomenclatura)"
                            className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] transition ${
                              lintIssues.length > 0
                                ? "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:border-amber-400"
                                : "border-[var(--color-border-subtle)] text-emerald-400 hover:border-emerald-400"
                            }`}
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            {lintIssues.length > 0 ? `Linter (${lintIssues.length})` : "Schema OK"}
                          </button>
                        ) : null}
                        {activeDiagram.nodes.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => void documentUndocumented()}
                            disabled={documenting || sending || revertingOrder !== null || docCoverage.gaps.length === 0}
                            title={
                              docCoverage.gaps.length === 0
                                ? "Todas as tabelas e colunas já estão documentadas"
                                : `A IA da sessão escreve comentários só para o que ainda não tem (${docCoverage.gaps.length} tabela(s) com lacunas; ` +
                                  `${docCoverage.documentedTables}/${docCoverage.tables} tabelas documentadas). Vira um passo desfazível na linha do tempo.` +
                                  (checkpointOrder !== null ? " Atenção: você está num checkpoint antigo — os passos à frente serão descartados." : "")
                            }
                            className="flex h-7 items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 text-[11px] text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {documenting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookText className="h-3.5 w-3.5" />}
                            {documenting
                              ? "Documentando..."
                              : docCoverage.gaps.length > 0
                                ? `Documentar (${docCoverage.gaps.length})`
                                : "Documentado"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setEditorOpen((v) => !v)}
                          aria-pressed={editorOpen}
                          title="Editar tabelas, colunas, FKs e comentários manualmente (clique nas tabelas do diagrama para trocar)"
                          className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] transition ${
                            editorOpen
                              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                              : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                          }`}
                        >
                          <PencilRuler className="h-3.5 w-3.5" /> Editar
                        </button>
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

                  {timelineBar}

                  {docNotice ? (
                    <div
                      className={`flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                        docNotice.tone === "ok"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-red-500/40 bg-red-500/10 text-red-300"
                      }`}
                    >
                      <span>{docNotice.text}</span>
                      <button type="button" onClick={() => setDocNotice(null)} className="opacity-70 hover:opacity-100" title="Fechar">
                        ×
                      </button>
                    </div>
                  ) : null}

                  {lintOpen && activeDiagram.nodes.length > 0 ? (
                    <div className="space-y-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                          Diagnóstico de Qualidade do Schema ({lintIssues.length})
                        </p>
                        {lintIssues.length > 1 ? (
                          <button
                            type="button"
                            disabled={sending}
                            onClick={() => {
                              const combined = lintIssues.map((i) => `- ${i.suggestedPrompt}`).join("\n");
                              void sendMessage(`Corrija os seguintes pontos identificados no schema:\n${combined}`);
                            }}
                            className="flex items-center gap-1 rounded-lg bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-inverse)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Sparkles className="h-3 w-3" /> Corrigir todos com IA
                          </button>
                        ) : null}
                      </div>
                      {lintIssues.length === 0 ? (
                        <p className="text-xs text-emerald-400">
                          Nenhum problema estrutural detectado: todas as tabelas possuem chave primária, FKs íntegras e tipos compatíveis.
                        </p>
                      ) : (
                        <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1 text-xs">
                          {lintIssues.map((issue) => (
                            <li
                              key={issue.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/60 px-2.5 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                                      issue.severity === "error"
                                        ? "bg-rose-400"
                                        : issue.severity === "warning"
                                          ? "bg-amber-400"
                                          : "bg-cyan-400"
                                    }`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTableId(issue.tableId)}
                                    className="truncate font-semibold text-[var(--color-text-primary)] hover:underline"
                                  >
                                    {issue.title}
                                  </button>
                                </div>
                                <p className="mt-0.5 pl-3.5 text-[11px] text-[var(--color-text-muted)]">
                                  {issue.description}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={sending}
                                onClick={() => void sendMessage(issue.suggestedPrompt)}
                                className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[11px] text-[var(--color-accent)] transition hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Sparkles className="h-3 w-3" /> Corrigir com IA
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}

                  {exportOpen && activeDiagram.nodes.length > 0 ? (
                    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-3">
                      <label className="text-[11px] text-[var(--color-text-secondary)]">
                        Escopo do SQL
                        <select
                          value={exportMode}
                          onChange={(e) => setExportMode(e.target.value as "full" | "delta" | "last_turn")}
                          className="mt-1 block rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                        >
                          <option value="full">Schema completo (CREATE TABLE)</option>
                          <option value="delta">Migration incremental da sessão (ALTER / CREATE)</option>
                          <option value="last_turn">Apenas último turno</option>
                        </select>
                      </label>
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
                          className="mt-1 block w-40 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                        />
                      </label>
                      {exportMode !== "full" ? (
                        <>
                          <label className="text-[11px] text-[var(--color-text-secondary)]">
                            Descrição da migration (opcional)
                            <input
                              type="text"
                              value={exportDescription}
                              onChange={(e) => setExportDescription(e.target.value)}
                              placeholder="ex: add_cpf_clientes"
                              className="mt-1 block w-44 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                            />
                          </label>
                          {availablePackages.length > 0 ? (
                            <label className="text-[11px] text-[var(--color-text-secondary)]">
                              Destino em Migrations
                              <select
                                value={exportTargetPackageId}
                                onChange={(e) => setExportTargetPackageId(e.target.value)}
                                className="mt-1 block rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                              >
                                {availablePackages.map((pkg) => (
                                  <option key={pkg.id} value={pkg.id}>
                                    Anexar V{pkg.fileCount + 1} em &quot;{pkg.name}&quot;
                                  </option>
                                ))}
                                <option value="">Criar novo package (V1)</option>
                              </select>
                            </label>
                          ) : null}
                        </>
                      ) : null}
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
                        {exporting
                          ? "Salvando..."
                          : exportMode !== "full" && exportTargetPackageId
                            ? "Anexar ao package"
                            : "Salvar como migrations"}
                      </button>
                      {exportMessage ? (
                        <p className="w-full text-[11px] text-[var(--color-text-secondary)]">{exportMessage}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="relative mt-2" style={{ height: isFullscreen ? "calc(100vh - 6rem)" : DIAGRAM_HEIGHT }}>
                    <MigrationDiagram
                      diagram={activeDiagram}
                      previousDiagram={previousDiagram}
                      diffMap={diffMap}
                      height="100%"
                      showFullscreenButton={false}
                      selectedNodeId={selectedTableId}
                      onSelectedNodeChange={setSelectedTableId}
                      hideNodePanel={editorOpen}
                      onEditNode={(nodeId) => {
                        setSelectedTableId(nodeId);
                        setEditorOpen(true);
                      }}
                    />
                    {editorOpen ? (
                      <div className="absolute bottom-0 right-0 top-12 z-30 w-[360px] max-w-[calc(100%-1rem)] overflow-y-auto rounded-2xl">
                        <SchemaEditor
                          diagram={detail.diagram}
                          disabled={sending || documenting || revertingOrder !== null}
                          selectedTableId={selectedTableId}
                          onSelectTable={setSelectedTableId}
                          onApply={applyManualOps}
                          onClose={() => setEditorOpen(false)}
                        />
                      </div>
                    ) : null}
                    {isFullscreen ? chatCard("floating") : null}
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
              </>
            );
          })()
        ) : null}
      </section>
      <SchemaEditorTypesDatalist />
    </div>
  );
}

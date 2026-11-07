"use client";

import { Check, Copy, KeyRound, Plug, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { McpStatus } from "@/lib/services/mcp-status";

const REFRESH_MS = 30_000;

const STATE_STYLE: Record<McpStatus["http"]["state"], { dot: string; label: string; text: string }> = {
  online: { dot: "bg-emerald-400", label: "Online", text: "text-emerald-400" },
  offline: { dot: "bg-slate-500", label: "Offline", text: "text-[var(--color-text-muted)]" },
  misconfigured: { dot: "bg-amber-400", label: "Sem token", text: "text-amber-400" },
};

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-primary)]" title={value}>
        {value}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        title="Copiar"
        aria-label={`Copiar ${label}`}
        className="shrink-0 rounded p-0.5 text-[var(--color-text-muted)] transition hover:text-[var(--color-accent)]"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm text-[var(--color-text-primary)]">{children}</div>
    </div>
  );
}

/** Card da página inicial: o servidor MCP está no ar? em que endereço? precisa de token? */
export default function McpStatusCard() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcp/status", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (McpStatus & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? "Falha ao verificar o MCP");
      setStatus(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao verificar o MCP");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const http = status?.http;
  const style = http ? STATE_STYLE[http.state] : null;
  const scope = status?.scope;
  const addCommand = http
    ? `claude mcp add --transport http diagram-viewer ${http.url} --header "Authorization: Bearer <MCP_HTTP_TOKEN>"`
    : "";

  return (
    <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/70 p-6 shadow-[var(--shadow-floating)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">
            <Plug className="h-3.5 w-3.5" /> Servidor MCP
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">Agentes externos (Claude Code, Cursor...)</h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Expõe as tools de modelagem (sessões, diagrama, operações, documentação, exportação de SQL).
          </p>
        </div>
        <div className="flex items-center gap-3">
          {style && http ? (
            <span className={`flex items-center gap-2 text-sm font-semibold ${style.text}`} title={http.detail}>
              <span className={`h-2.5 w-2.5 rounded-full ${style.dot} ${http.state === "online" ? "animate-pulse" : ""}`} />
              {style.label}
              {http.latencyMs !== null ? (
                <span className="text-[11px] font-normal text-[var(--color-text-muted)]">{http.latencyMs} ms</span>
              ) : null}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title="Verificar agora"
            aria-label="Verificar status do MCP agora"
            className="rounded-lg border border-[var(--color-border-subtle)] p-2 text-[var(--color-text-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error ? <p className="mt-4 text-xs text-red-500">{error}</p> : null}

      {http && scope ? (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-[var(--color-text-secondary)]">{http.detail}</p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Transporte HTTP">
              <span className="font-mono text-xs">
                {http.host}:{http.port}
              </span>
            </Fact>
            <Fact label="Token de acesso (HTTP)">
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                Obrigatório
              </span>
              <span className={`mt-0.5 block text-[11px] ${http.tokenConfigured ? "text-emerald-400" : "text-amber-400"}`}>
                {!http.tokenConfigured
                  ? "MCP_HTTP_TOKEN não definido"
                  : http.tokenCount
                    ? `${http.tokenCount} token(s) em MCP_HTTP_TOKEN`
                    : "Configurado no servidor"}
              </span>
            </Fact>
            <Fact label="Transporte stdio">
              <span className="text-xs">Sem token: o cliente inicia o processo</span>
              <span className="mt-0.5 block font-mono text-[11px] text-[var(--color-text-muted)]">{status.stdio.startCommand}</span>
            </Fact>
            <Fact label="Escopo">
              <span className="block text-xs">
                {scope.allowedConnections.length > 0
                  ? `Conexões: ${scope.allowedConnections.join(", ")}`
                  : "Todas as conexões do usuário"}
              </span>
              <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">
                {scope.allowedEnvironments.length > 0
                  ? `Ambientes: ${scope.allowedEnvironments.join(", ")}`
                  : scope.requireEnvironmentTag
                    ? "Exige tag de ambiente"
                    : "Qualquer ambiente"}
                {scope.userIdPinned ? " · usuário fixo (MCP_USER_ID)" : ""}
              </span>
            </Fact>
          </div>

          <div className="space-y-2">
            <CopyLine label="URL" value={http.url} />
            <CopyLine label="Claude Code" value={addCommand} />
            {http.state !== "online" ? <CopyLine label="Iniciar" value={http.startCommand} /> : null}
          </div>

          {http.allowedHosts.length > 0 ? (
            <p className="text-[11px] text-[var(--color-text-muted)]">Hosts aceitos: {http.allowedHosts.join(", ")}</p>
          ) : null}
          <p className="text-[11px] text-[var(--color-text-muted)]">
            Verificado {new Date(status.checkedAt).toLocaleTimeString()} · atualiza a cada {REFRESH_MS / 1000}s. O valor do
            token nunca é exibido aqui.
          </p>
        </div>
      ) : null}
    </section>
  );
}

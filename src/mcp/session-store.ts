/**
 * Estado sticky do MCP (conexão/sessão ativa). Isolado por sessionId do transporte —
 * no stdio o id é o processo; no HTTP Streamable cada cliente MCP tem o seu.
 * Sem isso, dois agentes HTTP compartilhariam a mesma conexão ativa.
 */

export type StickyState = {
  ownerId: string | null;
  activeConnectionId: string | null;
  activeSession: { connectionId: string; sessionId: string } | null;
};

const DEFAULT_KEY = "stdio";

const store = new Map<string, StickyState>();

export function sessionKey(sessionId?: string | null): string {
  const trimmed = sessionId?.trim();
  return trimmed || DEFAULT_KEY;
}

export function getStickyState(sessionId?: string | null): StickyState {
  const key = sessionKey(sessionId);
  const existing = store.get(key);
  if (existing) return existing;
  const created: StickyState = {
    ownerId: null,
    activeConnectionId: process.env.MCP_CONNECTION_ID?.trim() || null,
    activeSession: null,
  };
  store.set(key, created);
  return created;
}

export function dropStickyState(sessionId?: string | null): void {
  store.delete(sessionKey(sessionId));
}

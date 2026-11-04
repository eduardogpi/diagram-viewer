import { createHash } from "node:crypto";

/**
 * Rate-limit em memória (janela deslizante) por chave.
 * Suficiente para single-instance; para multi-instance use Redis/Upstash.
 * Configurável via RATE_LIMIT_* env vars. Falha aberta: nunca bloqueia por erro interno.
 */
type Bucket = { timestamps: number[] };
const store = new Map<string, Bucket>();

const DEFAULTS = {
  sql: { max: Number(process.env.RATE_LIMIT_SQL_MAX ?? 30), windowMs: Number(process.env.RATE_LIMIT_SQL_WINDOW_MS ?? 60_000) },
  connections: { max: Number(process.env.RATE_LIMIT_CONNECTIONS_MAX ?? 10), windowMs: Number(process.env.RATE_LIMIT_CONNECTIONS_WINDOW_MS ?? 60_000) },
  ai: { max: Number(process.env.RATE_LIMIT_AI_MAX ?? 10), windowMs: Number(process.env.RATE_LIMIT_AI_WINDOW_MS ?? 60_000) },
} as const;

export type RateLimitKind = keyof typeof DEFAULTS;

function prune(key: string, now: number, windowMs: number) {
  const bucket = store.get(key);
  if (!bucket) return [];
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length === 0) store.delete(key);
  return bucket.timestamps;
}

export function rateLimit(kind: RateLimitKind, key: string): { allowed: boolean; retryAfterMs?: number } {
  try {
    const { max, windowMs } = DEFAULTS[kind];
    if (!Number.isFinite(max) || max <= 0) return { allowed: true };
    const now = Date.now();
    const fullKey = `${kind}:${key}`;
    const timestamps = prune(fullKey, now, windowMs);
    if (timestamps.length >= max) {
      const oldest = timestamps[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
    }
    const bucket = store.get(fullKey) ?? { timestamps: [] };
    bucket.timestamps.push(now);
    store.set(fullKey, bucket);
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

/** Hash de SQL para o histórico/auditoria — sem armazenar literais (PII). */
export function hashSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

/** Resuma o SQL para exibição no histórico sem literais sensíveis. */
export function summarizeSql(sql: string, maxLen = 120): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  // Remove literais de string para não vazar PII no histórico exibido
  const redacted = normalized.replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"');
  return redacted.length > maxLen ? `${redacted.slice(0, maxLen)}…` : redacted;
}

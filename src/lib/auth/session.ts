import { createHmac, timingSafeEqual } from "crypto";

import { cookies, headers } from "next/headers";

const USER_COOKIE_NAME = "workbench_user_id";
const USER_HEADER_NAME = "x-user-id";

/** Duração padrão da sessão assinada (30 dias). */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function getSigningSecret(): Buffer {
  const secret = process.env.SECRET_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("SECRET_ENCRYPTION_KEY is not set");
  }
  return Buffer.from(secret, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", getSigningSecret()).update(payload).digest("base64url");
}

/**
 * Assina um userId no formato `userId.exp.hmac` (exp = epoch seconds).
 * O HMAC é calculado sobre `userId.exp`, então adulterar qualquer parte
 * invalida a assinatura.
 */
export function signSessionCookie(userId: string, ttlSeconds = SESSION_TTL_SECONDS): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: ttlSeconds };
}

/** Verifica assinatura e expiração; devolve o userId ou null. */
export function verifySessionCookie(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Formato legado (sem assinatura): aceito apenas fora de produção para não
  // derrubar sessões existentes de desenvolvimento.
  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return process.env.NODE_ENV === "production" ? null : trimmed || null;
  }
  const [userId, expRaw, signature] = parts;
  if (!userId || !expRaw || !signature) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;

  const payload = `${userId}.${expRaw}`;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return userId;
}

export async function getCurrentUserId() {
  const headerStore = await headers();
  const headerUserId = headerStore.get(USER_HEADER_NAME)?.trim();
  // O header só é confiável quando injetado pelo próprio middleware (que já
  // validou o cookie assinado). Em produção, header sem cookie é ignorado.
  if (headerUserId) {
    // Middleware always sets both; if cookie exists, prefer verified cookie value
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(USER_COOKIE_NAME)?.value;
    if (cookieValue) {
      return verifySessionCookie(cookieValue) ?? null;
    }
    // No cookie but header present: only trust in non-production (dev proxy) or
    // when running behind a trusted reverse proxy that strips external x-user-id.
    return process.env.NODE_ENV === "production" ? null : headerUserId;
  }

  const cookieStore = await cookies();
  const cookieUserId = cookieStore.get(USER_COOKIE_NAME)?.value;
  return verifySessionCookie(cookieUserId);
}

export async function requireCurrentUserId() {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("UNAUTHENTICATED");
  }
  return userId;
}

export { USER_COOKIE_NAME, USER_HEADER_NAME, SESSION_TTL_SECONDS };

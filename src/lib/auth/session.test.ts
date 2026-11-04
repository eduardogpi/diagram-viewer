import { beforeEach, describe, expect, it } from "vitest";

import { signSessionCookie, verifySessionCookie } from "./session";

describe("session cookie assinado", () => {
  // Garante chave presente para os testes
  beforeEach(() => {
    if (!process.env.SECRET_ENCRYPTION_KEY) {
      process.env.SECRET_ENCRYPTION_KEY = "test-secret-for-unit-tests-1234567890";
    }
  });

  it("round-trip válido", () => {
    const { value } = signSessionCookie("user-123");
    expect(verifySessionCookie(value)).toBe("user-123");
  });

  it("rejeita cookie adulterado", () => {
    const { value } = signSessionCookie("user-123");
    const tampered = value.replace("user-123", "admin-999");
    expect(verifySessionCookie(tampered)).toBeNull();
  });

  it("rejeita cookie expirado", () => {
    const { value } = signSessionCookie("user-123", -10);
    expect(verifySessionCookie(value)).toBeNull();
  });

  it("rejeita valor vazio", () => {
    expect(verifySessionCookie("")).toBeNull();
    expect(verifySessionCookie(null)).toBeNull();
  });

  it("rejeita em produção formato legado sem assinatura", () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(verifySessionCookie("plain-user-id")).toBeNull();
    (process.env as Record<string, string>).NODE_ENV = prev as string;
  });
});

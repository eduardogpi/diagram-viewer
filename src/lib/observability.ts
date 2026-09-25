import { logger } from "@/lib/logger";

/**
 * Observabilidade leve: métricas e tracing básicos emitidos como logs estruturados.
 * Não substitui um APM, mas dá duração/erro por operação sem infra extra.
 */

export function recordMetric(name: string, value = 1, tags: Record<string, unknown> = {}) {
  logger.info({ metric: name, value, ...tags }, `metric:${name}`);
}

/** Executa `fn` medindo a duração e registrando sucesso/erro (tracing básico). */
export async function withTracing<T>(
  name: string,
  fn: () => Promise<T>,
  tags: Record<string, unknown> = {}
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    recordMetric(`${name}.duration_ms`, Date.now() - startedAt, { outcome: "ok", ...tags });
    return result;
  } catch (error) {
    recordMetric(`${name}.duration_ms`, Date.now() - startedAt, { outcome: "error", ...tags });
    throw error;
  }
}

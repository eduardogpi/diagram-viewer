import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = process.env.NODE_ENV === "development";

/**
 * Logger estruturado da aplicação (pino). Em produção emite JSON em uma linha
 * (pronto para agregadores); em desenvolvimento usa pino-pretty para leitura humana.
 * Fora de desenvolvimento evita o transport (worker thread) — testes e produção
 * ficam com o logger síncrono.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  base: { service: "workbench-web" },
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname,service" },
        },
      }
    : {}),
});

/** Logger filho com contexto fixo (ex: módulo/rota). */
export function createLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

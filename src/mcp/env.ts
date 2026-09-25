import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Carrega o .env da raiz do projeto ANTES de qualquer import de lib (Prisma, LLM, crypto).
 * Este módulo não pode importar nada de "@/" — ele roda antes do resto do servidor.
 */
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));

function loadEnvFile(): void {
  try {
    // Node 20.12+: carrega sem sobrescrever variáveis já presentes no ambiente.
    (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile?.(envPath);
  } catch {
    // fallback manual abaixo
  }
  if (process.env.DATABASE_URL || !existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

loadEnvFile();

// Logs de query do Prisma iriam para o stdout e corromperiam o protocolo stdio do MCP.
(process.env as Record<string, string | undefined>).NODE_ENV = process.env.NODE_ENV ?? "production";

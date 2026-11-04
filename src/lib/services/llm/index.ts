import { logger } from "@/lib/logger";
import { HttpError } from "@/lib/errors";
import {
  generateTextWithGemini,
  listGeminiModels,
  streamSchemaOpsWithGemini,
} from "@/lib/services/llm/gemini";
import {
  generateTextWithNvidia,
  listNvidiaModels,
  streamSchemaOpsWithNvidia,
} from "@/lib/services/llm/nvidia";
import {
  generateTextWithOpenRouter,
  listOpenRouterModels,
  streamSchemaOpsWithOpenRouter,
} from "@/lib/services/llm/openrouter";
import type {
  LlmModelInfo,
  LlmStreamCallback,
  LlmTextInput,
  LlmTextResult,
  LlmTurnInput,
} from "@/lib/services/llm/shared";
import type { SchemaOpsResponse } from "@/lib/services/schema-ops";

export type { LlmModelInfo, LlmStreamCallback, LlmTextInput, LlmTextResult, LlmTurnInput };

export const LLM_PROVIDERS = ["gemini", "openrouter", "nvidia"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export function isLlmProvider(value: string): value is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

function isProviderConfigured(provider: LlmProvider): boolean {
  switch (provider) {
    case "gemini":
      return !!process.env.GEMINI_API_KEY;
    case "openrouter":
      return !!process.env.OPENROUTER_API_KEY;
    case "nvidia":
      return !!process.env.NVIDIA_API_KEY;
  }
}

/** Provedores com chave de API configurada no ambiente atual. */
export function availableLlmProviders(): LlmProvider[] {
  return LLM_PROVIDERS.filter(isProviderConfigured);
}

/** Provedor padrão pra novas sessões: LLM_PROVIDER (se configurado) ou o primeiro disponível. */
export function currentLlmProvider(): LlmProvider {
  const envProvider = process.env.LLM_PROVIDER;
  if (envProvider && isLlmProvider(envProvider) && isProviderConfigured(envProvider)) {
    return envProvider;
  }
  return availableLlmProviders()[0] ?? "gemini";
}

/** Ponto único de entrada pra geração de operações de schema — um provedor por sessão. */
export async function generateSchemaOps(
  provider: LlmProvider,
  input: LlmTurnInput
): Promise<SchemaOpsResponse> {
  return streamSchemaOps(provider, input);
}

/** Geração de operações de schema com suporte a streaming em tempo real do campo reply. */
export async function streamSchemaOps(
  provider: LlmProvider,
  input: LlmTurnInput,
  onReplyDelta?: LlmStreamCallback
): Promise<SchemaOpsResponse> {
  switch (provider) {
    case "gemini":
      return streamSchemaOpsWithGemini(input, onReplyDelta);
    case "openrouter":
      return streamSchemaOpsWithOpenRouter(input, onReplyDelta);
    case "nvidia":
      return streamSchemaOpsWithNvidia(input, onReplyDelta);
    default:
      throw new Error(`Provedor de LLM "${provider}" ainda não suportado`);
  }
}

/** Geração de texto livre (sem o formato JSON de operações) — resumos, explicações, etc. */
export async function generateText(provider: LlmProvider, input: LlmTextInput): Promise<LlmTextResult> {
  switch (provider) {
    case "gemini":
      return generateTextWithGemini(input);
    case "openrouter":
      return generateTextWithOpenRouter(input);
    case "nvidia":
      return generateTextWithNvidia(input);
    default:
      throw new Error(`Provedor de LLM "${provider}" ainda não suportado`);
  }
}

/**
 * Resolve o par provedor/modelo para uma geração avulsa. Se o provedor não vier (ou não estiver
 * configurado), cai no provedor padrão do ambiente; se o modelo não vier, usa o primeiro modelo
 * disponível daquele provedor.
 */
export async function resolveLlmTarget(
  provider?: string,
  model?: string
): Promise<{ provider: LlmProvider; model: string }> {
  const resolvedProvider =
    provider && isLlmProvider(provider) && isProviderConfigured(provider) ? provider : currentLlmProvider();

  if (model) {
    return { provider: resolvedProvider, model };
  }

  const models = await listLlmModels();
  const match = models.find((m) => m.provider === resolvedProvider);
  if (!match) {
    throw new HttpError(
      400,
      "Nenhum modelo disponível. Configure uma chave de API (GEMINI_API_KEY, OPENROUTER_API_KEY ou NVIDIA_API_KEY) e tente de novo."
    );
  }
  return { provider: resolvedProvider, model: match.id };
}

export type LlmModelInfoWithProvider = LlmModelInfo & { provider: LlmProvider };

let cachedModels: { expiresAt: number; data: LlmModelInfoWithProvider[] } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Lista os modelos de TODOS os provedores configurados (chave presente no .env), em paralelo com cache em memória (TTL 15 min). */
export async function listLlmModels(forceRefresh = false): Promise<LlmModelInfoWithProvider[]> {
  if (!forceRefresh && cachedModels && Date.now() < cachedModels.expiresAt) {
    return cachedModels.data;
  }

  const providers = availableLlmProviders();

  const results = await Promise.allSettled(
    providers.map(async (provider): Promise<LlmModelInfoWithProvider[]> => {
      const models =
        provider === "gemini"
          ? await listGeminiModels()
          : provider === "openrouter"
            ? await listOpenRouterModels()
            : await listNvidiaModels();
      return models.map((m) => ({ ...m, provider }));
    })
  );

  const data = results.flatMap((result) => {
    if (result.status === "fulfilled") return result.value;
    logger.error({ err: result.reason }, "falha ao listar modelos de um provedor");
    return [];
  });

  if (data.length > 0) {
    cachedModels = { expiresAt: Date.now() + CACHE_TTL_MS, data };
  }

  return data;
}

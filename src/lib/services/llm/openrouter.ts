import {
  listOpenAiCompatibleModels,
  streamOpenAiCompatible,
} from "@/lib/services/llm/openai-compatible";
import type { LlmModelInfo, LlmStreamCallback, LlmTurnInput } from "@/lib/services/llm/shared";
import type { SchemaOpsResponse } from "@/lib/services/schema-ops";

const BASE_URL = "https://openrouter.ai/api/v1";
/** Modelos gratuitos no OpenRouter costumam ser bem mais lentos que os pagos. */
const TIMEOUT_MS = 120_000;

function getApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY não configurada");
  }
  return apiKey;
}

function headers(): Record<string, string> {
  return {
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    "X-Title": "Workbench Web - Modelagem IA",
  };
}

export async function listOpenRouterModels(): Promise<LlmModelInfo[]> {
  return listOpenAiCompatibleModels({ baseUrl: BASE_URL, apiKey: getApiKey(), extraHeaders: headers() });
}

export async function generateSchemaOpsWithOpenRouter(input: LlmTurnInput): Promise<SchemaOpsResponse> {
  return streamSchemaOpsWithOpenRouter(input);
}

export async function streamSchemaOpsWithOpenRouter(
  input: LlmTurnInput,
  onReplyDelta?: LlmStreamCallback
): Promise<SchemaOpsResponse> {
  return streamOpenAiCompatible(
    {
      ...input,
      baseUrl: BASE_URL,
      apiKey: getApiKey(),
      extraHeaders: headers(),
      timeoutMs: TIMEOUT_MS,
    },
    onReplyDelta
  );
}

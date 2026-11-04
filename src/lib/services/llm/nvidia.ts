import {
  generateTextOpenAiCompatible,
  listOpenAiCompatibleModels,
  streamOpenAiCompatible,
} from "@/lib/services/llm/openai-compatible";
import type {
  LlmModelInfo,
  LlmStreamCallback,
  LlmTextInput,
  LlmTextResult,
  LlmTurnInput,
} from "@/lib/services/llm/shared";
import type { SchemaOpsResponse } from "@/lib/services/schema-ops";

const BASE_URL = "https://integrate.api.nvidia.com/v1";
const TIMEOUT_MS = 120_000;
const EXCLUDED_PATTERN = /embed|guard|reward|moderation|clip|rerank/i;

function getApiKey(): string {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY não configurada");
  }
  return apiKey;
}

export async function listNvidiaModels(): Promise<LlmModelInfo[]> {
  const models = await listOpenAiCompatibleModels({ baseUrl: BASE_URL, apiKey: getApiKey() });
  // O catálogo NIM da NVIDIA não expõe "name"/descrição — só vem o id, e mistura alguns
  // modelos que não servem pra chat (embedding, reranking, guardrails).
  return models.filter((m) => !EXCLUDED_PATTERN.test(m.id));
}

export async function generateSchemaOpsWithNvidia(input: LlmTurnInput): Promise<SchemaOpsResponse> {
  return streamSchemaOpsWithNvidia(input);
}

export async function streamSchemaOpsWithNvidia(
  input: LlmTurnInput,
  onReplyDelta?: LlmStreamCallback
): Promise<SchemaOpsResponse> {
  return streamOpenAiCompatible(
    {
      ...input,
      baseUrl: BASE_URL,
      apiKey: getApiKey(),
      timeoutMs: TIMEOUT_MS,
    },
    onReplyDelta
  );
}

/** Geração de texto livre (resumos/explicações) via NVIDIA NIM. */
export async function generateTextWithNvidia(input: LlmTextInput): Promise<LlmTextResult> {
  return generateTextOpenAiCompatible({
    ...input,
    baseUrl: BASE_URL,
    apiKey: getApiKey(),
    timeoutMs: TIMEOUT_MS,
  });
}

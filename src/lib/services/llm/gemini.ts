import { GoogleGenerativeAI, GoogleGenerativeAIFetchError, SchemaType, type ResponseSchema } from "@google/generative-ai";

import { HttpError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseSchemaOpsResponse, type SchemaOpsResponse } from "@/lib/services/schema-ops";
import { createJsonReplyExtractor } from "@/lib/services/llm/json-reply-extractor";
import {
  DISCUSS_ONLY_NOTE,
  SYSTEM_INSTRUCTION,
  TRUNCATION_WARNING,
  maxOutputTokens,
  memoriesBlock,
  parseTruncatedJson,
  type LlmModelInfo,
  type LlmStreamCallback,
  type LlmTurnInput,
} from "@/lib/services/llm/shared";

function buildResponseSchema(): ResponseSchema {
  const columnSchema: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      name: { type: SchemaType.STRING },
      type: { type: SchemaType.STRING },
      isPrimary: { type: SchemaType.BOOLEAN },
      isNullable: { type: SchemaType.BOOLEAN },
    },
    required: ["name", "type"],
  };

  return {
    type: SchemaType.OBJECT,
    properties: {
      reply: { type: SchemaType.STRING },
      operations: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            op: {
              type: SchemaType.STRING,
              format: "enum",
              enum: [
                "createTable",
                "addColumn",
                "dropColumn",
                "renameColumn",
                "addForeignKey",
                "dropForeignKey",
                "dropTable",
                "renameTable",
              ],
            },
            table: { type: SchemaType.STRING },
            newName: { type: SchemaType.STRING },
            scope: { type: SchemaType.STRING },
            column: { type: SchemaType.STRING },
            referencesTable: { type: SchemaType.STRING },
            referencesColumn: { type: SchemaType.STRING },
            onDelete: { type: SchemaType.STRING },
            onUpdate: { type: SchemaType.STRING },
            newColumn: columnSchema,
            columns: { type: SchemaType.ARRAY, items: columnSchema },
          },
          required: ["op"],
        },
      },
    },
    required: ["reply", "operations"],
  };
}

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

/** Lista os modelos Gemini disponíveis pra chave configurada, via API REST (o SDK não expõe isso). */
export async function listGeminiModels(): Promise<LlmModelInfo[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada");
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!res.ok) {
    throw new Error("Falha ao listar modelos do Gemini");
  }

  const data = (await res.json()) as {
    models?: Array<{
      name: string;
      displayName?: string;
      description?: string;
      supportedGenerationMethods?: string[];
    }>;
  };

  const EXCLUDED_PATTERN = /embedding|tts|image|vision|audio|live|native-audio|learnlm|robotics/i;

  return (data.models ?? [])
    .filter(
      (m) =>
        m.name.startsWith("models/gemini") &&
        !EXCLUDED_PATTERN.test(m.name) &&
        (m.supportedGenerationMethods ?? []).includes("generateContent")
    )
    .map((m) => ({
      id: m.name.replace(/^models\//, ""),
      displayName: m.displayName ?? m.name,
      description: m.description,
    }));
}

export async function generateSchemaOpsWithGemini(input: LlmTurnInput): Promise<SchemaOpsResponse> {
  return streamSchemaOpsWithGemini(input);
}

export async function streamSchemaOpsWithGemini(
  input: LlmTurnInput,
  onReplyDelta?: LlmStreamCallback
): Promise<SchemaOpsResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: input.model || DEFAULT_GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(),
      maxOutputTokens: maxOutputTokens(),
    },
  });

  const historyText = input.history
    .map((turn) => `${turn.role === "user" ? "Usuário" : "Assistente"}: ${turn.message}`)
    .join("\n");

  const prompt = [
    `Modelo atual (JSON):\n${JSON.stringify(input.currentDiagram)}`,
    memoriesBlock(input.memories),
    historyText ? `Histórico da conversa:\n${historyText}` : null,
    input.discussOnly ? DISCUSS_ONLY_NOTE : null,
    `Nova mensagem do usuário:\n${input.userMessage}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  let streamResult;
  try {
    streamResult = await model.generateContentStream(prompt);
  } catch (err) {
    if (err instanceof GoogleGenerativeAIFetchError) {
      if (err.status === 429) {
        throw new HttpError(429, "Quota da API do Gemini excedida para este modelo. Tente outro modelo ou aguarde e tente de novo.");
      }
      if (err.status === 404) {
        throw new HttpError(400, `O modelo "${input.model}" não está disponível para esta chave de API. Escolha outro modelo.`);
      }
      if (err.status === 403) {
        throw new HttpError(403, "A chave GEMINI_API_KEY não tem permissão para usar este modelo.");
      }
      throw new HttpError(502, `Falha ao chamar a API do Gemini (${err.status ?? "erro desconhecido"}).`);
    }
    throw err;
  }

  const extractor = createJsonReplyExtractor(onReplyDelta);

  try {
    for await (const chunk of streamResult.stream) {
      const textChunk = chunk.text();
      extractor.feed(textChunk);
    }
  } catch (streamErr) {
    logger.warn({ err: streamErr }, "gemini: erro ao iterar stream de resposta");
  }

  const response = await streamResult.response;
  const finishReason = response.candidates?.[0]?.finishReason;
  const truncated = finishReason === "MAX_TOKENS";
  if (finishReason === "SAFETY" || finishReason === "RECITATION") {
    throw new HttpError(502, "A resposta foi bloqueada pelos filtros de segurança do modelo. Tente reformular a mensagem.");
  }

  const text = extractor.getFullText() || response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Resposta cortada no meio do JSON: tenta salvar a parte que chegou antes de desistir.
    const recovered = parseTruncatedJson(text);
    if (recovered === null) {
      logger.error({ text }, "gemini: JSON inválido retornado pelo modelo");
      throw new HttpError(
        502,
        truncated
          ? "A resposta da LLM foi cortada pelo limite de tokens e não sobrou nada aproveitável. Tente uma mensagem mais curta, aumente LLM_MAX_OUTPUT_TOKENS ou troque de modelo."
          : "A LLM retornou um JSON inválido"
      );
    }
    logger.warn({ finishReason }, "gemini: resposta truncada recuperada parcialmente");
    parsed = recovered;
  }

  let validated: SchemaOpsResponse & { skippedCount: number };
  try {
    validated = parseSchemaOpsResponse(parsed);
  } catch {
    logger.error({ parsed }, "gemini: resposta fora do formato esperado");
    throw new HttpError(502, "A resposta da LLM não seguiu o formato esperado. Tente de novo ou reformule a mensagem.");
  }

  if (validated.skippedCount > 0) {
    logger.warn({ skippedCount: validated.skippedCount }, "gemini: operações descartadas por formato inválido");
  }

  const reply = [
    validated.reply,
    validated.skippedCount > 0
      ? `\n⚠️ ${validated.skippedCount} operação(ões) vieram com formato inválido e foram ignoradas — se algo ficou faltando, peça de novo de forma mais específica.`
      : null,
    truncated ? `\n${TRUNCATION_WARNING}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");

  return { reply, operations: validated.operations };
}

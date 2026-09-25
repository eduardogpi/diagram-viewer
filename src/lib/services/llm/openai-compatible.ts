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

/** Extrai o primeiro bloco JSON de um texto, removendo cercas de código markdown se existirem. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

export async function listOpenAiCompatibleModels(opts: {
  baseUrl: string;
  apiKey: string;
  extraHeaders?: Record<string, string>;
}): Promise<LlmModelInfo[]> {
  const res = await fetch(`${opts.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${opts.apiKey}`, ...opts.extraHeaders },
  });
  if (!res.ok) {
    throw new Error(`Falha ao listar modelos (${res.status})`);
  }

  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      description?: string;
      owned_by?: string;
      pricing?: { prompt?: string };
      architecture?: { modality?: string };
    }>;
  };

  return (data.data ?? [])
    .filter((m) => {
      const modality = m.architecture?.modality;
      if (!modality) return true;
      const output = modality.split("->").pop() ?? "";
      return output.includes("text");
    })
    .map((m) => {
      const isFree = m.id.endsWith(":free") || m.pricing?.prompt === "0";
      return {
        id: m.id,
        displayName: `${isFree ? "🆓 " : ""}${m.name ?? m.id}`,
        description: m.description,
      };
    });
}

/** Timeout generoso por padrão: modelos gratuitos costumam demorar bem mais a responder. */
const DEFAULT_TIMEOUT_MS = 120_000;

export async function chatCompletionOpenAiCompatible(
  input: LlmTurnInput & {
    baseUrl: string;
    apiKey: string;
    extraHeaders?: Record<string, string>;
    timeoutMs?: number;
  }
): Promise<SchemaOpsResponse> {
  return streamOpenAiCompatible(input);
}

export async function streamOpenAiCompatible(
  input: LlmTurnInput & {
    baseUrl: string;
    apiKey: string;
    extraHeaders?: Record<string, string>;
    timeoutMs?: number;
  },
  onReplyDelta?: LlmStreamCallback
): Promise<SchemaOpsResponse> {
  const messages = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    ...input.history.map((h) => ({ role: h.role, content: h.message })),
    ...(input.discussOnly ? [{ role: "system", content: DISCUSS_ONLY_NOTE }] : []),
    {
      role: "user",
      content: [
        `Modelo atual (JSON):\n${JSON.stringify(input.currentDiagram)}`,
        memoriesBlock(input.memories),
        `Nova mensagem do usuário:\n${input.userMessage}`,
      ]
        .filter((part): part is string => Boolean(part))
        .join("\n\n"),
    },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${input.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
        ...input.extraHeaders,
      },
      body: JSON.stringify({
        model: input.model,
        messages,
        response_format: { type: "json_object" },
        max_tokens: maxOutputTokens(),
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpError(
        504,
        "Tempo limite excedido esperando resposta do modelo (modelos gratuitos podem demorar bem mais — tente de novo ou troque de modelo)."
      );
    }
    throw new HttpError(502, "Falha de rede ao chamar a API do modelo.");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    logger.error({ status: res.status, body: bodyText }, "falha no stream de chat completion");
    if (res.status === 429) {
      throw new HttpError(429, "Quota ou rate limit excedido para este modelo. Tente outro modelo ou aguarde.");
    }
    if (res.status === 404) {
      throw new HttpError(400, "Modelo não encontrado ou indisponível para esta chave de API.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(res.status, "Chave de API inválida ou sem permissão para este modelo.");
    }
    throw new HttpError(502, `Falha ao chamar o modelo (${res.status}).`);
  }

  if (!res.body) {
    throw new HttpError(502, "O modelo não retornou corpo de resposta em stream.");
  }

  const extractor = createJsonReplyExtractor(onReplyDelta);
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finishReason: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (dataStr === "[DONE]") break;
        try {
          const parsedChunk = JSON.parse(dataStr);
          const choice = parsedChunk.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const deltaContent = choice?.delta?.content;
          if (deltaContent) {
            extractor.feed(deltaContent);
          }
        } catch {
          // ignora linhas intermediárias
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "erro durante leitura do stream (openai-compatible)");
  }

  const content = extractor.getFullText();
  if (!content) {
    throw new HttpError(502, `O modelo não retornou conteúdo (finish_reason: ${finishReason ?? "desconhecido"}).`);
  }

  const truncated = finishReason === "length";
  const json = extractJson(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Resposta cortada no meio do JSON: tenta salvar a parte que chegou antes de desistir.
    const recovered = parseTruncatedJson(json);
    if (recovered === null) {
      logger.error({ content }, "resposta do modelo não é JSON válido");
      throw new HttpError(
        502,
        truncated
          ? "A resposta do modelo foi cortada pelo limite de tokens e não sobrou nada aproveitável. Tente uma mensagem mais curta, aumente LLM_MAX_OUTPUT_TOKENS ou troque de modelo."
          : "O modelo não retornou um JSON válido. Modelos gratuitos às vezes ignoram o formato pedido — tente de novo ou troque de modelo."
      );
    }
    logger.warn({ finishReason }, "resposta truncada recuperada parcialmente");
    parsed = recovered;
  }

  let validated;
  try {
    validated = parseSchemaOpsResponse(parsed);
  } catch {
    logger.error({ parsed }, "resposta fora do formato esperado");
    throw new HttpError(502, "A resposta não seguiu o formato esperado. Tente de novo ou reformule a mensagem.");
  }

  const reply = [
    validated.reply,
    validated.skippedCount > 0
      ? `\n⚠️ ${validated.skippedCount} operação(ões) vieram com formato inválido e foram ignoradas.`
      : null,
    truncated ? `\n${TRUNCATION_WARNING}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");

  return { reply, operations: validated.operations };
}

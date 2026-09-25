import { NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { availableLlmProviders, currentLlmProvider, listLlmModels } from "@/lib/services/llm";

export async function GET(request: Request) {
  try {
    await requireCurrentUserId();
    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
    const models = await listLlmModels(forceRefresh);
    return NextResponse.json(
      { providers: availableLlmProviders(), defaultProvider: currentLlmProvider(), models },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error, "Falha ao listar modelos disponíveis");
  }
}

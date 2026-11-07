import { NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { getMcpStatus } from "@/lib/services/mcp-status";

export const dynamic = "force-dynamic";

/** Status do servidor MCP (sonda a porta HTTP + configuração lida do ambiente). Nunca expõe o token. */
export async function GET() {
  try {
    await requireCurrentUserId();
    return NextResponse.json(await getMcpStatus(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Falha ao verificar o MCP");
  }
}

import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { recordMetric } from "@/lib/observability";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorResponse(error: unknown, fallbackMessage = "Erro interno") {
  if (error instanceof HttpError) {
    logger.warn({ status: error.status, message: error.message }, "requisição recusada");
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    logger.warn("requisição sem usuário autenticado");
    return NextResponse.json({ error: "Usuário não autenticado" }, { status: 401 });
  }

  logger.error({ err: error }, fallbackMessage);
  recordMetric("api.error", 1, { fallbackMessage });
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import {
  planPackageSummary,
  summarizePackageChunk,
  summarizePackageOverview,
} from "@/lib/services/migration-summary";
import { logConnectionAudit } from "@/lib/services/workspace";
import { migrationPackageSummaryRequestSchema } from "@/lib/validators/migration";

type RouteContext = {
  params: Promise<{ connectionId: string; packageId: string }>;
};

/** Plano do resumo do package inteiro: quantos lotes e que migrations cada um cobre. */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const plan = await planPackageSummary({ packageId, connectionId, ownerId: userId });
    if (!plan) {
      return NextResponse.json({ error: "Package não encontrado" }, { status: 404 });
    }
    return NextResponse.json(plan, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Falha ao planejar o resumo do package");
  }
}

/**
 * Executa UMA etapa do resumo do package (map-reduce). O cliente orquestra: pede cada lote
 * (`phase: "chunk"`) e, no fim, a visão geral (`phase: "final"`). Cada chamada é curta e
 * retentável — um package com centenas de migrations não cabe numa requisição só.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = migrationPackageSummaryRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Parâmetros inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const request = parsed.data;
    if (request.phase === "chunk") {
      const result = await summarizePackageChunk({
        packageId,
        connectionId,
        ownerId: userId,
        index: request.index,
        provider: request.provider,
        model: request.model,
      });
      if (!result) {
        return NextResponse.json({ error: "Lote não encontrado neste package" }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    const result = await summarizePackageOverview({
      packageId,
      connectionId,
      ownerId: userId,
      parts: request.parts,
      provider: request.provider,
      model: request.model,
    });
    if (!result) {
      return NextResponse.json({ error: "Package não encontrado" }, { status: 404 });
    }

    await logConnectionAudit({
      action: "MIGRATION_PACKAGE_SUMMARY_GENERATED",
      userId,
      connectionId,
      context: `${request.parts.length} lote(s) (${result.provider}/${result.model})`,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Falha ao gerar o resumo do package");
  }
}

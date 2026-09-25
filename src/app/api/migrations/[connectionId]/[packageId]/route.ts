import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { deleteMigrationPackage, getMigrationPackage } from "@/lib/services/migrations";
import { logConnectionAudit } from "@/lib/services/workspace";

type RouteContext = {
  params: Promise<{ connectionId: string; packageId: string }>;
};

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const pkg = await getMigrationPackage(packageId, connectionId, userId);
    if (!pkg) {
      return NextResponse.json({ error: "Package não encontrado" }, { status: 404 });
    }

    return NextResponse.json(pkg, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Falha ao carregar package de migrations");
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const pkg = await getMigrationPackage(packageId, connectionId, userId);
    if (!pkg) {
      return NextResponse.json({ error: "Package não encontrado" }, { status: 404 });
    }

    await deleteMigrationPackage(packageId, connectionId, userId);

    await logConnectionAudit({
      action: "MIGRATION_PACKAGE_DELETED",
      userId,
      connectionId,
      context: pkg.name,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Falha ao remover package de migrations");
  }
}

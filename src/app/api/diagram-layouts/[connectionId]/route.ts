import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { createLayoutSnapshot, listLayoutSnapshots, logConnectionAudit } from "@/lib/services/workspace";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const snapshots = await listLayoutSnapshots(connectionId);
    return NextResponse.json(snapshots);
  } catch (error) {
    return errorResponse(error, "Falha ao carregar layouts do diagrama");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, userId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const body = (await req.json()) as {
      name?: string;
      nodes?: Array<{ id: string; position: { x: number; y: number } }>;
      edges?: string[];
      settings?: Record<string, unknown>;
    };

    if (!body.name || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
      return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
    }

    const snapshot = await createLayoutSnapshot({
      connectionId,
      name: body.name,
      nodes: body.nodes,
      edges: body.edges,
      settings: body.settings ?? {},
      createdBy: userId,
    });

    await logConnectionAudit({
      action: "DIAGRAM_LAYOUT_SAVED",
      userId,
      connectionId,
      context: body.name,
    });

    return NextResponse.json({ id: snapshot.id, name: snapshot.name }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Falha ao salvar layout do diagrama");
  }
}

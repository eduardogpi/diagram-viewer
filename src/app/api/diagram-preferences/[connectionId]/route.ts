import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { getWorkspacePreference, updateDiagramPreferences } from "@/lib/services/workspace";

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

    const preference = await getWorkspacePreference(userId, connectionId);
    return NextResponse.json(preference.diagramPreferences);
  } catch (error) {
    return errorResponse(error, "Falha ao carregar preferências do diagrama");
  }
}

export async function PATCH(
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

    const body = await req.json();
    await updateDiagramPreferences(userId, connectionId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Falha ao salvar preferências do diagrama");
  }
}

import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { upsertFavoriteTab } from "@/lib/services/workspace";

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

    const body = (await req.json()) as { favoriteTab?: string };
    if (!body.favoriteTab || typeof body.favoriteTab !== "string") {
      return NextResponse.json({ error: "Aba favorita inválida" }, { status: 400 });
    }

    await upsertFavoriteTab(userId, connectionId, body.favoriteTab);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Falha ao salvar preferências do workspace");
  }
}

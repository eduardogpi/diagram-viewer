import { NextRequest, NextResponse } from "next/server";

import { requireCurrentUserId } from "@/lib/auth/session";
import { requireDriver, toDriverConfig } from "@/lib/db/drivers";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import { buildExplorerCatalog } from "@/lib/services/explorer";
import { buildSchemaMarkdown } from "@/lib/services/schema-docs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const ownerId = await requireCurrentUserId();
    const { connectionId } = await params;
    const connection = await findConnectionForUser(connectionId, ownerId);

    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const driver = requireDriver(connection.provider);
    const introspection = await driver.introspect(toDriverConfig(connection), { includeIndexes: true });
    const catalog = buildExplorerCatalog(introspection, { provider: connection.provider, database: connection.database });
    const markdown = buildSchemaMarkdown(catalog);

    return new NextResponse(markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="schema-${connection.database}.md"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "Falha ao gerar documentação do schema");
  }
}

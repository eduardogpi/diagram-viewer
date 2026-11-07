import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentUserId } from "@/lib/auth/session";
import { errorResponse } from "@/lib/errors";
import { findConnectionForUser } from "@/lib/services/connections";
import {
  buildForeignKeysDelta,
  suggestForeignKeysWithAi,
  suggestHeuristicForeignKeys,
} from "@/lib/services/migration-fks";
import {
  appendMigrationsToPackage,
  getFinalDiagram,
  getMigrationPackage,
  getMigrationSnapshot,
} from "@/lib/services/migrations";
import { logConnectionAudit } from "@/lib/services/workspace";

const suggestSchema = z.object({
  action: z.literal("suggest"),
  order: z.number().int().positive().optional(),
  useAi: z.boolean().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  promptHint: z.string().max(500).optional(),
});

const applySchema = z.object({
  action: z.literal("apply"),
  fks: z
    .array(
      z.object({
        table: z.string().min(1),
        column: z.string().min(1),
        referencesTable: z.string().min(1),
        referencesColumn: z.string().min(1),
        onDelete: z.string().optional(),
        onUpdate: z.string().optional(),
      })
    )
    .min(1),
  dialect: z.enum(["mysql", "postgres"]).optional(),
  description: z.string().max(120).optional(),
  saveToPackage: z.boolean().optional().default(true),
});

const bodySchema = z.discriminatedUnion("action", [suggestSchema, applySchema]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string; packageId: string }> }
) {
  try {
    const userId = await requireCurrentUserId();
    const { connectionId, packageId } = await params;

    const connection = await findConnectionForUser(connectionId, userId);
    if (!connection) {
      return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Payload inválido" },
        { status: 400 }
      );
    }

    const payload = parsed.data;

    if (payload.action === "suggest") {
      const diagram = payload.order
        ? (await getMigrationSnapshot(packageId, connectionId, userId, payload.order))?.diagram ?? null
        : await getFinalDiagram(packageId, connectionId, userId);

      if (!diagram) {
        return NextResponse.json({ error: "Diagrama da migration não encontrado" }, { status: 404 });
      }

      if (payload.useAi) {
        const result = await suggestForeignKeysWithAi({
          diagram,
          provider: payload.provider,
          model: payload.model,
          promptHint: payload.promptHint,
        });
        return NextResponse.json(result, { status: 200 });
      }

      const suggestions = suggestHeuristicForeignKeys(diagram);
      return NextResponse.json(
        {
          reply:
            suggestions.length > 0
              ? `Foram encontradas ${suggestions.length} sugestão(ões) automática(s) por padrão de nomenclatura.`
              : "Nenhuma FK implícita óbvia encontrada por heurística. Clique em 'Sugerir com IA' para análise semântica das colunas.",
          suggestions,
        },
        { status: 200 }
      );
    }

    // action === "apply"
    const pkg = await getMigrationPackage(packageId, connectionId, userId);
    const finalDiagram = await getFinalDiagram(packageId, connectionId, userId);
    if (!pkg || !finalDiagram) {
      return NextResponse.json({ error: "Package não encontrado" }, { status: 404 });
    }

    const dialect =
      payload.dialect ??
      (String(pkg.sourceProvider).toUpperCase().includes("POSTGRES") ||
      String(connection.provider).toUpperCase().includes("POSTGRES")
        ? "postgres"
        : "mysql");

    const nextVersionNumber = pkg.fileCount + 1;
    const delta = buildForeignKeysDelta({
      diagram: finalDiagram,
      fks: payload.fks,
      dialect,
      nextVersionNumber,
      description: payload.description,
    });

    if (!payload.saveToPackage) {
      return NextResponse.json(
        {
          filename: delta.filename,
          sql: delta.sql,
          updatedDiagram: delta.updatedDiagram,
          saved: false,
        },
        { status: 200 }
      );
    }

    const appendResult = await appendMigrationsToPackage({
      packageId,
      connectionId,
      ownerId: userId,
      files: [{ name: delta.filename, content: delta.sql }],
    });

    if (!appendResult) {
      return NextResponse.json({ error: "Falha ao gravar migration no package" }, { status: 500 });
    }

    await logConnectionAudit({
      action: "MIGRATION_PACKAGE_APPENDED",
      userId,
      connectionId,
      context: `${pkg.name} (+FKs em ${delta.filename}, ${payload.fks.length} relação(ões))`,
    });

    return NextResponse.json(
      {
        filename: delta.filename,
        sql: delta.sql,
        updatedDiagram: delta.updatedDiagram,
        saved: true,
        appendResult,
      },
      { status: 200 }
    );
  } catch (error) {
    return errorResponse(error, "Falha ao processar Foreign Keys da migration");
  }
}

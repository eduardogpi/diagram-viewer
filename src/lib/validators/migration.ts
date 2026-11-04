import { z } from "zod";

/** Corpo do POST /api/migrations/[connectionId]/[packageId]/summary. */
export const migrationSummaryRequestSchema = z.object({
  order: z.coerce.number().int().positive(),
  /** Quantas migrations anteriores entram como contexto. */
  before: z.coerce.number().int().min(0).max(10).default(2),
  /** Quantas migrations posteriores entram como contexto. */
  after: z.coerce.number().int().min(0).max(10).default(2),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
});

export type MigrationSummaryRequest = z.infer<typeof migrationSummaryRequestSchema>;

const llmTargetShape = {
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
};

/** Corpo do POST /api/migrations/[connectionId]/[packageId]/summary/package. */
export const migrationPackageSummaryRequestSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("chunk"), index: z.coerce.number().int().min(0), ...llmTargetShape }),
  z.object({
    phase: z.literal("final"),
    parts: z
      .array(
        z.object({
          index: z.number().int().min(0),
          fromOrder: z.number().int().positive(),
          toOrder: z.number().int().positive(),
          summary: z.string().max(30_000),
        })
      )
      .min(1)
      .max(200),
    ...llmTargetShape,
  }),
]);

export type MigrationPackageSummaryRequest = z.infer<typeof migrationPackageSummaryRequestSchema>;


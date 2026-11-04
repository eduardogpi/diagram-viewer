import { z } from "zod";

export const sqlQuerySchema = z.object({
  sql: z.string().min(1, "Informe uma consulta SQL.").max(20_000, "Consulta muito longa."),
  rowLimit: z.coerce.number().int().min(1).max(500).default(200),
});

export type SqlQueryPayload = z.infer<typeof sqlQuerySchema>;

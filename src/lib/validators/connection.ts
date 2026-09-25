import { z } from "zod";

export const connectionProviders = ["MYSQL", "POSTGRES", "MIGRATIONS"] as const;
export type ConnectionProvider = (typeof connectionProviders)[number];

export const connectionPayloadSchema = z.object({
  name: z.string().min(3, "Nome obrigatório"),
  provider: z.enum(connectionProviders),
  host: z.string().min(3),
  port: z.coerce.number().int().positive().max(65535),
  database: z.string().min(1),
  /** Só usado por providers que separam database de schema (Postgres); ignorado nos demais. */
  schema: z.string().trim().min(1).optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export type ConnectionPayload = z.infer<typeof connectionPayloadSchema>;

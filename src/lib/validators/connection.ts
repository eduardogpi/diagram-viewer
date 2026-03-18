import { z } from "zod";

export const connectionProviders = ["MYSQL", "POSTGRES", "MSSQL", "ORACLE"] as const;
export type ConnectionProvider = (typeof connectionProviders)[number];

export const connectionPayloadSchema = z.object({
  name: z.string().min(3, "Nome obrigatório"),
  provider: z.enum(connectionProviders),
  host: z.string().min(3),
  port: z.coerce.number().int().positive().max(65535),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export type ConnectionPayload = z.infer<typeof connectionPayloadSchema>;

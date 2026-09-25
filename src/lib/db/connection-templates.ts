import type { ConnectionProvider } from "@/lib/validators/connection";

export type ConnectionTemplate = {
  id: string;
  label: string;
  description: string;
  values: {
    provider: ConnectionProvider;
    host?: string;
    port?: number;
    database?: string;
    schema?: string;
    username?: string;
    tags?: string;
  };
};

/** Presets que pré-preenchem o formulário para os cenários mais comuns. */
export const CONNECTION_TEMPLATES: ConnectionTemplate[] = [
  {
    id: "mysql-local",
    label: "MySQL local",
    description: "MySQL/MariaDB rodando em localhost",
    values: { provider: "MYSQL", host: "localhost", port: 3306, username: "root", tags: "dev,local" },
  },
  {
    id: "postgres-local",
    label: "PostgreSQL local",
    description: "Postgres em localhost com schema public",
    values: { provider: "POSTGRES", host: "localhost", port: 5432, username: "postgres", schema: "public", tags: "dev,local" },
  },
  {
    id: "postgres-managed",
    label: "Postgres gerenciado",
    description: "Neon/Supabase/RDS (TLS)",
    values: { provider: "POSTGRES", port: 5432, username: "postgres", schema: "public", tags: "prod" },
  },
  {
    id: "migrations",
    label: "Migrations (sem banco)",
    description: "Importar pasta de migrations, sem conexão real",
    values: { provider: "MIGRATIONS", tags: "migrations" },
  },
];

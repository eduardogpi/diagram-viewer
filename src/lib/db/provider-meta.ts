import type { ConnectionProvider } from "@/lib/validators/connection";

export type SchemaFieldMeta = { label: string; placeholder: string; defaultValue: string };

export type ProviderMeta = {
  provider: ConnectionProvider;
  label: string;
  defaultPort: number;
  defaultUsername: string;
  /** Bancos que separam database de schema pedem o campo extra; null esconde o campo. */
  schemaField: SchemaFieldMeta | null;
  /** Providers sem banco real por trás (MIGRATIONS) não têm driver nem teste de conexão. */
  isLive: boolean;
};

/**
 * Metadados de provider seguros para o cliente — os drivers (que importam mysql2/pg) só rodam
 * no servidor, então o formulário não pode depender deles.
 */
export const PROVIDER_META: Record<ConnectionProvider, ProviderMeta> = {
  MYSQL: {
    provider: "MYSQL",
    label: "MySQL / MariaDB",
    defaultPort: 3306,
    defaultUsername: "root",
    schemaField: null,
    isLive: true,
  },
  POSTGRES: {
    provider: "POSTGRES",
    label: "PostgreSQL",
    defaultPort: 5432,
    defaultUsername: "postgres",
    schemaField: { label: "Schema", placeholder: "public", defaultValue: "public" },
    isLive: true,
  },
  MIGRATIONS: {
    provider: "MIGRATIONS",
    label: "Migrations (sem banco)",
    defaultPort: 0,
    defaultUsername: "",
    schemaField: null,
    isLive: false,
  },
};

export const liveProviders = Object.values(PROVIDER_META).filter((meta) => meta.isLive);

export function providerLabel(provider: string): string {
  return PROVIDER_META[provider as ConnectionProvider]?.label ?? provider;
}

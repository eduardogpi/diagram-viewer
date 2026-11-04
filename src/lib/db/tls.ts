import { readFileSync } from "node:fs";

/**
 * Configuração TLS para drivers MySQL/Postgres.
 * - `rejectUnauthorized` é **sempre true** por padrão (verificação de certificado ativa).
 * - `*_SSL_MODE=disable` desliga TLS explicitamente (use só para testes locais sem TLS).
 * - CA customizada via `MYSQL_CA_CERT` / `POSTGRES_CA_CERT` (caminho para PEM) ou
 *   `*_SSL_REJECT_UNAUTHORIZED=false` **apenas** com CA explícita — nunca em produção sem CA.
 */
export type TlsOptions = {
  rejectUnauthorized: boolean;
  ca?: string;
};

function resolveCa(prefix: "MYSQL" | "POSTGRES"): string | undefined {
  const path = process.env[`${prefix}_CA_CERT`];
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`${prefix}_CA_CERT não pode ser lido (${path})`);
  }
}

export function resolveTls(prefix: "MYSQL" | "POSTGRES"): TlsOptions {
  const mode = (process.env[`${prefix}_SSL_MODE`] ?? "").toLowerCase();
  if (mode === "disable") {
    return { rejectUnauthorized: false };
  }
  const enabled = process.env[`${prefix}_SSL`] === "true" || mode === "require" || mode === "verify-ca" || mode === "verify-full";
  if (!enabled) {
    // Chamador decide: se não houver SSL habilitado, não passamos `ssl` ao driver.
    return { rejectUnauthorized: true };
  }
  const ca = resolveCa(prefix);
  const explicitInsecure = process.env[`${prefix}_SSL_REJECT_UNAUTHORIZED`] === "false";
  if (explicitInsecure && !ca && process.env.NODE_ENV === "production") {
    throw new Error(`${prefix}_SSL_REJECT_UNAUTHORIZED=false sem ${prefix}_CA_CERT não é permitido em produção`);
  }
  return {
    rejectUnauthorized: !explicitInsecure,
    ...(ca ? { ca } : {}),
  };
}

/** Monta a opção `ssl` no formato esperado por mysql2/pg. */
export function buildSslOption(prefix: "MYSQL" | "POSTGRES"): { rejectUnauthorized: boolean; ca?: string } | undefined {
  const enabled = process.env[`${prefix}_SSL`] === "true" || ["require", "verify-ca", "verify-full"].includes((process.env[`${prefix}_SSL_MODE`] ?? "").toLowerCase());
  if (!enabled) return undefined;
  return resolveTls(prefix);
}

import { decryptSecret } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";

import { mysqlDriver } from "./mysql";
import { postgresDriver } from "./postgres";
import type { DiagramCapableDriver, DriverConnectionConfig } from "./types";

/**
 * Registro de drivers de banco ao vivo. Providers sem driver (ex: MIGRATIONS, que não tem banco
 * real por trás) simplesmente não aparecem aqui.
 */
const DRIVERS: Record<string, DiagramCapableDriver> = {
  [mysqlDriver.provider]: mysqlDriver,
  [postgresDriver.provider]: postgresDriver,
};

export const liveDrivers = Object.values(DRIVERS);

export function findDriver(provider: string): DiagramCapableDriver | null {
  return DRIVERS[provider] ?? null;
}

/** Igual a findDriver, mas falha com uma mensagem útil em vez de devolver null. */
export function requireDriver(provider: string): DiagramCapableDriver {
  const driver = findDriver(provider);
  if (!driver) {
    throw new HttpError(
      422,
      provider === "MIGRATIONS"
        ? "Conexão baseada em migrations não possui banco real. Use a aba Migrations."
        : `Provider ${provider} não suportado para conexão ao vivo.`
    );
  }
  return driver;
}

type ConnectionRecord = {
  host: string;
  port: number;
  username: string;
  database: string;
  schema?: string | null;
  secret?: { cipherText: string } | null;
};

/** Converte um registro de Connection (com o segredo cifrado) na config que os drivers esperam. */
export function toDriverConfig(connection: ConnectionRecord): DriverConnectionConfig {
  if (!connection.secret) {
    throw new HttpError(422, "Nenhum segredo associado à conexão.");
  }
  return {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    database: connection.database,
    schema: connection.schema ?? null,
    password: decryptSecret(connection.secret.cipherText),
  };
}

export type {
  DatabaseDriver,
  DiagramCapableDriver,
  DriverConnectionConfig,
  QueryExecutionResult,
  ReadOnlyQueryInput,
} from "./types";

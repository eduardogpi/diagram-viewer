import { lookup } from "node:dns/promises";

import { HttpError } from "@/lib/errors";
import { isIPv4Literal, isIPv6Literal, isPrivateIPv4, isPrivateIPv6, isPrivateOrReservedHost } from "@/lib/security/ssrf-common";

export { isPrivateOrReservedHost };

function allowPrivate(): boolean {
  return process.env.ALLOW_PRIVATE_DB_HOSTS === "1" && process.env.NODE_ENV !== "production";
}

/**
 * Valida o host de forma síncrona (literal IP ou hostname suspeito).
 * Use `assertPublicDbHost` (async) quando quiser resolver DNS.
 */
export function assertPublicDbHostSync(host: string): void {
  if (allowPrivate()) return;
  if (isPrivateOrReservedHost(host)) {
    throw new HttpError(400, "Host de banco de dados não permitido: IPs privados, loopback e link-local são bloqueados (SSRF).");
  }
}

/** Resolve o hostname e garante que todos os IPs retornados são públicos. */
export async function assertPublicDbHost(host: string): Promise<void> {
  assertPublicDbHostSync(host);
  if (allowPrivate()) return;
  const trimmed = host.trim();
  if (isIPv4Literal(trimmed) || isIPv6Literal(trimmed)) return; // já validado de forma síncrona
  let records: { address: string }[];
  try {
    records = await lookup(trimmed, { all: true });
  } catch {
    throw new HttpError(400, `Não foi possível resolver o host "${trimmed}".`);
  }
  for (const record of records) {
    const blocked = isIPv4Literal(record.address) ? isPrivateIPv4(record.address) : isIPv6Literal(record.address) ? isPrivateIPv6(record.address) : true;
    if (blocked) {
      throw new HttpError(400, "Host de banco de dados resolve para IP privado/loopback/link-local (SSRF bloqueado).");
    }
  }
}

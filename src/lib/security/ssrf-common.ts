/**
 * Parte síncrona e universal (browser + server) do anti-SSRF.
 * Zero imports de Node — safe para bundle do cliente (Turbopack).
 * A resolução DNS (async, server-only) vive em `ssrf.ts`.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data",
  "instance-data-compute",
]);

function parseIPv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums as [number, number, number, number];
}

function isIPv4Literal(ip: string): boolean {
  return parseIPv4(ip) !== null;
}

function isIPv6Literal(ip: string): boolean {
  // Heurística suficiente para triagem de SSRF: contém ':' e só caracteres hex, ':', '.' e '%'
  if (!ip.includes(":")) return false;
  return /^[0-9a-fA-F:.%]+$/.test(ip) && (ip.match(/:/g) ?? []).length >= 2;
}

function isPrivateIPv4(ip: string): boolean {
  const parsed = parseIPv4(ip);
  if (!parsed) return false;
  const [a, b] = parsed;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reservado
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fec0:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("ff")) return true; // multicast
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isPrivateOrReservedHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!trimmed) return true;
  if (BLOCKED_HOSTNAMES.has(trimmed)) return true;
  if (isIPv4Literal(trimmed)) return isPrivateIPv4(trimmed);
  if (isIPv6Literal(trimmed)) return isPrivateIPv6(trimmed);
  if (trimmed.endsWith(".internal") || trimmed.endsWith(".local") || trimmed.endsWith(".lan")) return true;
  return false;
}

export { isPrivateIPv4, isPrivateIPv6, isIPv4Literal, isIPv6Literal };

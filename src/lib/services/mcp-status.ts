/**
 * Status do servidor MCP para exibir no workbench.
 *
 * O MCP roda em processo separado (`npm run mcp:http` ou `npm run mcp` para stdio), então o
 * Next só consegue (a) ler a mesma configuração do `.env` que o processo MCP lê e (b) sondar a
 * porta HTTP. O modo stdio é iniciado pelo próprio cliente (Claude Code, Cursor...) e não tem
 * como ser detectado daqui — por isso aparece só como instrução.
 *
 * Nunca devolve o valor do token: só se ele está configurado e quantos existem.
 */

export type McpHttpState = "online" | "offline" | "misconfigured";

export type McpStatus = {
  checkedAt: string;
  http: {
    state: McpHttpState;
    /** Explicação curta do estado (ex: motivo do "misconfigured"). */
    detail: string;
    url: string;
    host: string;
    port: number;
    latencyMs: number | null;
    /** O transporte HTTP sempre exige Bearer token — sem token o servidor recusa tudo. */
    tokenRequired: true;
    tokenConfigured: boolean;
    tokenCount: number | null;
    allowedHosts: string[];
    startCommand: string;
  };
  stdio: {
    startCommand: string;
    tokenRequired: false;
  };
  scope: {
    /** MCP_USER_ID fixado: as tools agem como esse usuário. */
    userIdPinned: boolean;
    defaultConnectionPinned: boolean;
    allowedConnections: string[];
    allowedEnvironments: string[];
    requireEnvironmentTag: boolean;
  };
};

const PROBE_TIMEOUT_MS = 1500;

type Env = Record<string, string | undefined>;

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Endereço de escuta 0.0.0.0/:: não é alcançável como destino — sonda pelo loopback. */
function probeHost(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::" || host === "[::]") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function readMcpConfig(env: Env = process.env) {
  const host = env.MCP_HTTP_HOST?.trim() || "127.0.0.1";
  const port = Number(env.MCP_HTTP_PORT) || 3847;
  const tokens = csv(env.MCP_HTTP_TOKEN);
  return {
    host,
    port,
    tokens,
    allowedHosts: csv(env.MCP_HTTP_ALLOWED_HOSTS),
    /** URL que o cliente deve usar (pode diferir da interna atrás de proxy/Docker). */
    publicUrl: env.MCP_HTTP_PUBLIC_URL?.trim() || `http://${probeHost(host)}:${port}/mcp`,
    probeUrl: `http://${probeHost(host)}:${port}/mcp`,
  };
}

/**
 * Sonda o endpoint sem credenciais: qualquer resposta HTTP prova que o processo está de pé.
 * 401 = online e protegido (esperado); 500 citando o token = processo de pé mas sem
 * MCP_HTTP_TOKEN no ambiente dele; erro de conexão/timeout = offline.
 */
export async function probeMcpHttp(
  probeUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ state: McpHttpState; detail: string; latencyMs: number | null; serverHasToken: boolean | null }> {
  const started = Date.now();
  try {
    const res = await fetchImpl(probeUrl, {
      method: "GET",
      headers: { accept: "application/json, text/event-stream" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    const body = await res.text().catch(() => "");
    if (res.status === 500 && /MCP_HTTP_TOKEN/.test(body)) {
      return {
        state: "misconfigured",
        detail: "Servidor no ar, mas sem MCP_HTTP_TOKEN no ambiente dele — recusa todas as chamadas.",
        latencyMs,
        serverHasToken: false,
      };
    }
    // 401 só sai quando o servidor TEM token e recusou a chamada sem credencial.
    if (res.status === 401) {
      return { state: "online", detail: "Respondendo e exigindo token.", latencyMs, serverHasToken: true };
    }
    return { state: "online", detail: `Respondendo (HTTP ${res.status}).`, latencyMs, serverHasToken: null };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      state: "offline",
      detail: timedOut ? `Sem resposta em ${PROBE_TIMEOUT_MS} ms.` : "Nada escutando nesse endereço.",
      latencyMs: null,
      serverHasToken: null,
    };
  }
}

export async function getMcpStatus(
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<McpStatus> {
  const config = readMcpConfig(env);
  const { serverHasToken, ...probe } = await probeMcpHttp(config.probeUrl, fetchImpl);
  // O processo MCP pode ter recebido o token por variável de ambiente própria (não pelo .env
  // que o Next lê): a resposta do servidor vale mais do que a configuração local.
  const tokenConfigured = serverHasToken ?? config.tokens.length > 0;

  return {
    checkedAt: new Date().toISOString(),
    http: {
      ...probe,
      url: config.publicUrl,
      host: config.host,
      port: config.port,
      tokenRequired: true,
      tokenConfigured,
      /** null = o servidor confirmou que tem token, mas o .env deste app não diz quantos. */
      tokenCount: config.tokens.length > 0 ? config.tokens.length : tokenConfigured ? null : 0,
      allowedHosts: config.allowedHosts,
      startCommand: "npm run mcp:http",
    },
    stdio: { startCommand: "npm run mcp", tokenRequired: false },
    scope: {
      userIdPinned: Boolean(env.MCP_USER_ID?.trim()),
      defaultConnectionPinned: Boolean(env.MCP_CONNECTION_ID?.trim()),
      allowedConnections: csv(env.MCP_ALLOWED_CONNECTIONS),
      allowedEnvironments: csv(env.MCP_ALLOWED_ENVIRONMENTS),
      requireEnvironmentTag: env.MCP_REQUIRE_ENV_TAG === "1",
    },
  };
}

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";

import { buildMcpServer } from "@/mcp/app";
import { dropStickyState } from "@/mcp/session-store";
import { logger } from "@/lib/logger";

type HttpReq = {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type HttpRes = {
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
  headersSent: boolean;
};

function configuredTokens(): string[] {
  return (process.env.MCP_HTTP_TOKEN ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readBearer(req: HttpReq): string | null {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(req: HttpReq): boolean {
  const tokens = configuredTokens();
  if (tokens.length === 0) {
    throw new Error("MCP_HTTP_TOKEN é obrigatório para o transporte HTTP.");
  }
  const provided = readBearer(req);
  return !!provided && tokens.some((token) => tokenMatches(provided, token));
}

function unauthorized(res: { status: (code: number) => { json: (body: unknown) => void } }) {
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized: envie Authorization: Bearer <MCP_HTTP_TOKEN>" },
    id: null,
  });
}

/**
 * Servidor MCP Streamable HTTP com sessões isoladas e autenticação por Bearer token.
 * Cada cliente (Devin, Codex remoto etc.) recebe um mcp-session-id próprio — o estado
 * sticky de conexão/sessão de modelagem não vaza entre agentes.
 */
export async function startHttpServer(): Promise<void> {
  const host = process.env.MCP_HTTP_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.MCP_HTTP_PORT) || 3847;
  const allowedHosts = (process.env.MCP_HTTP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const app = createMcpExpressApp({
    host,
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
  });

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req: HttpReq, res: HttpRes) => {
    try {
      if (!authorize(req)) {
        unauthorized(res);
        return;
      }
    } catch (error) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        id: null,
      });
      return;
    }

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (typeof sessionId === "string" && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
          onsessionclosed: (id) => {
            transports.delete(id);
            dropStickyState(id);
          },
        });
        const server = buildMcpServer();
        await server.connect(transport);
        transport.onclose = () => {
          const id = transport?.sessionId;
          if (id) {
            transports.delete(id);
            dropStickyState(id);
          }
          void server.close();
        };
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: sessão MCP inválida ou ausente. Envie initialize primeiro." },
          id: null,
        });
        return;
      }

      await transport!.handleRequest(req as never, res as never, req.body);
    } catch (error) {
      logger.error({ err: error }, "erro no request MCP HTTP");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req: HttpReq, res: HttpRes) => {
    try {
      if (!authorize(req)) {
        unauthorized(res);
        return;
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    const transport = typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Sessão MCP não encontrada" },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req as never, res as never);
  });

  app.delete("/mcp", async (req: HttpReq, res: HttpRes) => {
    try {
      if (!authorize(req)) {
        unauthorized(res);
        return;
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    const transport = typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).end();
      return;
    }
    await transport.handleRequest(req as never, res as never);
  });

  const httpServer = createServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });
  logger.info({ host, port }, "MCP diagram-viewer-ai-modeling pronto (HTTP)");
}

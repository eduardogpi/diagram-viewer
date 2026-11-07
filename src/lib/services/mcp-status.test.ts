import { describe, expect, it, vi } from "vitest";

import { getMcpStatus, probeMcpHttp, readMcpConfig } from "@/lib/services/mcp-status";

function fakeFetch(status: number, body = "") {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("mcp-status", () => {
  it("usa os mesmos padrões do servidor MCP e sonda 0.0.0.0 pelo loopback", () => {
    expect(readMcpConfig({})).toMatchObject({ host: "127.0.0.1", port: 3847, tokens: [] });
    const cfg = readMcpConfig({ MCP_HTTP_HOST: "0.0.0.0", MCP_HTTP_PORT: "4000" });
    expect(cfg.probeUrl).toBe("http://127.0.0.1:4000/mcp");
  });

  it("401 = online; 500 citando o token = sem token no servidor; erro = offline", async () => {
    expect((await probeMcpHttp("http://x/mcp", fakeFetch(401))).state).toBe("online");
    expect(
      (await probeMcpHttp("http://x/mcp", fakeFetch(500, '{"error":"MCP_HTTP_TOKEN é obrigatório"}'))).state
    ).toBe("misconfigured");
    const refused = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await probeMcpHttp("http://x/mcp", refused)).toMatchObject({ state: "offline", latencyMs: null });
  });

  it("informa token configurado sem nunca devolver o valor", async () => {
    const status = await getMcpStatus(
      { MCP_HTTP_TOKEN: "segredo-a, segredo-b", MCP_ALLOWED_CONNECTIONS: "loja" },
      fakeFetch(401)
    );
    expect(status.http).toMatchObject({ state: "online", tokenRequired: true, tokenConfigured: true, tokenCount: 2 });
    expect(status.scope.allowedConnections).toEqual(["loja"]);
    expect(JSON.stringify(status)).not.toContain("segredo");
  });

  it("401 do servidor prova que ele tem token, mesmo sem token no .env deste app", async () => {
    const status = await getMcpStatus({}, fakeFetch(401));
    expect(status.http).toMatchObject({ tokenConfigured: true, tokenCount: null });
    const offline = await getMcpStatus({}, vi.fn(async () => { throw new TypeError("x"); }) as unknown as typeof fetch);
    expect(offline.http).toMatchObject({ tokenConfigured: false, tokenCount: 0 });
  });
});

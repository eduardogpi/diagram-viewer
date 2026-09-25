// Entrypoint do servidor MCP. A ordem importa: "./env" carrega o .env antes de
// qualquer módulo de "@/lib" (Prisma lê DATABASE_URL na construção do client).
import "./env";

function wantsHttp(): boolean {
  if (process.argv.includes("--http")) return true;
  const transport = process.env.MCP_TRANSPORT?.trim().toLowerCase();
  return transport === "http" || transport === "streamable-http";
}

async function main() {
  if (wantsHttp()) {
    const { startHttpServer } = await import("./http");
    await startHttpServer();
    return;
  }

  const [{ StdioServerTransport }, { buildMcpServer }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("./app"),
  ]);

  const server = buildMcpServer();
  await server.connect(new StdioServerTransport());
  // stdio: qualquer log vai para stderr — stdout é exclusivo do protocolo JSON-RPC.
  console.error("MCP diagram-viewer-ai-modeling pronto (stdio).");
}

main().catch((error) => {
  console.error("Falha ao iniciar o servidor MCP:", error);
  process.exit(1);
});

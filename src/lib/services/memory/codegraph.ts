import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Cliente MCP do CodeGraph, usado só para a memória semântica do projeto.
 *
 * O namespace de memória é resolvido por chamada (`project_id` + `user_id`), nunca por estado
 * do servidor — `set_active_project` é global ao processo do MCP e quebraria o isolamento entre
 * usuários do workbench.
 */

const REQUEST_TIMEOUT_MS = 8000;

type CodegraphMemory = {
  id: number;
  content: string;
  memory_type: string;
  importance: number;
  tags: string[];
  similarity: number;
  created_at: string;
};

export function isCodegraphConfigured(): boolean {
  // Testes nunca falam com o MCP real. O Prisma Client carrega o .env, então CODEGRAPH_MCP_URL
  // fica visível dentro do vitest — sem este guard, qualquer teste que exercite um turno de
  // modelagem escreve memória de verdade no servidor do usuário (já aconteceu).
  if (process.env.VITEST) return false;
  return !!process.env.CODEGRAPH_MCP_URL;
}

/** Ajustável por ambiente: memórias mais numerosas pedem corte mais alto. */
function memoryThreshold(): number {
  const raw = Number(process.env.CODEGRAPH_MEMORY_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.3;
}

// Cache no escopo do módulo, no mesmo padrão do prisma: reconectar a cada request custaria um
// handshake MCP inteiro (initialize + SSE) antes de cada mensagem do chat.
const globalForMcp = globalThis as unknown as { codegraphClient?: Promise<Client> | null };

async function connect(): Promise<Client> {
  const url = process.env.CODEGRAPH_MCP_URL;
  if (!url) {
    throw new Error("CODEGRAPH_MCP_URL não configurada");
  }

  const token = process.env.CODEGRAPH_MCP_TOKEN;
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });

  const client = new Client({ name: "workbench-web", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function getClient(): Promise<Client> {
  if (!globalForMcp.codegraphClient) {
    globalForMcp.codegraphClient = connect().catch((err) => {
      // Não deixa uma promise rejeitada em cache: a próxima chamada tenta conectar de novo.
      globalForMcp.codegraphClient = null;
      throw err;
    });
  }
  return globalForMcp.codegraphClient;
}

/** Descarta a conexão atual para que a próxima chamada refaça o handshake. */
function resetClient() {
  globalForMcp.codegraphClient = null;
}

/**
 * Chama uma tool do MCP e devolve o JSON que ela retorna como texto. O CodeGraph responde
 * sempre em `content[0].text` com um JSON serializado.
 */
async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const client = await getClient();

  let result;
  try {
    result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    // Sessão expirada/servidor reiniciado deixa o transporte inutilizável — força reconexão.
    resetClient();
    throw err;
  }

  if (result.isError) {
    throw new Error(`Tool "${name}" retornou erro: ${JSON.stringify(result.content)}`);
  }

  const content = Array.isArray(result.content) ? result.content : [];
  const first = content.find((item): item is { type: "text"; text: string } => item?.type === "text");
  if (!first) {
    throw new Error(`Tool "${name}" não retornou conteúdo de texto`);
  }

  return JSON.parse(first.text) as T;
}

export type RecallParams = {
  projectId: string;
  userId: string;
  query: string;
  limit?: number;
  /**
   * Similaridade mínima. Fica no default do servidor (0.3) porque perguntas genéricas do tipo
   * "o que já decidimos aqui?" pontuam baixo (~0.32) contra memórias bem específicas — subir
   * isso silencia justamente o caso de uso principal. O teto de `limit` é quem contém o ruído.
   */
  threshold?: number;
};

export async function recallMemories(params: RecallParams): Promise<CodegraphMemory[]> {
  const data = await callTool<{ success: boolean; memories?: CodegraphMemory[] }>("memory_recall", {
    query: params.query,
    limit: params.limit ?? 6,
    threshold: params.threshold ?? memoryThreshold(),
    project_id: params.projectId,
    user_id: params.userId,
  });

  return data.memories ?? [];
}

export type SaveMemoryParams = {
  projectId: string;
  userId: string;
  sessionId: string;
  content: string;
  memoryType?: "fact" | "decision" | "preference" | "insight" | "checkpoint" | "outcome";
  tags?: string[];
  importance?: number;
};

export async function saveMemory(params: SaveMemoryParams): Promise<{ memoryId: number; deduplicated: boolean }> {
  const data = await callTool<{ memory_id: number; deduplicated: boolean }>("memory_add", {
    content: params.content,
    memory_type: params.memoryType ?? "decision",
    tags: params.tags ?? [],
    source: "conversation",
    project_id: params.projectId,
    user_id: params.userId,
    session_id: params.sessionId,
    importance: params.importance ?? 0.5,
  });

  return { memoryId: data.memory_id, deduplicated: data.deduplicated };
}

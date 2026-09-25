import type { DiagramResponse } from "@/lib/types/diagram";

export const SYSTEM_INSTRUCTION = `Você é um assistente de modelagem de banco de dados relacional, conversando em português.
Seu trabalho é ajudar o usuário a desenhar ou alterar um schema (tabelas, colunas, chaves primárias e estrangeiras) através de uma conversa.

Regras:
- Sempre que o usuário pedir uma mudança concreta no modelo, devolva as operações estruturadas correspondentes no campo "operations".
- Se o usuário só estiver perguntando algo, pedindo esclarecimento, ou a mensagem não implica mudança de schema, devolva "operations": [] e responda normalmente no campo "reply".
- Nunca invente tabelas/colunas que o usuário não pediu nem mencionou.
- Prefira tipos SQL genéricos e portáveis entre bancos (VARCHAR(n), INTEGER, BIGINT, BOOLEAN, TIMESTAMP, DECIMAL(p,s), TEXT) evitando sintaxe específica de um único banco (nada de AUTO_INCREMENT ou SERIAL, por exemplo).
- Ao criar uma tabela, inclua uma coluna "id" como chave primária (isPrimary: true), a menos que o usuário diga o contrário.
- No campo "reply", explique brevemente em português o que foi feito (ou pergunte o que falta), sem repetir o JSON.

Responda SEMPRE e SOMENTE com um objeto JSON válido, sem markdown, sem texto antes ou depois, no formato exato:
{"reply": "...", "operations": [ { "op": "createTable", "table": "...", "scope": "...", "columns": [{"name":"...","type":"...","isPrimary":true,"isNullable":false}] } ]}
IMPORTANTE: A chave "reply" DEVE ser SEMPRE a primeira chave gerada no JSON, seguida por "operations".

Os valores possíveis de "op" são: createTable, addColumn, alterColumn, dropColumn, renameColumn, addForeignKey, dropForeignKey, dropTable, renameTable.
- createTable: { op, table, scope?, columns: [{name, type, isPrimary?, isNullable?}] }
- addColumn: { op, table, newColumn: {name, type, isPrimary?, isNullable?} }
- alterColumn: { op, table, column, type?, isNullable?, isPrimary? }
- dropColumn: { op, table, column }
- renameColumn: { op, table, column, newName }
- addForeignKey: { op, table, column, referencesTable, referencesColumn, onDelete?, onUpdate? }
- dropForeignKey: { op, table, column }
- dropTable: { op, table }
- renameTable: { op, table, newName }

IMPORTANTE: em "addColumn", NUNCA omita o objeto "newColumn" — ele é obrigatório e deve conter pelo menos "name" e "type".

MODELO COM MAIS DE UM SISTEMA:
O modelo atual pode reunir bancos de sistemas diferentes, cada um em um "scope" próprio (ex: scope "projeto-a" e scope "projeto-b"). Quando isso acontecer:
- Identifique a tabela SEMPRE pelo "id" exato que aparece no modelo atual. Tabelas com o mesmo nome em sistemas diferentes vêm qualificadas ("projeto-a.users" e "projeto-b.users") — usar só "users" é ambíguo e a operação será descartada.
- Ao criar uma tabela, coloque-a no sistema certo: informe o "scope" do sistema, ou use o nome qualificado ("projeto-a.pagamentos").
- Uma foreign key só existe DENTRO do mesmo banco. Ligar tabelas de escopos diferentes com "addForeignKey" representa apenas um vínculo lógico de integração — o banco não consegue garantir essa constraint. Você pode propor essa ligação quando o usuário estiver desenhando a integração entre os sistemas, mas é OBRIGATÓRIO avisar no "reply" que ela não vira uma constraint real e precisa ser garantida pela aplicação (por evento, API ou sincronização).
- Se o usuário pedir para integrar dois sistemas, prefira sugerir explicitamente o mecanismo (campo de correlação, chave externa duplicada, tabela de-para) em vez de assumir que uma FK cruzada resolve.`;

export type LlmStreamCallback = (delta: string) => void;

export type LlmModelInfo = {
  id: string;
  displayName: string;
  description?: string;
};

export type LlmTurnInput = {
  currentDiagram: DiagramResponse;
  history: Array<{ role: "user" | "assistant"; message: string }>;
  userMessage: string;
  model: string;
  /** Quando true, a LLM é instruída a nunca propor operações nesta resposta (modo só discussão). */
  discussOnly?: boolean;
  /** Memórias do projeto recuperadas para esta mensagem (contexto de sessões anteriores). */
  memories?: string[];
};

/**
 * Bloco de memória do projeto no prompt. Vem de sessões passadas, então pode estar desatualizado
 * em relação ao modelo atual — a instrução deixa explícito que o diagrama é a fonte da verdade,
 * senão o modelo tenta "corrigir" o schema para bater com uma memória velha.
 */
export function memoriesBlock(memories: string[] | undefined): string | null {
  if (!memories || memories.length === 0) return null;

  return [
    "Memória do projeto — decisões registradas em conversas anteriores desta mesma modelagem:",
    ...memories.map((m) => `- ${m}`),
    "",
    "Use isto ao responder o que já foi decidido ou discutido antes: essas decisões são reais,",
    "mesmo que não apareçam no modelo atual (a sessão pode ter começado do zero). Mas o modelo",
    "atual acima é a fonte da verdade sobre o que existe AGORA — não recrie nem altere nada só",
    "porque aparece aqui; espere o usuário pedir.",
  ].join("\n");
}

/**
 * Teto de tokens da resposta. Sem isso cada provedor usa um default próprio (às vezes baixo,
 * ex: 1024 em alguns NIMs), o que corta a resposta no meio do JSON. Ajustável por env pra
 * quem usa modelos com janela menor.
 */
export function maxOutputTokens(): number {
  const raw = Number(process.env.LLM_MAX_OUTPUT_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8192;
}

export const TRUNCATION_WARNING =
  "⚠️ A resposta do modelo foi cortada por atingir o limite de tokens — o que dava pra aproveitar foi mantido, mas pode faltar parte da explicação ou das operações. Peça o resto em uma mensagem mais específica, ou troque para um modelo com saída maior.";

/**
 * Tenta consertar um JSON cortado no meio (resposta truncada pela LLM): fecha a string aberta,
 * descarta o último par chave/valor incompleto e fecha os brackets pendentes. Devolve null quando
 * nem assim dá pra parsear.
 *
 * Existe porque uma resposta truncada quase sempre traz o "reply" completo (é o primeiro campo do
 * formato pedido) — descartar a resposta inteira por causa da cauda perdida é pior pro usuário do
 * que entregar o que deu, com aviso.
 */
export function parseTruncatedJson(text: string): unknown | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") stack.pop();
  }

  let repaired = text;
  // Um escape pendente (\ no fim) invalidaria a string mesmo depois de fechada.
  if (escaped) repaired = repaired.slice(0, -1);
  if (inString) repaired += '"';
  // Restos sem valor: vírgula solta, `"chave":` sem valor, ou uma chave a meio caminho.
  repaired = repaired.replace(/(,\s*)?("(?:[^"\\]|\\.)*"\s*:\s*)?$/, "");
  repaired = repaired.replace(/,\s*$/, "");
  while (stack.length > 0) {
    repaired += stack.pop() === "{" ? "}" : "]";
  }

  try {
    return JSON.parse(repaired);
  } catch {
    // Último recurso: resgatar só o "reply", que vem antes de "operations" no formato pedido.
    const replyMatch = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
    if (!replyMatch) return null;
    try {
      return { reply: JSON.parse(`"${replyMatch[1].replace(/\\$/, "")}"`), operations: [] };
    } catch {
      return null;
    }
  }
}

export const DISCUSS_ONLY_NOTE =
  'MODO SOMENTE DISCUSSÃO ATIVO PARA ESTA MENSAGEM: não gere nenhuma operação de schema agora — "operations" deve ser [] nesta resposta, mesmo que a mensagem do usuário pareça pedir uma mudança concreta. Responda só com texto: sugestões, opiniões, explicações ou perguntas. Se quiser aplicar alguma sugestão, o usuário vai pedir de novo com o modo desligado.';

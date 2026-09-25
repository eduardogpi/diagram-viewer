import { describe, expect, it } from "vitest";

import { parseTruncatedJson } from "@/lib/services/llm/shared";

describe("parseTruncatedJson", () => {
  it("fecha objeto cortado depois de uma operação completa", () => {
    const parsed = parseTruncatedJson(
      '{"reply":"Criei a tabela","operations":[{"op":"createTable","table":"clientes","columns":[{"name":"id","type":"INTEGER"}]}'
    ) as { reply: string; operations: unknown[] };
    expect(parsed.reply).toBe("Criei a tabela");
    expect(parsed.operations).toHaveLength(1);
  });

  it("descarta o par chave/valor incompleto no fim", () => {
    const parsed = parseTruncatedJson('{"reply":"Ok","operations":[{"op":"dropTable","table":') as {
      reply: string;
      operations: unknown[];
    };
    expect(parsed.reply).toBe("Ok");
    expect(parsed.operations).toEqual([{ op: "dropTable" }]);
  });

  it("fecha string cortada no meio do reply", () => {
    const parsed = parseTruncatedJson('{"reply":"Vou criar as tabelas de pedid') as { reply: string };
    expect(parsed.reply).toBe("Vou criar as tabelas de pedid");
  });

  it("resgata só o reply quando o resto é irrecuperável", () => {
    const parsed = parseTruncatedJson('{"operations":[1,2,, "reply":"Explicação parcial') as {
      reply: string;
      operations: unknown[];
    };
    expect(parsed.reply).toBe("Explicação parcial");
    expect(parsed.operations).toEqual([]);
  });

  it("preserva escapes válidos dentro da string", () => {
    const parsed = parseTruncatedJson('{"reply":"linha 1\\nlinha 2 com \\"aspas\\" e mais') as { reply: string };
    expect(parsed.reply).toBe('linha 1\nlinha 2 com "aspas" e mais');
  });

  it("não quebra com escape pendente no corte", () => {
    const parsed = parseTruncatedJson('{"reply":"texto cortado no escape\\') as { reply: string };
    expect(parsed.reply).toBe("texto cortado no escape");
  });

  it("devolve null quando não há nada aproveitável", () => {
    expect(parseTruncatedJson("mensagem solta sem json")).toBeNull();
  });
});

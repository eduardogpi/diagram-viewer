import { describe, expect, it } from "vitest";

import { createJsonReplyExtractor } from "@/lib/services/llm/json-reply-extractor";

describe("createJsonReplyExtractor", () => {
  it("extrai reply emitido em um único bloco", () => {
    let deltas = "";
    const extractor = createJsonReplyExtractor((d) => {
      deltas += d;
    });

    extractor.feed('{"reply": "Olá mundo!", "operations": []}');
    expect(extractor.getReply()).toBe("Olá mundo!");
    expect(deltas).toBe("Olá mundo!");
    expect(extractor.isReplyCompleted()).toBe(true);
    expect(extractor.getFullText()).toBe('{"reply": "Olá mundo!", "operations": []}');
  });

  it("emite deltas fragmentados token a token", () => {
    const deltas: string[] = [];
    const extractor = createJsonReplyExtractor((d) => deltas.push(d));

    extractor.feed('{"re');
    extractor.feed('ply":');
    extractor.feed(' "Cri');
    extractor.feed("ando ");
    extractor.feed('tabela..."');
    extractor.feed(', "operations": []}');

    expect(extractor.getReply()).toBe("Criando tabela...");
    expect(deltas.join("")).toBe("Criando tabela...");
    expect(extractor.isReplyCompleted()).toBe(true);
  });

  it("trata escapes de quebra de linha, aspas e unicode", () => {
    let deltas = "";
    const extractor = createJsonReplyExtractor((d) => {
      deltas += d;
    });

    extractor.feed('{"reply": "Linha 1\\nLinha 2 com \\"aspas\\" e acento: \\u00e3", "operations": []}');
    expect(extractor.getReply()).toBe('Linha 1\nLinha 2 com "aspas" e acento: \u00e3');
    expect(deltas).toBe('Linha 1\nLinha 2 com "aspas" e acento: \u00e3');
  });

  it("tolera cercas de código markdown antes do JSON", () => {
    let deltas = "";
    const extractor = createJsonReplyExtractor((d) => {
      deltas += d;
    });

    extractor.feed('```json\n{\n  "reply": "Resposta com markdown",\n  "operations": []\n}\n```');
    expect(extractor.getReply()).toBe("Resposta com markdown");
    expect(deltas).toBe("Resposta com markdown");
  });

  it("ignora chaves ou valores 'reply' aninhados dentro de operations quando operations vem antes", () => {
    let deltas = "";
    const extractor = createJsonReplyExtractor((d) => {
      deltas += d;
    });

    extractor.feed(
      '{"operations": [{"op": "createTable", "table": "reply", "columns": [{"name": "reply", "type": "TEXT"}]}], "reply": "Resposta real no nível raiz"}'
    );
    expect(extractor.getReply()).toBe("Resposta real no nível raiz");
    expect(deltas).toBe("Resposta real no nível raiz");
    expect(extractor.isReplyCompleted()).toBe(true);
  });
});

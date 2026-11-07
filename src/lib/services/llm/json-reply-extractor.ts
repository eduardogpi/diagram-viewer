/**
 * Extrator incremental de texto da chave "reply" em streams de JSON de LLMs.
 *
 * Enquanto a LLM gera o JSON token a token:
 *   {"reply": "Criei a tabela de pedidos...", "operations": [...]}
 *
 * Este extrator localiza a abertura de "reply", decodifica escapes de string JSON
 * em tempo real e emite deltas de texto para o cliente, acumulando também o texto
 * completo para o parse final de "operations".
 */

export interface JsonReplyExtractor {
  feed: (chunk: string) => void;
  getReply: () => string;
  getFullText: () => string;
  isReplyCompleted: () => boolean;
}

export function createJsonReplyExtractor(onDelta?: (delta: string) => void): JsonReplyExtractor {
  let fullText = "";
  let replyText = "";
  let state: "SEEKING_KEY" | "IN_REPLY" | "FINISHED_REPLY" = "SEEKING_KEY";
  let escapeBuffer = "";

  // Estado do scanner estrutural enquanto procura a chave "reply" no nível raiz do JSON.
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let inStringEscape = false;
  let currentString = "";
  let isValueSlot = false;
  let expectingColonForReply = false;
  let expectingQuoteForReply = false;

  function handleReplyChar(char: string) {
    if (escapeBuffer.length > 0) {
      escapeBuffer += char;
      if (escapeBuffer === "\\u") {
        return;
      }
      if (escapeBuffer.startsWith("\\u")) {
        if (escapeBuffer.length === 6) {
          const code = Number.parseInt(escapeBuffer.slice(2), 16);
          const decoded = Number.isNaN(code) ? escapeBuffer : String.fromCharCode(code);
          replyText += decoded;
          onDelta?.(decoded);
          escapeBuffer = "";
        }
        return;
      }

      let decoded = "";
      switch (escapeBuffer[1]) {
        case '"':
          decoded = '"';
          break;
        case "\\":
          decoded = "\\";
          break;
        case "n":
          decoded = "\n";
          break;
        case "r":
          decoded = "\r";
          break;
        case "t":
          decoded = "\t";
          break;
        case "b":
          decoded = "\b";
          break;
        case "f":
          decoded = "\f";
          break;
        case "/":
          decoded = "/";
          break;
        default:
          decoded = escapeBuffer[1];
      }
      replyText += decoded;
      onDelta?.(decoded);
      escapeBuffer = "";
      return;
    }

    if (char === "\\") {
      escapeBuffer = "\\";
      return;
    }

    if (char === '"') {
      state = "FINISHED_REPLY";
      return;
    }

    replyText += char;
    onDelta?.(char);
  }

  function handleSeekingChar(char: string) {
    if (braceDepth === 0) {
      if (char === "{") {
        braceDepth = 1;
        isValueSlot = false;
      }
      return;
    }

    if (inString) {
      if (inStringEscape) {
        inStringEscape = false;
        currentString += char;
        return;
      }
      if (char === "\\") {
        inStringEscape = true;
        return;
      }
      if (char === '"') {
        inString = false;
        if (braceDepth === 1 && bracketDepth === 0 && !isValueSlot && currentString.toLowerCase() === "reply") {
          expectingColonForReply = true;
        }
        return;
      }
      currentString += char;
      return;
    }

    if (expectingColonForReply) {
      if (/\s/.test(char)) return;
      expectingColonForReply = false;
      if (char === ":") {
        isValueSlot = true;
        expectingQuoteForReply = true;
      }
      return;
    }

    if (expectingQuoteForReply) {
      if (/\s/.test(char)) return;
      expectingQuoteForReply = false;
      if (char === '"') {
        state = "IN_REPLY";
        return;
      }
      // Caso "reply" não seja string (ex: null), segue varrendo o objeto raiz.
      if (char === "{") braceDepth += 1;
      else if (char === "[") bracketDepth += 1;
      else if (char === ",") isValueSlot = false;
      return;
    }

    if (char === '"') {
      inString = true;
      currentString = "";
      return;
    }

    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (braceDepth === 1 && bracketDepth === 0) {
      if (char === ":") isValueSlot = true;
      else if (char === ",") isValueSlot = false;
    }
  }

  const isFinished = () => state === "FINISHED_REPLY";

  return {
    feed(chunk: string) {
      if (!chunk) return;
      fullText += chunk;

      if (isFinished()) {
        return;
      }

      for (const ch of chunk) {
        if (isFinished()) break;
        if (state === "SEEKING_KEY") {
          handleSeekingChar(ch);
        } else if (state === "IN_REPLY") {
          handleReplyChar(ch);
        }
      }
    },

    getReply() {
      return replyText;
    },

    getFullText() {
      return fullText;
    },

    isReplyCompleted() {
      return state === "FINISHED_REPLY";
    },
  };
}

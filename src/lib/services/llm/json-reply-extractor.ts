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

  function handleChar(char: string) {
    if (state === "SEEKING_KEY") {
      return;
    }

    if (state === "IN_REPLY") {
      if (escapeBuffer.length > 0) {
        escapeBuffer += char;
        if (escapeBuffer === "\\u") {
          return;
        }
        if (escapeBuffer.startsWith("\\u")) {
          if (escapeBuffer.length === 6) {
            try {
              const code = Number.parseInt(escapeBuffer.slice(2), 16);
              const decoded = String.fromCharCode(code);
              replyText += decoded;
              onDelta?.(decoded);
            } catch {
              replyText += escapeBuffer;
              onDelta?.(escapeBuffer);
            }
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
  }

  const isFinished = () => state === "FINISHED_REPLY";

  return {
    feed(chunk: string) {
      if (!chunk) return;
      fullText += chunk;

      if (isFinished()) {
        return;
      }

      if (state === "SEEKING_KEY") {
        const match = /"reply"\s*:\s*"/i.exec(fullText);
        if (match) {
          state = "IN_REPLY";
          const afterQuoteIndex = match.index + match[0].length;
          const remaining = fullText.slice(afterQuoteIndex);
          for (const ch of remaining) {
            if (isFinished()) break;
            handleChar(ch);
          }
        }
        return;
      }

      for (const ch of chunk) {
        if (isFinished()) break;
        handleChar(ch);
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

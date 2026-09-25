import { afterEach, describe, expect, it, vi } from "vitest";

import { listOpenAiCompatibleModels } from "@/lib/services/llm/openai-compatible";

function mockModels(data: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listOpenAiCompatibleModels", () => {
  it("mantém modelos com entrada multimodal e saída de texto", async () => {
    mockModels([
      { id: "a", name: "A", architecture: { modality: "text->text" } },
      { id: "b", name: "B", architecture: { modality: "text+image->text" } },
      { id: "c", name: "C", architecture: { modality: "text+image+file->text" } },
    ]);

    const models = await listOpenAiCompatibleModels({ baseUrl: "https://x/api/v1", apiKey: "k" });

    expect(models.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("descarta modelos cuja saída não é texto", async () => {
    mockModels([
      { id: "a", architecture: { modality: "text->text" } },
      { id: "img", architecture: { modality: "text->image" } },
    ]);

    const models = await listOpenAiCompatibleModels({ baseUrl: "https://x/api/v1", apiKey: "k" });

    expect(models.map((m) => m.id)).toEqual(["a"]);
  });

  it("mantém modelos sem architecture e marca os gratuitos", async () => {
    mockModels([
      { id: "sem-arquitetura", name: "Sem Arq" },
      { id: "free:free", name: "Grátis" },
      { id: "zero", name: "Zero", pricing: { prompt: "0" } },
    ]);

    const models = await listOpenAiCompatibleModels({ baseUrl: "https://x/api/v1", apiKey: "k" });

    expect(models.map((m) => m.id)).toEqual(["sem-arquitetura", "free:free", "zero"]);
    expect(models[1].displayName).toBe("🆓 Grátis");
    expect(models[2].displayName).toBe("🆓 Zero");
  });
});

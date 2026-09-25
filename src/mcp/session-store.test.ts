import { afterEach, describe, expect, it } from "vitest";

import { dropStickyState, getStickyState, sessionKey } from "@/mcp/session-store";

afterEach(() => {
  dropStickyState("agent-a");
  dropStickyState("agent-b");
  dropStickyState(undefined);
});

describe("MCP sticky state", () => {
  it("isola conexão ativa por sessionId do transporte", () => {
    const a = getStickyState("agent-a");
    const b = getStickyState("agent-b");
    a.activeConnectionId = "conn-a";
    b.activeConnectionId = "conn-b";

    expect(getStickyState("agent-a").activeConnectionId).toBe("conn-a");
    expect(getStickyState("agent-b").activeConnectionId).toBe("conn-b");
    expect(getStickyState("agent-a")).not.toBe(getStickyState("agent-b"));
  });

  it("agrupa chamadas sem sessionId no mesmo estado stdio", () => {
    expect(sessionKey(undefined)).toBe("stdio");
    expect(sessionKey("")).toBe("stdio");
    const first = getStickyState(undefined);
    first.activeConnectionId = "local";
    expect(getStickyState(null).activeConnectionId).toBe("local");
  });
});

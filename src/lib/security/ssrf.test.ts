import { describe, expect, it } from "vitest";

import { isPrivateOrReservedHost } from "./ssrf";

describe("anti-SSRF", () => {
  it("bloqueia loopback", () => {
    expect(isPrivateOrReservedHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("localhost")).toBe(true);
    expect(isPrivateOrReservedHost("::1")).toBe(true);
  });

  it("bloqueia RFC1918", () => {
    expect(isPrivateOrReservedHost("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("192.168.1.50")).toBe(true);
  });

  it("bloqueia link-local e metadata de nuvem", () => {
    expect(isPrivateOrReservedHost("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedHost("metadata.google.internal")).toBe(true);
  });

  it("permite hosts públicos", () => {
    expect(isPrivateOrReservedHost("db.example.com")).toBe(false);
    expect(isPrivateOrReservedHost("8.8.8.8")).toBe(false);
  });
});

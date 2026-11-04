import { describe, expect, it } from "vitest";

import { hashSql, summarizeSql } from "./rate-limit";

describe("hashSql / summarizeSql", () => {
  it("hash estável e sem literais", () => {
    const sql = "SELECT * FROM users WHERE email = 'a@b.com'";
    expect(hashSql(sql)).toHaveLength(16);
    expect(summarizeSql(sql)).not.toContain("a@b.com");
    expect(summarizeSql(sql)).toContain("SELECT");
  });

  it("trunca resumos longos", () => {
    const long = `SELECT ${"a, ".repeat(100)}1`;
    expect(summarizeSql(long, 50).length).toBeLessThanOrEqual(51);
  });
});

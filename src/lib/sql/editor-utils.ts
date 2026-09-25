export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = columns.map(escape).join(",");
  const lines = rows.map((row) => columns.map((column) => escape(row[column])).join(","));
  return [header, ...lines].join("\n");
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Palavras-chave do dialeto (mais longas primeiro, para casar "INNER JOIN" antes de "JOIN"). */
const KEYWORDS = [
  "LEFT OUTER JOIN",
  "RIGHT OUTER JOIN",
  "FULL OUTER JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "CROSS JOIN",
  "GROUP BY",
  "ORDER BY",
  "UNION ALL",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "INSERT",
  "UPDATE",
  "DELETE",
  "VALUES",
  "SET",
  "AND",
  "OR",
].sort((a, b) => b.length - a.length);

// Um único regex com alternância (mais longas primeiro) evita re-casar "JOIN" dentro de "INNER JOIN".
const KEYWORD_PATTERN = new RegExp(
  `\\b(${KEYWORDS.map((keyword) => keyword.replace(/ /g, "\\s+")).join("|")})\\b`,
  "gi"
);

/** Formatação básica: normaliza espaços, coloca cláusulas em linhas e deixa keywords em maiúsculas. */
export function formatSql(sql: string): string {
  const out = sql
    .replace(/\s+/g, " ")
    .trim()
    .replace(KEYWORD_PATTERN, (match) => `\n${match.toUpperCase()}`);

  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

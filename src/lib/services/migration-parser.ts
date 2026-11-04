import { createHash } from "node:crypto";

import { computeDiagramDiff } from "@/lib/diagram-diff";
import type {
  DiagramColumnDTO,
  DiagramEdgeDTO,
  DiagramNodeDTO,
  DiagramResponse,
  DiagramScopeDTO,
} from "@/lib/types/diagram";
import type {
  MigrationFile,
  MigrationFileInput,
  MigrationMergeResult,
  MigrationParseResult,
  MigrationParseWarning,
  MigrationSnapshot,
  MigrationSnapshotStats,
  MigrationSourceProvider,
} from "@/lib/types/migrations";

type ParseWarning = { statement: string; reason: string };

/**
 * Versão da lógica de parsing. Os snapshots são persistidos no banco, então pacotes importados
 * com uma versão anterior continuam com o resultado antigo até serem reprocessados. Bumpe este
 * número SEMPRE que a interpretação do DDL mudar (novos dialetos, correções de reconhecimento).
 */
export const PARSER_VERSION = 3;

type StatementResult =
  | { status: "applied" }
  | { status: "ignored" }
  | { status: "unsupported"; warning: ParseWarning };

type ColumnState = {
  name: string;
  type: string;
  isNullable: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  references?: { table: string; column: string };
  fkMetadata?: {
    constraintName: string;
    onDelete: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" | "NO ACTION";
    onUpdate: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" | "NO ACTION";
  };
};

type ForeignKeyState = {
  constraintName: string;
  sourceTable: string;
  targetTable: string;
  columns: Array<{ source: string; target: string }>;
  onDelete: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" | "NO ACTION";
  onUpdate: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" | "NO ACTION";
};

type TableState = {
  name: string;
  schema: string;
  columns: Map<string, ColumnState>;
  primaryKeys: string[];
  foreignKeys: Map<string, ForeignKeyState>;
  /** Pasta/módulo do arquivo de migration onde a tabela foi originalmente criada. */
  module: string;
};

type SchemaState = {
  tables: Map<string, TableState>;
};

const FLYWAY_VERSION_PATTERN = /^V(\d+(?:[._]\d+)*)__.*$/i;
const FLYWAY_REPEATABLE_PATTERN = /^R__.*$/i;

/**
 * Extrai o "módulo" (diretório pai) de um arquivo para ordenação por pasta.
 * Ex: "resources/db/migration/core/V1__init.sql" -> "resources/db/migration/core"
 *     "V1__init.sql" -> ""
 */
function modulePathOf(file: MigrationFileInput): string {
  const reference = file.path ?? file.name;
  const normalized = reference.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
}

/**
 * Nome base do arquivo (sem diretório), usado para detectar versão Flyway.
 */
function baseNameOf(file: MigrationFileInput): string {
  const reference = file.path ?? file.name;
  const normalized = reference.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

function humanizeScope(value: string) {
  const normalized = value.replace(/_/g, " ");
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveScope(tableName: string, schema: string) {
  const [prefix] = tableName.split("_");
  if (!prefix || prefix.length < 3) {
    return schema;
  }
  return prefix;
}

/**
 * Último segmento do caminho de módulo (ex: "migration/v1_auxiliar" -> "v1_auxiliar").
 * Usado como scope/módulo do diagrama quando o pacote de migrations preserva a
 * estrutura de pastas (zip ou upload de pasta inteira).
 */
function moduleLastSegment(modulePath: string): string {
  if (!modulePath) return "";
  const normalized = modulePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

/**
 * Identificador SQL: palavra simples, "entre aspas", `crase` ou [colchete].
 * O Oracle (DBMS_METADATA / Flyway export) escreve o DDL com tudo entre aspas e qualificado
 * por schema — `CREATE TABLE "NEXO"."ALUNOS"` — então as aspas podem aparecer em CADA parte
 * do nome, não só no início e no fim.
 */
const ID_PART = '(?:[A-Za-z_][\\w$#]*|"[^"]*"|`[^`]*`|\\[[^\\]]*\\])';
/** Identificador qualificado: parte(.parte)* — ex.: `"NEXO"."ALUNOS"` ou `schema.tabela`. */
const QUALIFIED_ID = `${ID_PART}(?:\\s*\\.\\s*${ID_PART})*`;

/** Divide um nome qualificado respeitando aspas: `"NEXO"."ALUNOS"` -> [`"NEXO"`, `"ALUNOS"`]. */
function splitQualifiedName(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let closingQuote: string | null = null;

  for (const char of raw) {
    if (closingQuote) {
      current += char;
      if (char === closingQuote) closingQuote = null;
      continue;
    }
    if (char === '"' || char === "`") {
      closingQuote = char;
      current += char;
      continue;
    }
    if (char === "[") {
      closingQuote = "]";
      current += char;
      continue;
    }
    if (char === ".") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Remove as aspas/colchetes/crases que envolvem um identificador. */
function normalizeName(raw: string): string {
  const trimmed = raw.trim();
  const wrapped = /^(["`\[])([\s\S]*)(["`\]])$/.exec(trimmed);
  if (
    wrapped &&
    ((wrapped[1] === '"' && wrapped[3] === '"') ||
      (wrapped[1] === "`" && wrapped[3] === "`") ||
      (wrapped[1] === "[" && wrapped[3] === "]"))
  ) {
    return wrapped[2].trim();
  }
  return trimmed.replace(/^[`"\[]|[`"\]]$/g, "").trim();
}

/** Nome da tabela + schema a partir de um identificador (possivelmente qualificado e com aspas). */
function parseQualifiedName(raw: string, fallbackSchema: string): { name: string; schema: string } {
  const parts = splitQualifiedName(raw).map(normalizeName);
  return {
    name: parts[parts.length - 1] ?? "",
    schema: parts.length > 1 ? parts.slice(0, -1).join(".") : fallbackSchema,
  };
}

/**
 * Palavras que podem abrir uma definição de coluna mas não são um tipo. Sem isso,
 * `MODIFY CPF NULL` viraria uma coluna do tipo "NULL" e `ALTER COLUMN c SET DEFAULT 0`
 * viraria tipo "SET".
 */
const TYPE_KEYWORDS = new Set([
  "NULL",
  "NOT",
  "DEFAULT",
  "PRIMARY",
  "UNIQUE",
  "CHECK",
  "REFERENCES",
  "CONSTRAINT",
  "AUTO_INCREMENT",
  "AUTOINCREMENT",
  "GENERATED",
  "IDENTITY",
  "COMMENT",
  "COLLATE",
  "SET",
  "DROP",
  "TYPE",
  "FIRST",
  "AFTER",
  "ON",
  "USING",
  "RESTRICT",
  "CASCADE",
  "VISIBLE",
  "INVISIBLE",
  "STORAGE",
]);

/** Extrai o tipo da definição de coluna, ou "UNKNOWN" quando o primeiro token é um modificador. */
function extractColumnType(rest: string): string {
  const match = /^([A-Za-z][\w]*(?:\s*\([^)]*\))?)/.exec(rest);
  const raw = match ? match[1].trim() : rest.split(/\s+/)[0] ?? "UNKNOWN";
  return TYPE_KEYWORDS.has(raw.toUpperCase()) ? "UNKNOWN" : raw;
}

/**
 * Statements reconhecidos que não mudam a forma do schema. São contados como "ignorados"
 * (não como warning) — senão um projeto Oracle gera milhares de avisos inúteis de
 * INSERT/SEQUENCE/TRIGGER e o badge da timeline perde o sentido.
 */
const IGNORED_PREFIXES = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "SELECT",
  "TRUNCATE",
  "CALL",
  "EXEC",
  "CREATE SEQUENCE",
  "ALTER SEQUENCE",
  "DROP SEQUENCE",
  "CREATE INDEX",
  "CREATE UNIQUE INDEX",
  "DROP INDEX",
  "ALTER INDEX",
  "GRANT",
  "REVOKE",
  "COMMENT ON",
  "ANALYZE",
  "VACUUM",
  "EXPLAIN",
  "SET ",
  "PRAGMA ",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "START TRANSACTION",
  "END",
  "DECLARE",
  "EXCEPTION",
  "LOOP",
  "RAISE",
  "RETURN",
  "THEN",
  "ELSE",
  "ELSIF",
  "GO",
];

const IGNORED_PATTERNS = [
  /^\/+$/,
  /^CREATE\s+(OR\s+REPLACE\s+)?(FORCE\s+)?(EDITIONABLE\s+)?(NONEDITIONABLE\s+)?TRIGGER\b/,
  /^(ALTER|DROP)\s+TRIGGER\b/,
  /^CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|PACKAGE|TYPE|SYNONYM|VIEW|MATERIALIZED\s+VIEW|EVENT|DATABASE|SCHEMA|USER|ROLE|TABLESPACE|EXTENSION|DOMAIN|SERVER|SEQUENCE)\b/,
  /^(ALTER|DROP)\s+(FUNCTION|PROCEDURE|PACKAGE|TYPE|SYNONYM|VIEW|MATERIALIZED\s+VIEW|EVENT|DATABASE|SCHEMA|USER|ROLE|EXTENSION|DOMAIN|SERVER)\b/,
];

function isIgnoredStatement(upper: string): boolean {
  if (IGNORED_PATTERNS.some((pattern) => pattern.test(upper))) return true;
  return IGNORED_PREFIXES.some((prefix) => upper === prefix.trim() || upper.startsWith(prefix));
}

function checksumOf(content: string): string {
  return createHash("sha256").update(content.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

function detectProvider(files: MigrationFileInput[]): MigrationSourceProvider {
  return files.some((file) => {
    const base = baseNameOf(file);
    return FLYWAY_VERSION_PATTERN.test(base) || FLYWAY_REPEATABLE_PATTERN.test(base);
  })
    ? "flyway"
    : "sql";
}

function flywayOrder(name: string): number[] | null {
  const match = FLYWAY_VERSION_PATTERN.exec(name);
  if (!match) {
    return null;
  }
  return match[1].split(/[._]/).map((part) => Number.parseInt(part, 10));
}

/** Compara versões Flyway parte a parte (V1.2 < V1.2.1 < V1.10); versão menor ganha zeros à direita. */
function compareFlywayVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function orderFiles(files: MigrationFileInput[]): MigrationFileInput[] {
  const withOrder = files.map((file, index) => {
    const base = baseNameOf(file);
    const flyway = flywayOrder(base);
    return { file, base, module: modulePathOf(file), flyway, originalIndex: index };
  });

  const flywayFiles = withOrder.filter((entry) => entry.flyway !== null);
  const otherFiles = withOrder.filter((entry) => entry.flyway === null);

  // Flyway: ordena por módulo (caminho da pasta) e depois por versão V__ dentro do módulo.
  // Isso preserva a semântica de múltiplas pastas de migration (ex: core/V1, core/V2, billing/V1...).
  flywayFiles.sort((a, b) => {
    const moduleCmp = a.module.localeCompare(b.module, "en", { numeric: true });
    if (moduleCmp !== 0) return moduleCmp;
    return compareFlywayVersions(a.flyway!, b.flyway!);
  });

  otherFiles.sort((a, b) => {
    const moduleCmp = a.module.localeCompare(b.module, "en", { numeric: true });
    if (moduleCmp !== 0) return moduleCmp;
    return a.base.localeCompare(b.base, "en", { numeric: true });
  });

  return [...flywayFiles, ...otherFiles].map((entry) => entry.file);
}

/** Início de um objeto PL/SQL (ou bloco anônimo): o `;` interno NÃO termina o statement. */
const PLSQL_START =
  /^(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:FORCE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:TRIGGER|FUNCTION|PROCEDURE|PACKAGE|TYPE)\b|DECLARE\b|BEGIN\b)/i;

/**
 * Divide o script em statements. Blocos PL/SQL (trigger, procedure, function, package, bloco
 * anônimo) têm `;` internos, então ali o statement só termina em:
 *  - uma linha contendo apenas `/` (terminador do Oracle/SQL*Plus — o Flyway exige);
 *  - `;` após o `END` que fecha o `BEGIN` (balanceando BEGIN/IF/LOOP/CASE ... END);
 *  - `;` de um objeto sem corpo procedural (ex.: `CREATE TRIGGER ... EXECUTE FUNCTION f();`).
 * Strings entre `$tag$ ... $tag$` (Postgres) também protegem os `;` internos.
 */
function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let dollarTag: string | null = null;
  let parenDepth = 0;

  // Estado do bloco PL/SQL.
  let word = "";
  let wordCount = 0;
  let previousWord = "";
  let blockDecided = false;
  let inBlock = false;
  let beginSeen = false;
  let blockDepth = 0;
  let proceduralHeader = false; // viu IS/AS/DECLARE: o corpo ainda vem
  let dollarClosed = false;

  const resetBlock = () => {
    word = "";
    wordCount = 0;
    previousWord = "";
    blockDecided = false;
    inBlock = false;
    beginSeen = false;
    blockDepth = 0;
    proceduralHeader = false;
    dollarClosed = false;
  };

  const flushWord = () => {
    if (!word) return;
    const upper = word.toUpperCase();
    word = "";
    wordCount += 1;

    if (!blockDecided) {
      if (PLSQL_START.test(current.trim())) {
        blockDecided = true;
        inBlock = true;
      } else if (wordCount >= 6) {
        blockDecided = true;
      }
    }

    if (inBlock) {
      if (upper === "IS" || upper === "AS" || upper === "DECLARE") proceduralHeader = true;
      if (upper === "BEGIN") {
        beginSeen = true;
        blockDepth += 1;
      } else if (upper === "END") {
        blockDepth = Math.max(0, blockDepth - 1);
      } else if ((upper === "IF" || upper === "LOOP" || upper === "CASE") && previousWord !== "END") {
        // "END IF"/"END LOOP"/"END CASE" já foram contados pelo END.
        if (beginSeen) blockDepth += 1;
      }
    }
    previousWord = upper;
  };

  const pushStatement = () => {
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    current = "";
    resetBlock();
  };

  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    const next = script[i + 1];

    if (dollarTag) {
      current += char;
      if (char === "$" && script.startsWith(dollarTag, i)) {
        current += dollarTag.slice(1);
        i += dollarTag.length - 1;
        dollarTag = null;
        dollarClosed = true;
      }
      continue;
    }

    if (char === "'" && !inDouble && !inBacktick) {
      flushWord();
      if (inSingle && next === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (char === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      current += char;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (char === "$") {
        const tag = /^\$[A-Za-z_]*\$/.exec(script.slice(i, i + 64));
        if (tag) {
          flushWord();
          dollarTag = tag[0];
          current += tag[0];
          i += tag[0].length - 1;
          continue;
        }
      }

      if (/[A-Za-z_]/.test(char) || (word && /[\w$#]/.test(char))) {
        word += char;
        current += char;
        continue;
      }
      flushWord();

      if (char === "(") parenDepth += 1;
      if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

      // Terminador do Oracle/SQL*Plus: linha só com "/". Fecha o bloco PL/SQL em andamento ou, sem
      // conteúdo acumulado, é só descartado — senão viraria um statement inválido.
      if (char === "/" && parenDepth === 0) {
        const lastLine = current.slice(current.lastIndexOf("\n") + 1);
        const restOfLine = script.slice(i + 1, script.indexOf("\n", i) === -1 ? undefined : script.indexOf("\n", i));
        if (lastLine.trim() === "" && restOfLine.trim() === "") {
          pushStatement();
          continue;
        }
      }

      if (char === ";" && parenDepth === 0) {
        const endsBlock = !inBlock
          ? true
          : beginSeen
            ? blockDepth === 0
            : dollarClosed || !proceduralHeader;
        if (endsBlock) {
          pushStatement();
          continue;
        }
      }
    }
    current += char;
  }

  flushWord();
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function parseReferentialAction(raw: string | undefined): ForeignKeyState["onDelete"] {
  if (!raw) return "RESTRICT";
  const upper = raw.toUpperCase().trim();
  if (upper === "CASCADE") return "CASCADE";
  if (upper === "SET NULL") return "SET NULL";
  if (upper === "SET DEFAULT") return "SET DEFAULT";
  if (upper === "NO ACTION") return "NO ACTION";
  return "RESTRICT";
}

function extractReferenceClause(columnDef: string): {
  table: string;
  column: string;
  onDelete: ForeignKeyState["onDelete"];
  onUpdate: ForeignKeyState["onDelete"];
} | null {
  const match = new RegExp(
    `REFERENCES\\s+(${QUALIFIED_ID})\\s*\\(\\s*(${ID_PART})\\s*\\)`,
    "i"
  ).exec(columnDef);
  if (!match) return null;

  const table = parseQualifiedName(match[1], "").name;
  const column = normalizeName(match[2]);

  const onDeleteMatch = /ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION|RESTRICT)/i.exec(
    columnDef
  );
  const onUpdateMatch = /ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION|RESTRICT)/i.exec(
    columnDef
  );

  return {
    table,
    column,
    onDelete: parseReferentialAction(onDeleteMatch?.[1]),
    onUpdate: parseReferentialAction(onUpdateMatch?.[1]),
  };
}

function splitTopLevelCommas(inner: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (const char of inner) {
    if (char === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (char === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (char === "`" && !inSingle && !inDouble) inBacktick = !inBacktick;
    else if (!inSingle && !inDouble && !inBacktick) {
      if (char === "(") depth += 1;
      else if (char === ")") depth = Math.max(0, depth - 1);
      else if (char === "," && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Chave do estado: o nome da tabela sozinho não basta quando o pacote reúne migrations de mais
 * de um projeto/módulo — dois sistemas costumam ter uma tabela "users" cada, e indexar só pelo
 * nome faria as duas virarem uma só, com as colunas mescladas silenciosamente.
 */
function tableKey(module: string, name: string): string {
  return `${module} ${name}`;
}

function ensureTable(state: SchemaState, name: string, schema: string, module: string): TableState {
  const key = tableKey(module, name);
  let table = state.tables.get(key);
  if (!table) {
    table = { name, schema, columns: new Map(), primaryKeys: [], foreignKeys: new Map(), module };
    state.tables.set(key, table);
  }
  return table;
}

/**
 * Encontra a tabela que um statement referencia: primeiro no próprio módulo, depois em qualquer
 * outro (é comum um projeto manter os ALTER numa pasta separada dos CREATE). Havendo o mesmo nome
 * em vários módulos e nenhum no atual, usa o primeiro declarado — determinístico pela ordem dos
 * arquivos, e idêntico ao comportamento anterior quando o pacote tem um projeto só.
 */
function findTable(state: SchemaState, name: string, module: string): TableState | undefined {
  const sameModule = state.tables.get(tableKey(module, name));
  if (sameModule) return sameModule;
  for (const table of state.tables.values()) {
    if (table.name === name) return table;
  }
  return undefined;
}

function findTableKey(state: SchemaState, name: string, module: string): string | undefined {
  const key = tableKey(module, name);
  if (state.tables.has(key)) return key;
  for (const [candidateKey, table] of state.tables) {
    if (table.name === name) return candidateKey;
  }
  return undefined;
}

/** Conteúdo do primeiro par de parênteses a partir de `from`, respeitando aspas e aninhamento. */
function extractBalancedParens(text: string, from: number): { inner: string; end: number } | null {
  const open = text.indexOf("(", from);
  if (open === -1) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** Marca colunas como chave primária (`PRIMARY KEY (a, b)`, inline ou via CONSTRAINT nomeada). */
function applyPrimaryKeyConstraint(table: TableState, part: string): void {
  const pkMatch = /PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(part);
  if (!pkMatch) return;
  for (const raw of pkMatch[1].split(",")) {
    const col = normalizeName(raw.trim());
    if (!col) continue;
    if (!table.primaryKeys.includes(col)) table.primaryKeys.push(col);
    const existing = table.columns.get(col);
    if (existing) existing.isPrimary = true;
  }
}

/**
 * `CREATE TABLE t AS SELECT ...` (CTAS — comum em tabelas de backup `*_BKP_2025`). Sem colunas
 * declaradas, copia da tabela de origem quando o SELECT é `*` ou uma lista de colunas simples;
 * constraints (PK/FK) não são herdadas, como no banco.
 */
function applyCreateTableAsSelect(
  state: SchemaState,
  statement: string,
  schemaName: string,
  module: string
): ParseWarning | null | undefined {
  const match = new RegExp(
    `^CREATE\\s+(?:GLOBAL\\s+TEMPORARY\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED_ID})\\s*(?:\\([^)]*\\)\\s*)?AS\\s*\\(?\\s*SELECT\\s+([\\s\\S]*?)\\s+FROM\\s+(${QUALIFIED_ID})`,
    "i"
  ).exec(statement);
  if (!match) return undefined;

  const { name: tableName, schema } = parseQualifiedName(match[1], schemaName);
  const source = findTable(state, parseQualifiedName(match[3], "").name, module);
  const table = ensureTable(state, tableName, schema, module);
  table.module = module;
  table.columns.clear();
  table.primaryKeys = [];
  table.foreignKeys.clear();

  const selectList = match[2].trim();
  const copy = (name: string, alias: string) => {
    const original = source?.columns.get(name);
    table.columns.set(alias, {
      name: alias,
      type: original?.type ?? "UNKNOWN",
      isNullable: original?.isNullable ?? true,
      isPrimary: false,
      isForeign: false,
    });
  };

  if (selectList === "*" || /^[\w$#"]+\.\*$/.test(selectList)) {
    source?.columns.forEach((column) => copy(column.name, column.name));
  } else {
    for (const item of splitTopLevelCommas(selectList)) {
      // `expr AS alias`, `expr alias` ou `[tabela.]coluna`; expressões sem alias não têm nome estável.
      const aliased = new RegExp(`(?:\\bAS\\s+)?(${ID_PART})\\s*$`, "i").exec(item);
      const bare = new RegExp(`^(?:${ID_PART}\\.)?(${ID_PART})$`, "i").exec(item.trim());
      const original = normalizeName((bare ?? aliased)?.[1] ?? "");
      if (!original) continue;
      copy(bare ? original : normalizeName(aliased?.[1] ?? original), bare ? original : normalizeName(aliased?.[1] ?? original));
    }
  }
  return null;
}

function applyCreateTable(
  state: SchemaState,
  statement: string,
  schemaName: string,
  module: string
): ParseWarning | null {
  const ctas = applyCreateTableAsSelect(state, statement, schemaName, module);
  if (ctas !== undefined) return ctas;

  const header = new RegExp(`^CREATE\\s+(?:GLOBAL\\s+TEMPORARY\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED_ID})\\s*(?=\\()`, "i").exec(statement);
  const body = header ? extractBalancedParens(statement, header[0].length) : null;
  if (!header || !body) {
    return { statement, reason: "CREATE TABLE não reconhecido" };
  }

  const { name: tableName, schema } = parseQualifiedName(header[1], schemaName);
  const inner = body.inner;

  const table = ensureTable(state, tableName, schema, module);
  table.module = module;
  table.columns.clear();
  table.primaryKeys = [];
  table.foreignKeys.clear();

  const parts = splitTopLevelCommas(inner);
  let columnPosition = 0;

  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper.startsWith("PRIMARY KEY")) {
      applyPrimaryKeyConstraint(table, part);
      continue;
    }
    if (upper.startsWith("CONSTRAINT") || upper.startsWith("FOREIGN KEY") || upper.startsWith("UNIQUE") || upper.startsWith("KEY") || upper.startsWith("INDEX") || upper.startsWith("CHECK")) {
      if (upper.includes("FOREIGN KEY")) {
        applyForeignKeyConstraint(table, part);
      } else if (/^CONSTRAINT\s+\S+\s+PRIMARY\s+KEY/i.test(part)) {
        applyPrimaryKeyConstraint(table, part);
      }
      continue;
    }

    const columnMatch = new RegExp(`^(${ID_PART})\\s+([\\s\\S]+)$`, "i").exec(part);
    if (columnMatch) {
      const columnName = normalizeName(columnMatch[1]);
      const rest = columnMatch[2];
      const type = extractColumnType(rest);
      const isNullable = !/\bNOT\s+NULL\b/i.test(rest);
      const isPrimary = /\bPRIMARY\s+KEY\b/i.test(rest);
      const reference = extractReferenceClause(rest);

      const column: ColumnState = {
        name: columnName,
        type,
        isNullable,
        isPrimary,
        isForeign: !!reference,
      };
      if (reference) {
        column.references = { table: reference.table, column: reference.column };
        const fkName = `fk_${tableName}_${columnName}_${columnPosition}`;
        table.foreignKeys.set(fkName, {
          constraintName: fkName,
          sourceTable: tableName,
          targetTable: reference.table,
          columns: [{ source: columnName, target: reference.column }],
          onDelete: reference.onDelete,
          onUpdate: reference.onUpdate,
        });
        column.fkMetadata = {
          constraintName: fkName,
          onDelete: reference.onDelete,
          onUpdate: reference.onUpdate,
        };
      }
      table.columns.set(columnName, column);
      if (isPrimary && !table.primaryKeys.includes(columnName)) {
        table.primaryKeys.push(columnName);
      }
      columnPosition += 1;
    }
  }

  return null;
}

function applyForeignKeyConstraint(table: TableState, part: string): void {
  const match = new RegExp(
    `(?:CONSTRAINT\\s+${ID_PART}\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s*REFERENCES\\s+(${QUALIFIED_ID})\\s*\\(([^)]+)\\)\\s*([\\s\\S]*)$`,
    "i"
  ).exec(part);
  if (!match) return;

  const sourceCols = splitTopLevelCommas(match[1]).map((c) => normalizeName(c));
  const targetTable = parseQualifiedName(match[2], "").name;
  const targetCols = splitTopLevelCommas(match[3]).map((c) => normalizeName(c));
  const tail = match[4] ?? "";

  const onDeleteMatch = /ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION|RESTRICT)/i.exec(tail);
  const onUpdateMatch = /ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION|RESTRICT)/i.exec(tail);

  const constraintMatch = new RegExp(`CONSTRAINT\\s+(${ID_PART})\\s+`, "i").exec(part);
  const constraintName = constraintMatch
    ? normalizeName(constraintMatch[1])
    : `fk_${table.name}_${sourceCols.join("_")}`;

  const columns = sourceCols.map((source, idx) => ({
    source,
    target: targetCols[idx] ?? targetCols[0] ?? "",
  }));

  table.foreignKeys.set(constraintName, {
    constraintName,
    sourceTable: table.name,
    targetTable,
    columns,
    onDelete: parseReferentialAction(onDeleteMatch?.[1]),
    onUpdate: parseReferentialAction(onUpdateMatch?.[1]),
  });

  sourceCols.forEach((sourceCol) => {
    const column = table.columns.get(sourceCol);
    if (column) {
      column.isForeign = true;
      column.references = { table: targetTable, column: targetCols[0] ?? "" };
      column.fkMetadata = {
        constraintName,
        onDelete: parseReferentialAction(onDeleteMatch?.[1]),
        onUpdate: parseReferentialAction(onUpdateMatch?.[1]),
      };
    }
  });
}

/**
 * Aplica uma definição de coluna a uma tabela já existente (ADD COLUMN e o ADD em bloco do
 * Oracle: `ALTER TABLE t ADD (c1 tipo, c2 tipo)`).
 */
function applyAddedColumn(table: TableState, columnDef: string, tableName: string): void {
  const columnMatch = new RegExp(`^(${ID_PART})\\s+([\\s\\S]+)$`, "i").exec(columnDef.trim());
  if (!columnMatch) return;

  const columnName = normalizeName(columnMatch[1]);
  const rest = columnMatch[2];
  const isPrimary = /\bPRIMARY\s+KEY\b/i.test(rest);
  const reference = extractReferenceClause(rest);

  const column: ColumnState = {
    name: columnName,
    type: extractColumnType(rest),
    isNullable: !/\bNOT\s+NULL\b/i.test(rest),
    isPrimary,
    isForeign: !!reference,
  };

  if (reference) {
    column.references = { table: reference.table, column: reference.column };
    const fkName = `fk_${tableName}_${columnName}`;
    table.foreignKeys.set(fkName, {
      constraintName: fkName,
      sourceTable: tableName,
      targetTable: reference.table,
      columns: [{ source: columnName, target: reference.column }],
      onDelete: reference.onDelete,
      onUpdate: reference.onUpdate,
    });
    column.fkMetadata = {
      constraintName: fkName,
      onDelete: reference.onDelete,
      onUpdate: reference.onUpdate,
    };
  }

  table.columns.set(columnName, column);
  if (isPrimary && !table.primaryKeys.includes(columnName)) table.primaryKeys.push(columnName);
}

/** MODIFY/ALTER COLUMN: só o que vem explícito no statement sobrescreve o estado existente. */
function applyModifiedColumn(table: TableState, columnName: string, rest: string): void {
  const existing = table.columns.get(columnName);
  if (!existing) return;

  // "MODIFY CPF NULL" e "ALTER COLUMN c SET DEFAULT 0" não trazem tipo — só o tipo
  // explícito (não "NULL"/"SET"/"DEFAULT") deve sobrescrever o existente.
  const type = extractColumnType(rest.replace(/^TYPE\s+/i, ""));
  if (type !== "UNKNOWN") existing.type = type;

  if (/^SET\s+NOT\s+NULL/i.test(rest)) existing.isNullable = false;
  else if (/^DROP\s+NOT\s+NULL/i.test(rest)) existing.isNullable = true;
  else if (/\bNOT\s+NULL\b/i.test(rest)) existing.isNullable = false;
  else if (/\bNULL\b/i.test(rest) && !/\bDEFAULT\s+NULL\b/i.test(rest)) existing.isNullable = true;

  if (/\bPRIMARY\s+KEY\b/i.test(rest) && !table.primaryKeys.includes(columnName)) {
    table.primaryKeys.push(columnName);
    existing.isPrimary = true;
  }
}

function applyAlterTable(
  state: SchemaState,
  statement: string,
  schemaName: string,
  module: string
): ParseWarning | null {
  const match = new RegExp(`ALTER\\s+TABLE\\s+(${QUALIFIED_ID})\\s+([\\s\\S]*)$`, "i").exec(statement);
  if (!match) {
    return { statement, reason: "ALTER TABLE não reconhecido" };
  }

  const { name: tableName, schema } = parseQualifiedName(match[1], schemaName);
  const rest = match[2];

  const table = findTable(state, tableName, module) ?? ensureTable(state, tableName, schema, module);
  const actions = splitTopLevelCommas(rest);

  for (const action of actions) {
    const upper = action.toUpperCase();

    if (upper.includes("ADD CONSTRAINT") && upper.includes("FOREIGN KEY")) {
      applyForeignKeyConstraint(table, action.replace(/^ADD\s+/i, ""));
      continue;
    }
    if (upper.startsWith("ADD FOREIGN KEY")) {
      applyForeignKeyConstraint(table, action.replace(/^ADD\s+/i, ""));
      continue;
    }
    if (/^ADD\s+(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY/i.test(action)) {
      applyPrimaryKeyConstraint(table, action);
      continue;
    }
    // ADD CONSTRAINT que não é FK (UNIQUE/CHECK/PRIMARY KEY) e ADD INDEX/KEY/UNIQUE não criam
    // colunas — sem isto o branch de ADD COLUMN abaixo trataria "CONSTRAINT" como nome de coluna.
    if (
      upper.startsWith("ADD CONSTRAINT") ||
      upper.startsWith("ADD PRIMARY") ||
      upper.startsWith("ADD CHECK") ||
      upper.startsWith("ADD UNIQUE") ||
      upper.startsWith("ADD INDEX") ||
      upper.startsWith("ADD KEY")
    ) {
      continue;
    }

    // Oracle: ALTER TABLE t ADD ( col1 tipo, col2 tipo, ... )
    const bulkAdd = /^ADD\s*\(([\s\S]*)\)\s*$/i.exec(action);
    if (bulkAdd) {
      for (const columnDef of splitTopLevelCommas(bulkAdd[1])) {
        const defUpper = columnDef.toUpperCase();
        if (defUpper.includes("FOREIGN KEY")) applyForeignKeyConstraint(table, columnDef);
        else if (/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY/i.test(columnDef)) applyPrimaryKeyConstraint(table, columnDef);
        else if (/^(?:CONSTRAINT|UNIQUE|CHECK|KEY|INDEX)\b/i.test(columnDef.trim())) continue;
        else applyAddedColumn(table, columnDef, tableName);
      }
      continue;
    }

    if (upper.startsWith("ADD COLUMN") || new RegExp(`^ADD\\s+${ID_PART}\\s+[A-Za-z]`, "i").test(action)) {
      applyAddedColumn(table, action.replace(/^ADD\s+(?:COLUMN\s+)?/i, ""), tableName);
      continue;
    }

    // Oracle: ALTER TABLE t DROP ( col1, col2 ) / DROP COLUMN ( ... )
    const bulkDrop = /^DROP\s*(?:COLUMN\s*)?\(([\s\S]*)\)\s*$/i.exec(action);
    if (bulkDrop) {
      for (const raw of splitTopLevelCommas(bulkDrop[1])) {
        const columnName = normalizeName(raw);
        table.columns.delete(columnName);
        table.primaryKeys = table.primaryKeys.filter((pk) => pk !== columnName);
      }
      continue;
    }

    if (upper.startsWith("DROP COLUMN") || new RegExp(`^DROP\\s+${ID_PART}$`, "i").test(action)) {
      const dropMatch = new RegExp(`DROP\\s+(?:COLUMN\\s+)?(${ID_PART})`, "i").exec(action);
      if (dropMatch) {
        const columnName = normalizeName(dropMatch[1]);
        table.columns.delete(columnName);
        table.primaryKeys = table.primaryKeys.filter((pk) => pk !== columnName);
      }
      continue;
    }

    if (upper.startsWith("CHANGE")) {
      const changeMatch = new RegExp(
        `CHANGE\\s+(?:COLUMN\\s+)?(${ID_PART})\\s+(${ID_PART})\\s+([\\s\\S]+)$`,
        "i"
      ).exec(action);
      if (changeMatch) {
        const oldName = normalizeName(changeMatch[1]);
        const newName = normalizeName(changeMatch[2]);
        const rest2 = changeMatch[3];
        const type = extractColumnType(rest2);
        const existing = table.columns.get(oldName);
        if (existing) {
          table.columns.delete(oldName);
          existing.name = newName;
          if (type !== "UNKNOWN") existing.type = type;
          existing.isNullable = !/\bNOT\s+NULL\b/i.test(rest2);
          table.columns.set(newName, existing);

          table.primaryKeys = table.primaryKeys.map((pk) => (pk === oldName ? newName : pk));
          if (/\bPRIMARY\s+KEY\b/i.test(rest2) && !table.primaryKeys.includes(newName)) {
            table.primaryKeys.push(newName);
            existing.isPrimary = true;
          }
        }
      }
      continue;
    }

    if (upper.startsWith("MODIFY") || upper.startsWith("ALTER")) {
      // Oracle: MODIFY ( c1 tipo, c2 tipo )
      const bulkModify = /^MODIFY\s*\(([\s\S]*)\)\s*$/i.exec(action);
      if (bulkModify) {
        for (const columnDef of splitTopLevelCommas(bulkModify[1])) {
          const defMatch = new RegExp(`^(${ID_PART})\\s+([\\s\\S]+)$`, "i").exec(columnDef.trim());
          if (defMatch) applyModifiedColumn(table, normalizeName(defMatch[1]), defMatch[2]);
        }
        continue;
      }
      const modifyMatch = new RegExp(
        `(?:MODIFY|ALTER)\\s+(?:COLUMN\\s+)?(${ID_PART})\\s+([\\s\\S]+)$`,
        "i"
      ).exec(action);
      if (modifyMatch) applyModifiedColumn(table, normalizeName(modifyMatch[1]), modifyMatch[2]);
      continue;
    }

    if (upper.startsWith("DROP FOREIGN KEY") || upper.startsWith("DROP CONSTRAINT")) {
      const dropMatch = new RegExp(`DROP\\s+(?:FOREIGN\\s+KEY|CONSTRAINT)\\s+(${ID_PART})`, "i").exec(action);
      if (dropMatch) {
        const fkName = normalizeName(dropMatch[1]);
        table.foreignKeys.delete(fkName);
        table.columns.forEach((col) => {
          if (col.fkMetadata?.constraintName === fkName) {
            col.isForeign = false;
            col.references = undefined;
            col.fkMetadata = undefined;
          }
        });
      }
      continue;
    }

    if (upper.startsWith("RENAME COLUMN") || upper.startsWith("CHANGE NAME")) {
      const renameMatch = new RegExp(
        `RENAME\\s+(?:COLUMN\\s+)?(${ID_PART})\\s+TO\\s+(${ID_PART})`,
        "i"
      ).exec(action);
      if (renameMatch) {
        const oldName = normalizeName(renameMatch[1]);
        const newName = normalizeName(renameMatch[2]);
        const column = table.columns.get(oldName);
        if (column) {
          column.name = newName;
          table.columns.delete(oldName);
          table.columns.set(newName, column);
          table.primaryKeys = table.primaryKeys.map((pk) => (pk === oldName ? newName : pk));
        }
      }
      continue;
    }

    if (upper.startsWith("RENAME TO")) {
      const renameMatch = new RegExp(`RENAME\\s+TO\\s+(${ID_PART})`, "i").exec(action);
      if (renameMatch) {
        const newName = normalizeName(renameMatch[1]);
        const oldKey = findTableKey(state, tableName, module);
        const oldTable = oldKey ? state.tables.get(oldKey) : undefined;
        if (oldKey && oldTable) {
          state.tables.delete(oldKey);
          oldTable.name = newName;
          // A tabela continua pertencendo ao módulo onde foi criada, não ao do ALTER.
          state.tables.set(tableKey(oldTable.module, newName), oldTable);
        }
      }
      continue;
    }

    // ADD INDEX / ADD UNIQUE / ADD KEY - aceitamos silenciosamente (não afeta diagrama)
    if (upper.startsWith("ADD INDEX") || upper.startsWith("ADD UNIQUE") || upper.startsWith("ADD KEY")) {
      continue;
    }
    if (upper.startsWith("DROP INDEX") || upper.startsWith("DROP KEY")) {
      continue;
    }
    if (upper.startsWith("DROP PRIMARY")) {
      table.primaryKeys = [];
      table.columns.forEach((col) => (col.isPrimary = false));
      continue;
    }

    return { statement: action, reason: "ALTER TABLE action não reconhecida" };
  }

  return null;
}

function applyDropTable(state: SchemaState, statement: string, module: string): ParseWarning | null {
  const match = new RegExp(`DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED_ID})`, "i").exec(statement);
  if (!match) {
    return { statement, reason: "DROP TABLE não reconhecido" };
  }
  const tableName = parseQualifiedName(match[1], "").name;
  const key = findTableKey(state, tableName, module);
  if (key) state.tables.delete(key);
  return null;
}

function applyRenameTable(state: SchemaState, statement: string, module: string): ParseWarning | null {
  const match = new RegExp(
    `RENAME\\s+TABLE\\s+(${QUALIFIED_ID})\\s+TO\\s+(${QUALIFIED_ID})`,
    "i"
  ).exec(statement);
  if (!match) {
    return { statement, reason: "RENAME TABLE não reconhecido" };
  }
  const oldName = parseQualifiedName(match[1], "").name;
  const newName = parseQualifiedName(match[2], "").name;
  const oldKey = findTableKey(state, oldName, module);
  const table = oldKey ? state.tables.get(oldKey) : undefined;
  if (oldKey && table) {
    state.tables.delete(oldKey);
    table.name = newName;
    state.tables.set(tableKey(table.module, newName), table);
  }
  return null;
}

function applyStatement(
  state: SchemaState,
  statement: string,
  schemaName: string,
  module: string
): StatementResult {
  const trimmed = statement.trim();
  if (!trimmed) return { status: "ignored" };
  const upper = trimmed.toUpperCase();

  if (isIgnoredStatement(upper)) return { status: "ignored" };

  const applied = (warning: ParseWarning | null): StatementResult =>
    warning ? { status: "unsupported", warning } : { status: "applied" };

  if (upper.startsWith("CREATE TABLE")) return applied(applyCreateTable(state, trimmed, schemaName, module));
  if (upper.startsWith("ALTER TABLE")) return applied(applyAlterTable(state, trimmed, schemaName, module));
  if (upper.startsWith("DROP TABLE")) return applied(applyDropTable(state, trimmed, module));
  if (upper.startsWith("RENAME TABLE")) return applied(applyRenameTable(state, trimmed, module));

  return { status: "unsupported", warning: { statement: trimmed, reason: "Statement não suportado pelo parser" } };
}

function scopeOf(table: TableState): string {
  return moduleLastSegment(table.module) || deriveScope(table.name, table.schema);
}

/**
 * Ids dos nós. O nome puro é mantido sempre que ele identifica uma tabela só — assim pacotes de
 * um projeto único seguem com os mesmos ids de antes (layouts salvos continuam valendo). Só quando
 * o mesmo nome existe em mais de um módulo é que o id ganha o prefixo do escopo ("projeto-a.users"),
 * que é o que permite carregar dois projetos no mesmo diagrama sem fundir as tabelas homônimas.
 */
function buildNodeIds(state: SchemaState): Map<string, string> {
  const modulesByName = new Map<string, Set<string>>();
  for (const table of state.tables.values()) {
    const modules = modulesByName.get(table.name) ?? new Set<string>();
    modules.add(table.module);
    modulesByName.set(table.name, modules);
  }

  const ids = new Map<string, string>();
  const used = new Map<string, number>();
  for (const [key, table] of state.tables) {
    const ambiguous = (modulesByName.get(table.name)?.size ?? 1) > 1;
    let id = ambiguous ? `${scopeOf(table)}.${table.name}` : table.name;
    // Dois módulos podem terminar com o mesmo segmento (a/db e b/db): aí cai no caminho completo.
    if (ambiguous && used.has(id)) {
      id = `${table.module}.${table.name}`;
    }
    used.set(id, (used.get(id) ?? 0) + 1);
    ids.set(key, id);
  }
  return ids;
}

function buildDiagram(state: SchemaState): DiagramResponse {
  const nodes: DiagramNodeDTO[] = [];
  const edges: DiagramEdgeDTO[] = [];
  const scopeMap = new Map<string, DiagramScopeDTO>();
  const nodeIds = buildNodeIds(state);

  /** Alvo de uma FK: resolve pelo módulo da tabela de origem, como o parser faz nos statements. */
  const targetIdOf = (targetName: string, module: string): string => {
    const key = findTableKey(state, targetName, module);
    return (key && nodeIds.get(key)) ?? targetName;
  };

  for (const [key, table] of state.tables) {
    const nodeId = nodeIds.get(key)!;
    const columns: DiagramColumnDTO[] = Array.from(table.columns.values()).map((col) => ({
      name: col.name,
      type: col.type,
      isNullable: col.isNullable,
      isPrimary: col.isPrimary,
      isForeign: col.isForeign,
      // A referência aponta para o id do nó, não para o nome cru, senão o destaque de relação
      // no diagrama erraria o alvo quando há homônimas em módulos diferentes.
      references: col.references
        ? { table: targetIdOf(col.references.table, table.module), column: col.references.column }
        : undefined,
      fkMetadata: col.fkMetadata,
    }));

    const scope = scopeOf(table);
    nodes.push({
      id: nodeId,
      label: table.name,
      schema: table.schema,
      scope,
      columns,
    });

    if (!scopeMap.has(scope)) {
      scopeMap.set(scope, {
        id: scope,
        label: humanizeScope(scope),
        description: `Entidades relacionadas a ${humanizeScope(scope)}`,
        tables: 0,
      });
    }
    scopeMap.get(scope)!.tables += 1;

    for (const fk of table.foreignKeys.values()) {
      const targetId = targetIdOf(fk.targetTable, table.module);
      edges.push({
        id: `${nodeId}-${targetId}-${fk.constraintName}`,
        source: nodeId,
        target: targetId,
        scope,
        constraint: fk.constraintName,
        columns: fk.columns,
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
      });
    }
  }

  return {
    nodes,
    edges,
    scopes: Array.from(scopeMap.values()),
  };
}

/**
 * Estatística do efeito de uma migration: totais acumulados + delta de tabelas/FKs em relação
 * ao snapshot anterior. Alimenta a timeline sem que ela precise baixar os diagramas de todos os
 * snapshots.
 */
function buildSnapshotStats(
  previous: DiagramResponse | null,
  current: DiagramResponse,
  warnings: number,
  ignoredStatements: number
): MigrationSnapshotStats {
  const diff = computeDiagramDiff(previous, current);
  const addedTables: string[] = [];
  const removedTables: string[] = [];
  const alteredTables: string[] = [];
  diff.forEach((status, id) => {
    if (status === "added") addedTables.push(id);
    else if (status === "removed") removedTables.push(id);
    else alteredTables.push(id);
  });

  const previousEdgeIds = new Set(previous?.edges.map((edge) => edge.id) ?? []);
  const currentEdgeIds = new Set(current.edges.map((edge) => edge.id));
  const addedEdges = current.edges.filter((edge) => !previousEdgeIds.has(edge.id)).length;
  const removedEdges = [...previousEdgeIds].filter((id) => !currentEdgeIds.has(id)).length;

  return {
    tables: current.nodes.length,
    columns: current.nodes.reduce((sum, node) => sum + node.columns.length, 0),
    edges: current.edges.length,
    addedTables: addedTables.sort(),
    removedTables: removedTables.sort(),
    alteredTables: alteredTables.sort(),
    addedEdges,
    removedEdges,
    schemaWarnings: warnings,
    ignoredStatements,
  };
}

export function parseMigrations(
  files: MigrationFileInput[],
  options: { schemaName?: string } = {}
): MigrationParseResult {
  const schemaName = options.schemaName ?? "imported";
  const ordered = orderFiles(files);
  const state: SchemaState = { tables: new Map() };
  const snapshots: MigrationSnapshot[] = [];
  const allWarnings: MigrationParseWarning[] = [];
  let previousDiagram: DiagramResponse | null = null;

  ordered.forEach((file, index) => {
    const order = index + 1;
    const base = baseNameOf(file);
    const modulePath = modulePathOf(file);
    const migrationName = modulePath ? `${modulePath}/${base}` : base;
    const statements = splitStatements(stripComments(file.content));
    const warnings: MigrationParseWarning[] = [];
    let ignoredStatements = 0;

    for (const statement of statements) {
      const result = applyStatement(state, statement, schemaName, modulePath);
      if (result.status === "ignored") {
        ignoredStatements += 1;
      } else if (result.status === "unsupported") {
        warnings.push({
          migrationOrder: order,
          migrationName,
          statement: result.warning.statement,
          reason: result.warning.reason,
        });
      }
    }

    allWarnings.push(...warnings);
    const diagram = buildDiagram(state);
    snapshots.push({
      migrationOrder: order,
      migrationName,
      diagram,
      warnings,
      stats: buildSnapshotStats(previousDiagram, diagram, warnings.length, ignoredStatements),
    });
    previousDiagram = diagram;
  });

  return {
    snapshots,
    finalDiagram: buildDiagram(state),
    warnings: allWarnings,
    fileCount: ordered.length,
  };
}

function stripComments(script: string): string {
  let result = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    const next = script[i + 1];

    if (char === "'" && !inDouble && !inBacktick) {
      if (inSingle && next === "'") {
        result += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      result += char;
      continue;
    }
    if (char === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      result += char;
      continue;
    }
    if (char === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      result += char;
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if ((char === "-" && next === "-") || char === "#") {
        while (i < script.length && script[i] !== "\n") {
          i += 1;
        }
        result += "\n";
        continue;
      }
      if (char === "/" && next === "*") {
        i += 2;
        while (i < script.length && !(script[i] === "*" && script[i + 1] === "/")) {
          i += 1;
        }
        i += 1;
        continue;
      }
    }

    result += char;
  }

  return result;
}

export function buildMigrationFiles(files: MigrationFileInput[]): MigrationFile[] {
  const ordered = orderFiles(files);
  return ordered.map((file, index) => {
    const base = baseNameOf(file);
    // Quando há módulo, exibe "modulo/V1__init.sql" para o usuário identificar a origem.
    return {
      id: `${index + 1}-${base}`,
      name: migrationDisplayName(file),
      order: index + 1,
      content: file.content,
      checksum: checksumOf(file.content),
    };
  });
}

export function detectMigrationProvider(files: MigrationFileInput[]): MigrationSourceProvider {
  return detectProvider(files);
}

/**
 * Nome canônico de uma migration dentro do package ("modulo/V1__init.sql" ou "V1__init.sql").
 * É a chave usada para reconhecer que um arquivo reenviado já foi importado antes — por isso
 * precisa ser estável no roundtrip: o que é gravado em `MigrationFile.name` volta como
 * `MigrationFileInput.name` e produz exatamente o mesmo valor aqui.
 */
export function migrationDisplayName(file: MigrationFileInput): string {
  const base = baseNameOf(file);
  const modulePath = modulePathOf(file);
  return modulePath ? `${modulePath}/${base}` : base;
}

/** Checksum do conteúdo de uma migration, insensível a diferenças de espaçamento. */
export function migrationContentChecksum(content: string): string {
  return checksumOf(content);
}

/**
 * Combina os arquivos já importados com os recém-enviados, deduplicando por nome canônico
 * (`modulo/V1__init.sql`). Isso permite reenviar o zip inteiro do projeto: o que já existe e
 * está idêntico é ignorado, o que é novo entra, e o que existe com conteúdo diferente é
 * sobrescrito e reportado — o workbench é um visualizador, então divergência de checksum não
 * bloqueia o import como faria um executor de migrations (Flyway).
 */
export function mergeMigrationFiles(
  existing: Array<{ name: string; content: string; checksum: string }>,
  incoming: MigrationFileInput[]
): MigrationMergeResult {
  const merged = new Map<string, { input: MigrationFileInput; checksum: string }>();
  for (const file of existing) {
    merged.set(file.name, {
      input: { name: file.name, content: file.content },
      checksum: file.checksum,
    });
  }

  const added: string[] = [];
  const skipped: string[] = [];
  const changed: string[] = [];

  for (const file of incoming) {
    const name = migrationDisplayName(file);
    const checksum = migrationContentChecksum(file.content);
    const current = merged.get(name);

    if (!current) {
      added.push(name);
    } else if (current.checksum === checksum) {
      skipped.push(name);
      continue;
    } else {
      changed.push(name);
    }

    // Grava sempre com `name` já canônico para o roundtrip banco -> input ser estável.
    merged.set(name, { input: { name, content: file.content }, checksum });
  }

  return {
    files: Array.from(merged.values(), (entry) => entry.input),
    added,
    skipped,
    changed,
  };
}

export function packageChecksum(files: MigrationFile[]): string {
  return checksumOf(files.map((f) => f.checksum).join("|"));
}

import { createHash } from "node:crypto";

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
  MigrationSourceProvider,
} from "@/lib/types/migrations";

type ParseWarning = { statement: string; reason: string };

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

function normalizeName(raw: string): string {
  return raw.replace(/^[`"\[]|[`"\]]$/g, "").trim();
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

function flywayOrder(name: string): { major: number; minor: number; patch: number } | null {
  const match = FLYWAY_VERSION_PATTERN.exec(name);
  if (!match) {
    return null;
  }
  const parts = match[1].split(/[._]/).map((part) => Number.parseInt(part, 10));
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
  };
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
    const fa = a.flyway!;
    const fb = b.flyway!;
    if (fa.major !== fb.major) return fa.major - fb.major;
    if (fa.minor !== fb.minor) return fa.minor - fb.minor;
    return fa.patch - fb.patch;
  });

  otherFiles.sort((a, b) => {
    const moduleCmp = a.module.localeCompare(b.module, "en", { numeric: true });
    if (moduleCmp !== 0) return moduleCmp;
    return a.base.localeCompare(b.base, "en", { numeric: true });
  });

  return [...flywayFiles, ...otherFiles].map((entry) => entry.file);
}

function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let parenDepth = 0;

  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    const next = script[i + 1];

    if (char === "'" && !inDouble && !inBacktick) {
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
      if (char === "(") parenDepth += 1;
      if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
      if (char === ";" && parenDepth === 0) {
        const trimmed = current.trim();
        if (trimmed) statements.push(trimmed);
        current = "";
        continue;
      }
    }
    current += char;
  }

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
  const match = /REFERENCES\s+([`"\[]?[\w.]+[`"\]]?)\s*\(\s*([`"\[]?[\w]+[`"\]]?)\s*\)/i.exec(
    columnDef
  );
  if (!match) return null;

  const rawTable = match[1];
  const tableParts = rawTable.split(".");
  const table = normalizeName(tableParts[tableParts.length - 1]);
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

function applyCreateTable(
  state: SchemaState,
  statement: string,
  schemaName: string,
  module: string
): ParseWarning | null {
  const match =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.]+[`"\]]?)\s*\(([\s\S]+)\)\s*[\s\S]*$/i.exec(
      statement
    );
  if (!match) {
    return { statement, reason: "CREATE TABLE não reconhecido" };
  }

  const rawName = match[1];
  const nameParts = rawName.split(".");
  const tableName = normalizeName(nameParts[nameParts.length - 1]);
  const schema = nameParts.length > 1 ? normalizeName(nameParts.slice(0, -1).join(".")) : schemaName;
  const inner = match[2];

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
      const pkMatch = /PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(part);
      if (pkMatch) {
        const cols = pkMatch[1].split(",").map((c) => normalizeName(c.trim()));
        cols.forEach((col) => {
          if (!table.primaryKeys.includes(col)) table.primaryKeys.push(col);
          const existing = table.columns.get(col);
          if (existing) existing.isPrimary = true;
        });
      }
      continue;
    }
    if (upper.startsWith("CONSTRAINT") || upper.startsWith("FOREIGN KEY") || upper.startsWith("UNIQUE") || upper.startsWith("KEY") || upper.startsWith("INDEX") || upper.startsWith("CHECK")) {
      if (upper.includes("FOREIGN KEY")) {
        applyForeignKeyConstraint(table, part);
      }
      continue;
    }

    const columnMatch = /^([`"\[]?[\w]+[`"\]]?)\s+(.+)$/i.exec(part);
    if (columnMatch) {
      const columnName = normalizeName(columnMatch[1]);
      const rest = columnMatch[2];
      const typeMatch = /^([A-Za-z][\w]*(?:\s*\([^)]*\))?)/.exec(rest);
      const type = typeMatch ? typeMatch[1].trim() : rest.split(/\s+/)[0] ?? "UNKNOWN";
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
  const match =
    /(?:CONSTRAINT\s+[`"\[]?[\w]+[`"\]]?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([`"\[]?[\w.]+[`"\]]?)\s*\(([^)]+)\)\s*(.*)$/i.exec(
      part
    );
  if (!match) return;

  const sourceCols = match[1].split(",").map((c) => normalizeName(c.trim()));
  const targetTableRaw = match[2].split(".");
  const targetTable = normalizeName(targetTableRaw[targetTableRaw.length - 1]);
  const targetCols = match[3].split(",").map((c) => normalizeName(c.trim()));
  const tail = match[4] ?? "";

  const onDeleteMatch = /ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION|RESTRICT)/i.exec(tail);
  const onUpdateMatch = /ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION|RESTRICT)/i.exec(tail);

  const constraintMatch = /CONSTRAINT\s+([`"\[]?[\w]+[`"\]]?)\s+/i.exec(part);
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

function applyAlterTable(
  state: SchemaState,
  statement: string,
  schemaName: string,
  module: string
): ParseWarning | null {
  const match = /ALTER\s+TABLE\s+([`"\[]?[\w.]+[`"\]]?)\s+(.*)$/i.exec(statement);
  if (!match) {
    return { statement, reason: "ALTER TABLE não reconhecido" };
  }

  const nameParts = match[1].split(".");
  const tableName = normalizeName(nameParts[nameParts.length - 1]);
  const schema = nameParts.length > 1 ? normalizeName(nameParts.slice(0, -1).join(".")) : schemaName;
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
    if (upper.startsWith("ADD INDEX") || upper.startsWith("ADD UNIQUE") || upper.startsWith("ADD KEY")) {
      continue;
    }

    if (upper.startsWith("ADD COLUMN") || /^ADD\s+[`"\[]?[\w]+[`"\]]?\s+[A-Za-z]/.test(action)) {
      const columnDef = action.replace(/^ADD\s+(?:COLUMN\s+)?/i, "");
      const columnMatch = /^([`"\[]?[\w]+[`"\]]?)\s+(.+)$/i.exec(columnDef);
      if (columnMatch) {
        const columnName = normalizeName(columnMatch[1]);
        const rest2 = columnMatch[2];
        const typeMatch = /^([A-Za-z][\w]*(?:\s*\([^)]*\))?)/.exec(rest2);
        const type = typeMatch ? typeMatch[1].trim() : "UNKNOWN";
        const isNullable = !/\bNOT\s+NULL\b/i.test(rest2);
        const isPrimary = /\bPRIMARY\s+KEY\b/i.test(rest2);
        const reference = extractReferenceClause(rest2);
        const column: ColumnState = {
          name: columnName,
          type,
          isNullable,
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
        }
        table.columns.set(columnName, column);
        if (isPrimary && !table.primaryKeys.includes(columnName)) table.primaryKeys.push(columnName);
      }
      continue;
    }

    if (upper.startsWith("DROP COLUMN") || /^DROP\s+[`"\[]?[\w]+[`"\]]?$/i.test(action)) {
      const dropMatch = /DROP\s+(?:COLUMN\s+)?([`"\[]?[\w]+[`"\]]?)/i.exec(action);
      if (dropMatch) {
        const columnName = normalizeName(dropMatch[1]);
        table.columns.delete(columnName);
        table.primaryKeys = table.primaryKeys.filter((pk) => pk !== columnName);
      }
      continue;
    }

    if (upper.startsWith("CHANGE")) {
      const changeMatch =
        /CHANGE\s+(?:COLUMN\s+)?([`"\[]?[\w]+[`"\]]?)\s+([`"\[]?[\w]+[`"\]]?)\s+(.+)$/i.exec(action);
      if (changeMatch) {
        const oldName = normalizeName(changeMatch[1]);
        const newName = normalizeName(changeMatch[2]);
        const rest2 = changeMatch[3];
        const typeMatch = /^([A-Za-z][\w]*(?:\s*\([^)]*\))?)/.exec(rest2);
        const type = typeMatch ? typeMatch[1].trim() : "UNKNOWN";
        const existing = table.columns.get(oldName);
        if (existing) {
          table.columns.delete(oldName);
          existing.name = newName;
          existing.type = type;
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
      const modifyMatch =
        /(?:MODIFY|ALTER)\s+(?:COLUMN\s+)?([`"\[]?[\w]+[`"\]]?)\s+(.+)$/i.exec(action);
      if (modifyMatch) {
        const columnName = normalizeName(modifyMatch[1]);
        const rest2 = modifyMatch[2];
        const typeMatch = /^([A-Za-z][\w]*(?:\s*\([^)]*\))?)/.exec(rest2);
        const type = typeMatch ? typeMatch[1].trim() : "UNKNOWN";
        const existing = table.columns.get(columnName);
        if (existing) {
          existing.type = type;
          existing.isNullable = !/\bNOT\s+NULL\b/i.test(rest2);
          if (/\bPRIMARY\s+KEY\b/i.test(rest2) && !table.primaryKeys.includes(columnName)) {
            table.primaryKeys.push(columnName);
            existing.isPrimary = true;
          }
        }
      }
      continue;
    }

    if (upper.startsWith("DROP FOREIGN KEY") || upper.startsWith("DROP CONSTRAINT")) {
      const dropMatch = /DROP\s+(?:FOREIGN\s+KEY|CONSTRAINT)\s+([`"\[]?[\w]+[`"\]]?)/i.exec(action);
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
      const renameMatch = /RENAME\s+(?:COLUMN\s+)?([`"\[]?[\w]+[`"\]]?)\s+TO\s+([`"\[]?[\w]+[`"\]]?)/i.exec(
        action
      );
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
      const renameMatch = /RENAME\s+TO\s+([`"\[]?[\w]+[`"\]]?)/i.exec(action);
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
  const match = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`"\[]?[\w.]+[`"\]]?)/i.exec(statement);
  if (!match) {
    return { statement, reason: "DROP TABLE não reconhecido" };
  }
  const nameParts = match[1].split(".");
  const tableName = normalizeName(nameParts[nameParts.length - 1]);
  const key = findTableKey(state, tableName, module);
  if (key) state.tables.delete(key);
  return null;
}

function applyRenameTable(state: SchemaState, statement: string, module: string): ParseWarning | null {
  const match = /RENAME\s+TABLE\s+([`"\[]?[\w]+[`"\]]?)\s+TO\s+([`"\[]?[\w]+[`"\]]?)/i.exec(statement);
  if (!match) {
    return { statement, reason: "RENAME TABLE não reconhecido" };
  }
  const oldName = normalizeName(match[1]);
  const newName = normalizeName(match[2]);
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
): ParseWarning | null {
  const trimmed = statement.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();

  if (upper.startsWith("CREATE TABLE")) return applyCreateTable(state, trimmed, schemaName, module);
  if (upper.startsWith("ALTER TABLE")) return applyAlterTable(state, trimmed, schemaName, module);
  if (upper.startsWith("DROP TABLE")) return applyDropTable(state, trimmed, module);
  if (upper.startsWith("RENAME TABLE")) return applyRenameTable(state, trimmed, module);
  if (upper.startsWith("CREATE INDEX") || upper.startsWith("CREATE UNIQUE INDEX")) return null;
  if (upper.startsWith("DROP INDEX")) return null;
  if (upper.startsWith("SET ") || upper.startsWith("PRAGMA ")) return null;
  if (upper.startsWith("--") || upper.startsWith("/*") || upper.startsWith("BEGIN") || upper.startsWith("COMMIT")) {
    return null;
  }

  return { statement: trimmed, reason: "Statement não suportado pelo parser" };
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

export function parseMigrations(
  files: MigrationFileInput[],
  options: { schemaName?: string } = {}
): MigrationParseResult {
  const schemaName = options.schemaName ?? "imported";
  const ordered = orderFiles(files);
  const state: SchemaState = { tables: new Map() };
  const snapshots: MigrationSnapshot[] = [];
  const allWarnings: MigrationParseWarning[] = [];

  ordered.forEach((file, index) => {
    const order = index + 1;
    const base = baseNameOf(file);
    const modulePath = modulePathOf(file);
    const migrationName = modulePath ? `${modulePath}/${base}` : base;
    const statements = splitStatements(stripComments(file.content));
    const warnings: MigrationParseWarning[] = [];

    for (const statement of statements) {
      const warning = applyStatement(state, statement, schemaName, modulePath);
      if (warning) {
        warnings.push({
          migrationOrder: order,
          migrationName,
          statement: warning.statement,
          reason: warning.reason,
        });
      }
    }

    allWarnings.push(...warnings);
    snapshots.push({
      migrationOrder: order,
      migrationName,
      diagram: buildDiagram(state),
      warnings,
    });
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

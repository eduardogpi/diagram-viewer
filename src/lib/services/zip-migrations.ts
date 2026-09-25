import yauzl from "yauzl";

import type { MigrationFileInput } from "@/lib/types/migrations";

export type ExtractedMigrationFile = MigrationFileInput;

export type ZipExtractionOptions = {
  maxFiles?: number;
  maxFileSize?: number;
  maxTotalSize?: number;
};

const DEFAULT_MAX_FILES = 250;
const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_SIZE = 50 * 1024 * 1024;

/**
 * Lista de extensões aceitas como arquivos de migration.
 */
const ACCEPTED_EXTENSIONS = [".sql"];

function isAcceptedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Normaliza o caminho relativo de uma entrada do zip:
 * - remove barras invertidas (Windows)
 * - remove prefixo "./"
 * - descarta caminhos absolutos ou com ".." (path traversal)
 */
function normalizeEntryPath(rawPath: string): string | null {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith("/")) return null;
  if (normalized.includes("../") || normalized === "..") return null;
  return normalized;
}

/**
 * Lê o conteúdo de uma entrada do zip como string UTF-8.
 * Usa inflateRaw manualmente para evitar depender do método de compressão padrão.
 */
function readEntryContent(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, readStream) => {
      if (err) {
        reject(err);
        return;
      }
      const chunks: Buffer[] = [];
      readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      readStream.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString("utf8"));
      });
      readStream.on("error", reject);
    });
  });
}

/**
 * Extrai um buffer de ZIP e retorna a lista de MigrationFileInput correspondente
 * aos arquivos .sql encontrados (recursivamente, preservando o caminho relativo).
 *
 * O caminho relativo (ex: "resources/db/migration/core/V1__init.sql") é colocado
 * em `path` para que o migration-parser ordene por módulo/pasta.
 */
export async function extractZipToMigrationInputs(
  zipBuffer: Buffer,
  options: ZipExtractionOptions = {}
): Promise<ExtractedMigrationFile[]> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxTotalSize = options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE;

  const zipfile = await yauzl.fromBufferPromise(zipBuffer, { lazyEntries: true, autoClose: true });

  const files: ExtractedMigrationFile[] = [];
  let totalSize = 0;

  await new Promise<void>((resolve, reject) => {
    zipfile.readEntry();

    zipfile.on("entry", async (entry: yauzl.Entry) => {
      const isDirectory = entry.fileName.endsWith("/");
      if (isDirectory) {
        zipfile.readEntry();
        return;
      }

      const normalizedPath = normalizeEntryPath(entry.fileName);
      if (!normalizedPath) {
        zipfile.readEntry();
        return;
      }

      if (!isAcceptedFile(normalizedPath)) {
        zipfile.readEntry();
        return;
      }

      if (entry.uncompressedSize > maxFileSize) {
        reject(new Error(`Arquivo "${normalizedPath}" excede ${maxFileSize} bytes`));
        return;
      }
      totalSize += entry.uncompressedSize;
      if (totalSize > maxTotalSize) {
        reject(new Error(`Tamanho total do zip excede ${maxTotalSize} bytes`));
        return;
      }
      if (files.length >= maxFiles) {
        reject(new Error(`Limite de ${maxFiles} arquivos excedido no zip`));
        return;
      }

      try {
        const content = await readEntryContent(zipfile, entry);
        const baseName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
        files.push({ name: baseName, content, path: normalizedPath });
        zipfile.readEntry();
      } catch (err) {
        reject(err);
      }
    });

    zipfile.on("end", () => resolve());
    zipfile.on("error", (err: Error) => reject(err));
  });

  return files;
}

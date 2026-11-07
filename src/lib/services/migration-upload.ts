import { HttpError } from "@/lib/errors";
import { extractZipToMigrationInputs } from "@/lib/services/zip-migrations";
import type { MigrationFileInput } from "@/lib/types/migrations";

const MAX_FILES = 500;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const MAX_ZIP_SIZE = 50 * 1024 * 1024;

export const migrationUploadLimits = {
  maxFiles: MAX_FILES,
  maxFileSize: MAX_FILE_SIZE,
  maxTotalSize: MAX_TOTAL_SIZE,
  maxZipSize: MAX_ZIP_SIZE,
};

function isSqlFile(name: string): boolean {
  return name.toLowerCase().endsWith(".sql");
}

function isZipFile(name: string): boolean {
  return name.toLowerCase().endsWith(".zip");
}

/**
 * Lê os arquivos enviados no campo "files" de um FormData, aceitando `.sql` soltos e `.zip`
 * (extraído em memória). O campo opcional "paths" carrega o caminho relativo de cada arquivo
 * solto, na mesma ordem, preservando a estrutura de módulos em uploads de pasta
 * (`webkitdirectory`) — arquivos vindos de zip já trazem o caminho interno.
 */
export async function readMigrationFilesFromFormData(formData: FormData): Promise<MigrationFileInput[]> {
  const entries = formData.getAll("files");
  const rawPaths = formData.getAll("paths");
  const paths = rawPaths.map((p) => (typeof p === "string" ? p : ""));

  const inputs: MigrationFileInput[] = [];
  let totalSize = 0;
  let fileIndex = 0;

  const push = (file: MigrationFileInput, size: number) => {
    if (inputs.length >= MAX_FILES) {
      throw new HttpError(400, `Limite de ${MAX_FILES} arquivos excedido`);
    }
    totalSize += size;
    if (totalSize > MAX_TOTAL_SIZE) {
      throw new HttpError(400, `Tamanho total excede ${MAX_TOTAL_SIZE / 1024 / 1024}MB`);
    }
    inputs.push(file);
  };

  for (const entry of entries) {
    if (typeof entry === "string") continue;
    if (!(entry instanceof File)) continue;

    if (isZipFile(entry.name)) {
      if (entry.size > MAX_ZIP_SIZE) {
        throw new HttpError(400, `Zip "${entry.name}" excede ${MAX_ZIP_SIZE / 1024 / 1024}MB`);
      }

      const zipBuffer = Buffer.from(await entry.arrayBuffer());
      let extracted: MigrationFileInput[];
      try {
        extracted = await extractZipToMigrationInputs(zipBuffer, {
          maxFiles: Math.max(0, MAX_FILES - inputs.length),
          maxFileSize: MAX_FILE_SIZE,
          maxTotalSize: Math.max(0, MAX_TOTAL_SIZE - totalSize),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Falha ao extrair zip";
        throw new HttpError(400, message);
      }

      if (extracted.length === 0) {
        throw new HttpError(400, `Nenhum arquivo .sql encontrado no zip "${entry.name}"`);
      }

      for (const file of extracted) {
        push(file, Buffer.byteLength(file.content, "utf8"));
      }
      fileIndex += 1;
      continue;
    }

    if (!isSqlFile(entry.name)) {
      throw new HttpError(400, `Arquivo "${entry.name}" não é .sql nem .zip`);
    }
    if (entry.size > MAX_FILE_SIZE) {
      throw new HttpError(400, `Arquivo "${entry.name}" excede ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    const content = await entry.text();
    const relativePath = paths[fileIndex] || entry.name;
    push({ name: entry.name, content, path: relativePath }, entry.size);
    fileIndex += 1;
  }

  return inputs;
}

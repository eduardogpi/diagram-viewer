"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ImportMode = "sql" | "zip" | "folder";

function isAcceptedFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return lower.endsWith(".sql") || lower.endsWith(".zip");
}

function describeFile(file: File): string {
  // Para seleção via webkitdirectory, o browser expõe o caminho relativo em webkitRelativePath.
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relativePath && relativePath.length > 0 ? relativePath : file.name;
}

export default function MigrationImportForm() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<ImportMode>("sql");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const arr = Array.from(fileList).filter(isAcceptedFile);
    setFiles(arr);
    if (!projectName && arr.length > 0) {
      const first = describeFile(arr[0]);
      const topFolder = first.split("/")[0] ?? first;
      setProjectName(topFolder.replace(/\.sql$|\.zip$/i, "").replace(/[_-]/g, " "));
    }
  }, [projectName]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  function switchMode(next: ImportMode) {
    setMode(next);
    setFiles([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (zipInputRef.current) zipInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (files.length === 0) {
      setError("Selecione ao menos um arquivo .sql ou .zip");
      return;
    }
    if (projectName.trim().length < 3) {
      setError("Nome do projeto deve ter ao menos 3 caracteres");
      return;
    }

    const formData = new FormData();
    formData.append("name", projectName.trim());
    files.forEach((file) => {
      formData.append("files", file);
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (relativePath && relativePath.length > 0) {
        formData.append("paths", relativePath);
      } else {
        formData.append("paths", file.name);
      }
    });

    startTransition(async () => {
      const res = await fetch("/api/migrations/import", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Falha ao importar migrations");
        return;
      }

      const data = (await res.json()) as { connectionId: string };
      router.push(`/workspace/${data.connectionId}?tab=migrations`);
    });
  }

  const fileSummary =
    files.length === 0
      ? mode === "zip"
        ? "Arraste um arquivo .zip aqui"
        : mode === "folder"
          ? "Selecione a pasta raiz das migrations (ex: resources/db/migration)"
          : "Arraste arquivos .sql aqui"
      : files.length <= 3
        ? files.map(describeFile).join(", ")
        : `${files.length} arquivos selecionados (${files
            .slice(0, 3)
            .map(describeFile)
            .join(", ")}, ...)`;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-5 text-sm text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]"
    >
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">Projeto via migrations</p>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Importe arquivos .sql, um .zip com a estrutura de pastas (módulos + versões), ou uma pasta inteira de migrations (Flyway, golang-migrate, SQL puro) e visualize o diagrama do schema sem precisar de uma conexão de banco ativa.
        </p>
      </div>

      <input
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        placeholder="Nome do projeto (ex: Spring Petclinic)"
        required
        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
      />

      <div className="flex flex-wrap gap-2">
        {(["sql", "zip", "folder"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              mode === m
                ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-accent)]"
                : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]"
            }`}
          >
            {m === "sql" ? "Arquivos .sql" : m === "zip" ? "Arquivo .zip" : "Pasta inteira"}
          </button>
        ))}
      </div>

      <div
        className={`rounded-xl border-2 border-dashed p-5 transition ${
          dragActive
            ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)]"
            : "border-[var(--color-border-subtle)]"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        {/* Arquivos .sql soltos */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".sql"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
        {/* Arquivo .zip único */}
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
        {/* Pasta inteira (webkitdirectory) — captura todos os .sql recursivamente */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error webkitdirectory não está tipado no React 19
          webkitdirectory=""
          directory=""
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (mode === "zip") zipInputRef.current?.click();
              else if (mode === "folder") folderInputRef.current?.click();
              else fileInputRef.current?.click();
            }}
            className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
          >
            {mode === "zip"
              ? "Selecionar arquivo .zip"
              : mode === "folder"
                ? "Selecionar pasta de migrations"
                : "Selecionar arquivos .sql"}
          </button>
          <span className="text-xs text-[var(--color-text-secondary)]">{fileSummary}</span>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending || files.length === 0}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Importando..." : "Criar projeto e ver diagrama"}
        </button>
      </div>
    </form>
  );
}

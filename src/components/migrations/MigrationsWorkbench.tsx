"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MigrationDiagram, { type DiffStatus, type MigrationDiagramPayload } from "@/components/migrations/MigrationDiagram";
import MigrationSummaryPanel from "@/components/migrations/MigrationSummaryPanel";
import MigrationTableList from "@/components/migrations/MigrationTableList";
import MigrationTimeline from "@/components/migrations/MigrationTimeline";
import { computeDiagramDiff } from "@/lib/diagram-diff";
import type { DiagramResponse } from "@/lib/types/diagram";
import type {
  MigrationAppendResultDTO,
  MigrationPackageDTO,
  MigrationPackageDetailDTO,
  MigrationSnapshotDTO,
} from "@/lib/types/migrations";

type Props = { connectionId: string };

type PackageDetail = MigrationPackageDetailDTO;

export default function MigrationsWorkbench({ connectionId }: Props) {
  const [packages, setPackages] = useState<MigrationPackageDTO[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [finalDiagram, setFinalDiagram] = useState<MigrationDiagramPayload | null>(null);
  const [loadingDiagram, setLoadingDiagram] = useState(false);

  const [currentOrder, setCurrentOrder] = useState<number | null>(null);
  const [currentSnapshot, setCurrentSnapshot] = useState<MigrationSnapshotDTO | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [diffEnabled, setDiffEnabled] = useState(true);
  /** Tabela selecionada no canvas — destaca na timeline onde ela nasceu/mudou. */
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const [uploadName, setUploadName] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [appendFiles, setAppendFiles] = useState<File[]>([]);
  const [appending, setAppending] = useState(false);
  const [appendError, setAppendError] = useState<string | null>(null);
  const [appendResult, setAppendResult] = useState<MigrationAppendResultDTO | null>(null);
  const appendFileInputRef = useRef<HTMLInputElement>(null);

  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch(`/api/migrations/${connectionId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Falha ao listar packages");
      const data = (await res.json()) as MigrationPackageDTO[];
      setPackages(data);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoadingList(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const loadDetail = useCallback(
    async (packageId: string) => {
      setLoadingDetail(true);
      setDetailError(null);
      setDetail(null);
      setFinalDiagram(null);
      setCurrentSnapshot(null);
      setCurrentOrder(null);
      try {
        const res = await fetch(`/api/migrations/${connectionId}/${packageId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Falha ao carregar package");
        const data = (await res.json()) as PackageDetail;
        setDetail(data);
        if (data.snapshots.length > 0) {
          setCurrentOrder(data.snapshots[data.snapshots.length - 1].migrationOrder);
        }
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        setLoadingDetail(false);
      }
    },
    [connectionId]
  );

  useEffect(() => {
    if (!selectedPackageId) return;
    void loadDetail(selectedPackageId);
  }, [selectedPackageId, loadDetail]);

  useEffect(() => {
    if (!selectedPackageId) return;
    let cancelled = false;
    setLoadingDiagram(true);
    fetch(`/api/migrations/${connectionId}/${selectedPackageId}/diagram`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Falha ao carregar diagrama final"))))
      .then((data: DiagramResponse) => {
        if (!cancelled) setFinalDiagram(data);
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Erro");
      })
      .finally(() => {
        if (!cancelled) setLoadingDiagram(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedPackageId]);

  useEffect(() => {
    if (!selectedPackageId || currentOrder === null) return;
    let cancelled = false;
    setLoadingSnapshot(true);
    fetch(
      `/api/migrations/${connectionId}/${selectedPackageId}/snapshots/${currentOrder}`,
      { cache: "no-store" }
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Falha ao carregar snapshot"))))
      .then((data: MigrationSnapshotDTO) => {
        if (!cancelled) setCurrentSnapshot(data);
      })
      .catch(() => {
        if (!cancelled) setCurrentSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSnapshot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedPackageId, currentOrder]);

  // Diff real: carrega snapshot anterior quando diff está ligado
  const [previousDiagram, setPreviousDiagram] = useState<DiagramResponse | null>(null);
  useEffect(() => {
    if (!selectedPackageId || !diffEnabled || !currentSnapshot || currentSnapshot.migrationOrder <= 1) {
      setPreviousDiagram(null);
      return;
    }
    let cancelled = false;
    const prevOrder = currentSnapshot.migrationOrder - 1;
    fetch(`/api/migrations/${connectionId}/${selectedPackageId}/snapshots/${prevOrder}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("prev"))))
      .then((data: MigrationSnapshotDTO) => {
        if (!cancelled) setPreviousDiagram(data.diagram);
      })
      .catch(() => {
        if (!cancelled) setPreviousDiagram(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedPackageId, diffEnabled, currentSnapshot]);

  const computedDiffMap = useMemo<Map<string, DiffStatus>>(() => {
    if (!diffEnabled || !currentSnapshot || !previousDiagram) return new Map();
    return computeDiagramDiff(previousDiagram, currentSnapshot.diagram) as Map<string, DiffStatus>;
  }, [diffEnabled, currentSnapshot, previousDiagram]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => /\.(sql|zip)$/i.test(f.name));
    setUploadFiles(arr);
    if (!uploadName && arr.length > 0) {
      setUploadName(arr[0].name.replace(/\.(sql|zip)$/i, ""));
    }
  }, [uploadName]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const submitUpload = useCallback(async () => {
    if (uploadFiles.length === 0 || uploadName.trim().length < 3) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("name", uploadName.trim());
      uploadFiles.forEach((file) => formData.append("files", file));
      const res = await fetch(`/api/migrations/${connectionId}/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha no upload");
      }
      setUploadName("");
      setUploadFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshList();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }, [uploadFiles, uploadName, connectionId, refreshList]);

  const submitAppend = useCallback(async () => {
    if (!selectedPackageId || appendFiles.length === 0) return;
    setAppending(true);
    setAppendError(null);
    setAppendResult(null);
    try {
      const formData = new FormData();
      appendFiles.forEach((file) => {
        formData.append("files", file);
        // webkitRelativePath preserva a estrutura de módulos quando o usuário escolhe uma pasta.
        formData.append("paths", file.webkitRelativePath || file.name);
      });
      const res = await fetch(`/api/migrations/${connectionId}/${selectedPackageId}/append`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha ao anexar migrations");
      }
      const result = (await res.json()) as MigrationAppendResultDTO;
      setAppendResult(result);
      setAppendFiles([]);
      if (appendFileInputRef.current) appendFileInputRef.current.value = "";
      await loadDetail(selectedPackageId);
      await refreshList();
    } catch (err) {
      setAppendError(err instanceof Error ? err.message : "Erro ao anexar migrations");
    } finally {
      setAppending(false);
    }
  }, [appendFiles, connectionId, selectedPackageId, loadDetail, refreshList]);

  /** Regenera todos os snapshots do pacote com o parser atual (snapshots são persistidos). */
  const reprocessPackage = useCallback(async () => {
    if (!selectedPackageId) return;
    const keepOrder = currentOrder;
    setReprocessing(true);
    setReprocessError(null);
    try {
      const res = await fetch(`/api/migrations/${connectionId}/${selectedPackageId}/reprocess`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha ao reprocessar o package");
      }
      await loadDetail(selectedPackageId);
      // loadDetail volta para o último snapshot; preserva onde o usuário estava.
      if (keepOrder !== null) setCurrentOrder(keepOrder);
      await refreshList();
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : "Erro ao reprocessar");
    } finally {
      setReprocessing(false);
    }
  }, [connectionId, selectedPackageId, currentOrder, loadDetail, refreshList]);

  const removePackage = useCallback(
    async (packageId: string) => {
      if (!confirm("Remover este package de migrations?")) return;
      const res = await fetch(`/api/migrations/${connectionId}/${packageId}`, { method: "DELETE" });
      if (res.ok) {
        if (selectedPackageId === packageId) setSelectedPackageId(null);
        await refreshList();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(body?.error ?? "Falha ao remover o package");
      }
    },
    [connectionId, selectedPackageId, refreshList]
  );

  // Ao trocar de snapshot/package, a tabela em foco deixa de fazer sentido.
  useEffect(() => {
    setSelectedTableId(null);
  }, [currentOrder, selectedPackageId]);

  const activeDiagram: MigrationDiagramPayload | null = currentSnapshot?.diagram ?? finalDiagram;
  const activeDiffMap = currentSnapshot ? computedDiffMap : undefined;
  const totalWarnings = currentSnapshot?.warnings.length ?? 0;

  const diffSummary = useMemo(() => {
    const added: string[] = [];
    const altered: string[] = [];
    const removed: string[] = [];
    computedDiffMap.forEach((status, id) => {
      if (status === "added") added.push(id);
      else if (status === "altered") altered.push(id);
      else if (status === "removed") removed.push(id);
    });
    return { added: added.sort(), altered: altered.sort(), removed: removed.sort() };
  }, [computedDiffMap]);
  const hasDiffSummary =
    diffSummary.added.length > 0 || diffSummary.altered.length > 0 || diffSummary.removed.length > 0;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-6 shadow-[var(--shadow-floating)]">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-accent)]">Workspace / Migrations</p>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Importar migrations e gerar diagramas</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Envie arquivos .sql de migrations (Flyway, golang-migrate, SQL puro) e o sistema reconstrói o schema
            e gera diagramas por snapshot.
          </p>
        </div>

        <div
          className={`mt-5 rounded-xl border-2 border-dashed p-6 transition ${
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
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">Nome do package</label>
              <input
                type="text"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="Ex: Spring Petclinic migrations"
                className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".sql,.zip"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
              >
                Selecionar arquivos (.sql ou .zip)
              </button>
              <button
                type="button"
                onClick={submitUpload}
                disabled={uploading || uploadFiles.length === 0 || uploadName.trim().length < 3}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? "Importando..." : "Importar"}
              </button>
            </div>
          </div>
          {uploadFiles.length > 0 ? (
            <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
              {uploadFiles.length} arquivo(s) selecionado(s): {uploadFiles.map((f) => f.name).join(", ")}
            </p>
          ) : (
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Arraste arquivos .sql ou um .zip aqui, ou clique em selecionar. Limite: 500 arquivos, 50MB total.
            </p>
          )}
          {uploadError ? <p className="mt-3 text-xs text-red-500">{uploadError}</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-6 shadow-[var(--shadow-floating)]">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Packages importados</h3>
          <button
            type="button"
            onClick={() => void refreshList()}
            className="text-xs text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)]"
          >
            Atualizar
          </button>
        </div>

        {loadingList ? (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">Carregando...</p>
        ) : listError ? (
          <p className="mt-4 text-sm text-red-500">{listError}</p>
        ) : packages.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">Nenhum package importado ainda.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {packages.map((pkg) => (
              <li
                key={pkg.id}
                className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm transition ${
                  selectedPackageId === pkg.id
                    ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)]"
                    : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-strong)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedPackageId(pkg.id)}
                  className="flex-1 text-left"
                >
                  <div className="font-medium text-[var(--color-text-primary)]">{pkg.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {pkg.fileCount} arquivos · {pkg.sourceProvider} · {new Date(pkg.createdAt).toLocaleString("pt-BR")}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void removePackage(pkg.id)}
                  className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition hover:border-rose-400 hover:text-rose-400"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedPackageId ? (
        <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-6 shadow-[var(--shadow-floating)]">
          {loadingDetail ? (
            <p className="text-sm text-[var(--color-text-muted)]">Carregando package...</p>
          ) : detailError ? (
            <p className="text-sm text-red-500">{detailError}</p>
          ) : detail ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{detail.name}</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {detail.fileCount} arquivos · {detail.snapshots.length} snapshots · checksum {detail.checksum.slice(0, 8)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                    <input
                      type="checkbox"
                      checked={diffEnabled}
                      onChange={(e) => setDiffEnabled(e.target.checked)}
                      className="accent-[var(--color-accent)]"
                    />
                    Mostrar diff entre snapshots
                  </label>
                  <button
                    type="button"
                    onClick={() => void reprocessPackage()}
                    disabled={reprocessing}
                    title="Relê os arquivos gravados e regenera todos os snapshots com o parser atual"
                    className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reprocessing ? "Reprocessando..." : "Reprocessar"}
                  </button>
                </div>
              </div>

              {detail.parserStale ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] p-3">
                  <p className="text-xs text-[var(--color-warning)]">
                    Este pacote foi processado com uma versão anterior do parser (v{detail.parserVersion}) — o
                    diagrama e a timeline podem estar incompletos. Reprocesse para atualizar.
                  </p>
                  <button
                    type="button"
                    onClick={() => void reprocessPackage()}
                    disabled={reprocessing}
                    className="rounded-lg bg-[var(--color-warning)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reprocessing ? "Reprocessando..." : "Reprocessar agora"}
                  </button>
                </div>
              ) : null}
              {reprocessError ? <p className="text-xs text-red-500">{reprocessError}</p> : null}

              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[var(--color-border-subtle)] p-3">
                <input
                  ref={appendFileInputRef}
                  type="file"
                  multiple
                  accept=".sql,.zip"
                  onChange={(e) => {
                    if (!e.target.files) return;
                    setAppendResult(null);
                    setAppendFiles(Array.from(e.target.files));
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => appendFileInputRef.current?.click()}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
                >
                  Selecionar migrations (.sql ou .zip)
                </button>
                <button
                  type="button"
                  onClick={() => void submitAppend()}
                  disabled={appending || appendFiles.length === 0}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {appending ? "Adicionando..." : "Adicionar à timeline"}
                </button>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {appendFiles.length > 0
                    ? `${appendFiles.length} arquivo(s) selecionado(s): ${appendFiles.map((f) => f.name).join(", ")}`
                    : "Envie novos passos (V6, V7...) ou o zip completo do projeto — o que já foi importado é ignorado."}
                </span>
                {appendError ? <p className="w-full text-xs text-red-500">{appendError}</p> : null}
                {appendResult ? (
                  <div className="w-full space-y-1 text-xs">
                    <p className="text-[var(--color-text-secondary)]">
                      {appendResult.added.length > 0 || appendResult.changed.length > 0
                        ? `${appendResult.added.length} nova(s), ${appendResult.changed.length} alterada(s), ${appendResult.skipped.length} já importada(s).`
                        : `Nada novo: as ${appendResult.skipped.length} migration(s) enviadas já estavam no package.`}
                    </p>
                    {appendResult.added.length > 0 ? (
                      <p className="text-emerald-500">Adicionadas: {appendResult.added.join(", ")}</p>
                    ) : null}
                    {appendResult.changed.length > 0 ? (
                      <p className="text-amber-500">
                        Sobrescritas (conteúdo mudou desde a importação): {appendResult.changed.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {detail.snapshots.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <Link
                      href={`/workspace/${connectionId}?tab=timeline`}
                      className="text-xs text-[var(--color-accent)] underline-offset-2 hover:underline"
                    >
                      Abrir timeline em tela cheia →
                    </Link>
                  </div>
                  <MigrationTimeline
                    snapshots={detail.snapshots}
                    currentOrder={currentOrder}
                    onSelect={setCurrentOrder}
                    highlightTableId={selectedTableId}
                  />
                  {currentSnapshot ? (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Snapshot #{currentSnapshot.migrationOrder}: <span className="text-[var(--color-text-secondary)]">{currentSnapshot.migrationName}</span>
                      {currentSnapshot.diagram.nodes.length > 0
                        ? ` · ${currentSnapshot.diagram.nodes.length} tabelas · ${currentSnapshot.diagram.edges.length} FKs`
                        : " · sem tabelas"}
                    </p>
                  ) : null}
                  {diffEnabled && currentSnapshot ? (
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
                        O que mudou nesta migration
                      </p>
                      {currentSnapshot.migrationOrder <= 1 ? (
                        <p className="mt-2 text-xs text-[var(--color-text-muted)]">Primeira migration do package.</p>
                      ) : !hasDiffSummary ? (
                        <p className="mt-2 text-xs text-[var(--color-text-muted)]">Nenhuma alteração de tabela detectada.</p>
                      ) : (
                        <div className="mt-2 grid gap-3 sm:grid-cols-3">
                          <DiffColumn label="Adicionadas" color="emerald" tables={diffSummary.added} />
                          <DiffColumn label="Alteradas" color="amber" tables={diffSummary.altered} />
                          <DiffColumn label="Removidas" color="rose" tables={diffSummary.removed} />
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {currentSnapshot && selectedPackageId ? (
                <MigrationSummaryPanel
                  connectionId={connectionId}
                  packageId={selectedPackageId}
                  order={currentSnapshot.migrationOrder}
                  migrationName={currentSnapshot.migrationName}
                />
              ) : null}

              {totalWarnings > 0 && currentSnapshot ? (
                <details className="rounded-lg border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] p-3">
                  <summary className="cursor-pointer text-xs text-[var(--color-warning)]">
                    {totalWarnings} aviso(s) de statements não reconhecidos
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">
                    {currentSnapshot.warnings.map((w, idx) => (
                      <li key={idx}>
                        <span className="text-[var(--color-warning)]">{w.reason}:</span>{" "}
                        <code className="text-[var(--color-text-muted)]">{w.statement.slice(0, 120)}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
                    Diagrama do schema
                  </p>
                  {activeDiagram ? (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {activeDiagram.nodes.length} tabelas · {activeDiagram.edges.length} relações
                    </p>
                  ) : null}
                </div>
                {/* Altura fixa evita colapso de layout (e o salto de scroll da página) enquanto o próximo snapshot carrega. */}
                {activeDiagram ? (
                  <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
                    <MigrationTableList
                      diagram={activeDiagram}
                      diffMap={activeDiffMap}
                      selectedTableId={selectedTableId}
                      onSelect={setSelectedTableId}
                    />
                    <div className="relative">
                      <MigrationDiagram
                        diagram={activeDiagram}
                        diffMap={activeDiffMap}
                        height={640}
                        selectedNodeId={selectedTableId}
                        onSelectedNodeChange={setSelectedTableId}
                      />
                      {loadingSnapshot || loadingDiagram ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-[var(--color-bg-layer-1)]/40 backdrop-blur-[1px]">
                          <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-floating)]">
                            Carregando diagrama...
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <div
                      style={{ height: 640 }}
                      className="flex items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]"
                    >
                      {loadingSnapshot || loadingDiagram ? "Carregando diagrama..." : "Sem diagrama para exibir."}
                    </div>
                  </div>
                )}
              </div>

              {diffEnabled && computedDiffMap.size > 0 ? (
                <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-secondary)]">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> adicionada</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> alterada</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-400" /> removida</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const DIFF_COLUMN_STYLES = {
  emerald: { dot: "bg-emerald-400", text: "text-emerald-200" },
  amber: { dot: "bg-amber-400", text: "text-amber-200" },
  rose: { dot: "bg-rose-400", text: "text-rose-200" },
} as const;

function DiffColumn({
  label,
  color,
  tables,
}: {
  label: string;
  color: keyof typeof DIFF_COLUMN_STYLES;
  tables: string[];
}) {
  const styles = DIFF_COLUMN_STYLES[color];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
        <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
        {label} <span className="text-[var(--color-text-muted)]">({tables.length})</span>
      </div>
      {tables.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">—</p>
      ) : (
        <ul className="space-y-0.5">
          {tables.map((table) => (
            <li key={table} className={`truncate font-mono text-xs ${styles.text}`}>
              {table}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

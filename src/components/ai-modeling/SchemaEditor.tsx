"use client";

import { useMemo, useState } from "react";

import type { SchemaOp } from "@/lib/services/schema-ops";
import type { DiagramColumnDTO, DiagramResponse } from "@/lib/types/diagram";

const COMMON_TYPES = ["BIGINT", "INTEGER", "VARCHAR(255)", "TEXT", "BOOLEAN", "TIMESTAMP", "DECIMAL(10,2)", "DATE"];

type Props = {
  diagram: DiagramResponse;
  disabled?: boolean;
  selectedTableId?: string | null;
  onSelectTable?: (tableId: string | null) => void;
  onApply: (operations: SchemaOp[], message: string) => Promise<void>;
  /** Quando informado (uso em gaveta), mostra o botão de fechar no cabeçalho. */
  onClose?: () => void;
};

export default function SchemaEditor({ diagram, disabled, selectedTableId, onSelectTable, onApply, onClose }: Props) {
  const selected = diagram.nodes.find((n) => n.id === selectedTableId) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newTableName, setNewTableName] = useState("");
  const [newTableScope, setNewTableScope] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState("VARCHAR(255)");
  const [newColNullable, setNewColNullable] = useState(true);
  const [newColComment, setNewColComment] = useState("");
  const [fkColumn, setFkColumn] = useState("");
  const [fkTarget, setFkTarget] = useState("");
  const [fkTargetColumn, setFkTargetColumn] = useState("id");

  const otherTables = useMemo(
    () => diagram.nodes.filter((n) => n.id !== selected?.id),
    [diagram.nodes, selected?.id]
  );

  async function apply(ops: SchemaOp[], message: string) {
    if (disabled || busy || ops.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(ops, message);
      setNewTableName("");
      setNewColName("");
      setNewColComment("");
      setRenameTo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao aplicar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-2xl border border-[var(--color-border-subtle)] p-4 shadow-[var(--shadow-floating)] ${
        onClose ? "bg-[var(--color-bg-layer-1)]" : "bg-[var(--color-bg-layer-1)]/75"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Editar modelo</p>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            title="Fechar editor"
            aria-label="Fechar editor"
            className="rounded-md px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] transition hover:text-[var(--color-text-primary)]"
          >
            ✕
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
        Ajustes manuais entram no mesmo histórico da conversa — dá para desfazer pelo chat.
      </p>

      <div className="mt-3 space-y-2">
        <label className="block text-[11px] text-[var(--color-text-secondary)]">
          Tabela
          <select
            value={selected?.id ?? ""}
            onChange={(e) => onSelectTable?.(e.target.value || null)}
            disabled={disabled}
            className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          >
            <option value="">— escolher —</option>
            {diagram.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
                {node.scope ? ` (${node.scope})` : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <input
            value={newTableName}
            onChange={(e) => setNewTableName(e.target.value)}
            placeholder="Nova tabela"
            disabled={disabled}
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          />
          <input
            value={newTableScope}
            onChange={(e) => setNewTableScope(e.target.value)}
            placeholder="escopo"
            disabled={disabled}
            className="w-24 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={disabled || newTableName.trim().length < 1}
            onClick={() =>
              void apply(
                [
                  {
                    op: "createTable",
                    table: newTableName.trim(),
                    scope: newTableScope.trim() || undefined,
                    columns: [{ name: "id", type: "BIGINT", isPrimary: true, isNullable: false }],
                  },
                ],
                `Criei a tabela ${newTableName.trim()}`
              )
            }
            className="rounded-lg bg-[var(--color-accent)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-text-inverse)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Criar
          </button>
        </div>
      </div>

      {selected ? (
        <div className="mt-4 space-y-3 border-t border-[var(--color-border-subtle)] pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{selected.label}</p>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (!confirm(`Remover a tabela "${selected.label}"?`)) return;
                void apply([{ op: "dropTable", table: selected.id }], `Removi a tabela ${selected.label}`).then(() =>
                  onSelectTable?.(null)
                );
              }}
              className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] text-rose-400 hover:border-rose-400 disabled:opacity-50"
            >
              Remover tabela
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              placeholder="Novo nome"
              disabled={disabled}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
            <button
              type="button"
              disabled={disabled || renameTo.trim().length < 1}
              onClick={() =>
                void apply(
                  [{ op: "renameTable", table: selected.id, newName: renameTo.trim() }],
                  `Renomeei ${selected.label} para ${renameTo.trim()}`
                ).then(() => onSelectTable?.(renameTo.trim()))
              }
              className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-[11px] disabled:opacity-50"
            >
              Renomear
            </button>
          </div>

          <TableCommentEditor
            key={`${selected.id}:${selected.comment ?? ""}`}
            comment={selected.comment ?? ""}
            disabled={disabled || busy}
            onSave={(comment) =>
              void apply(
                [{ op: "setComment", table: selected.id, comment }],
                comment ? `Documentei a tabela ${selected.label}` : `Removi o comentário da tabela ${selected.label}`
              )
            }
          />

          <ul className="space-y-2">
            {selected.columns.map((col) => (
              <ColumnRow
                key={`${selected.id}.${col.name}.${col.type}.${col.isNullable}.${col.isPrimary}.${col.comment ?? ""}`}
                column={col}
                disabled={disabled || busy}
                onChange={(next) => {
                  const ops: SchemaOp[] = [];
                  if (next.name !== col.name) {
                    ops.push({ op: "renameColumn", table: selected.id, column: col.name, newName: next.name });
                  }
                  if (next.type !== col.type || next.isNullable !== col.isNullable || next.isPrimary !== col.isPrimary) {
                    ops.push({
                      op: "alterColumn",
                      table: selected.id,
                      column: next.name !== col.name ? next.name : col.name,
                      type: next.type !== col.type ? next.type : undefined,
                      isNullable: next.isNullable !== col.isNullable ? next.isNullable : undefined,
                      isPrimary: next.isPrimary !== col.isPrimary ? next.isPrimary : undefined,
                    });
                  }
                  if (next.comment !== (col.comment ?? "")) {
                    ops.push({ op: "setComment", table: selected.id, column: next.name, comment: next.comment });
                  }
                  void apply(ops, `Alterei ${selected.label}.${col.name}`);
                }}
                onDropFk={
                  col.isForeign
                    ? () =>
                        void apply(
                          [{ op: "dropForeignKey", table: selected.id, column: col.name }],
                          `Removi a FK de ${selected.label}.${col.name}`
                        )
                    : undefined
                }
                onDrop={() => {
                  if (!confirm(`Remover a coluna "${col.name}"?`)) return;
                  void apply(
                    [{ op: "dropColumn", table: selected.id, column: col.name }],
                    `Removi ${selected.label}.${col.name}`
                  );
                }}
              />
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="nova coluna"
              disabled={disabled}
              className="w-28 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs focus:border-[var(--color-accent)] focus:outline-none"
            />
            <TypeInput value={newColType} onChange={setNewColType} disabled={disabled} />
            <label className="flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={newColNullable} onChange={(e) => setNewColNullable(e.target.checked)} />
              null
            </label>
            <button
              type="button"
              disabled={disabled || newColName.trim().length < 1}
              onClick={() =>
                void apply(
                  [
                    {
                      op: "addColumn",
                      table: selected.id,
                      newColumn: {
                        name: newColName.trim(),
                        type: newColType.trim() || "VARCHAR(255)",
                        isNullable: newColNullable,
                        isPrimary: false,
                        comment: newColComment.trim() || undefined,
                      },
                    },
                  ],
                  `Adicionei ${newColName.trim()} em ${selected.label}`
                )
              }
              className="rounded-lg bg-[var(--color-accent)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-text-inverse)] disabled:opacity-50"
            >
              + Coluna
            </button>
            <input
              value={newColComment}
              onChange={(e) => setNewColComment(e.target.value)}
              maxLength={1000}
              placeholder="comentário da nova coluna (opcional)"
              disabled={disabled}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-[11px] italic focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
            />
          </div>

          {otherTables.length > 0 ? (
            <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Foreign key</p>
              <div className="flex flex-wrap gap-2">
                <select
                  value={fkColumn}
                  onChange={(e) => setFkColumn(e.target.value)}
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs"
                >
                  <option value="">coluna…</option>
                  {selected.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={fkTarget}
                  onChange={(e) => {
                    setFkTarget(e.target.value);
                    const pk = diagram.nodes.find((n) => n.id === e.target.value)?.columns.find((c) => c.isPrimary);
                    setFkTargetColumn(pk?.name ?? "id");
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs"
                >
                  <option value="">tabela alvo…</option>
                  {otherTables.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
                <input
                  value={fkTargetColumn}
                  onChange={(e) => setFkTargetColumn(e.target.value)}
                  placeholder="col alvo"
                  className="w-20 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={disabled || !fkColumn || !fkTarget || !fkTargetColumn}
                  onClick={() =>
                    void apply(
                      [
                        {
                          op: "addForeignKey",
                          table: selected.id,
                          column: fkColumn,
                          referencesTable: fkTarget,
                          referencesColumn: fkTargetColumn,
                        },
                      ],
                      `Liguei ${selected.label}.${fkColumn} → ${fkTarget}.${fkTargetColumn}`
                    )
                  }
                  className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-[11px] disabled:opacity-50"
                >
                  Ligar
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">
          Clique numa tabela no diagrama ou escolha na lista para editar colunas e FKs.
        </p>
      )}

      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
      {busy ? <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">Aplicando…</p> : null}
    </div>
  );
}

function TypeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      list="schema-editor-types"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-32 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
    />
  );
}

function ColumnRow({
  column,
  disabled,
  onChange,
  onDrop,
  onDropFk,
}: {
  column: DiagramColumnDTO;
  disabled?: boolean;
  onChange: (next: { name: string; type: string; isNullable: boolean; isPrimary: boolean; comment: string }) => void;
  onDrop: () => void;
  onDropFk?: () => void;
}) {
  const [name, setName] = useState(column.name);
  const [type, setType] = useState(column.type);
  const [nullable, setNullable] = useState(column.isNullable);
  const [primary, setPrimary] = useState(column.isPrimary);
  const [comment, setComment] = useState(column.comment ?? "");

  const dirty =
    name.trim() !== column.name ||
    type.trim() !== column.type ||
    nullable !== column.isNullable ||
    primary !== column.isPrimary ||
    comment.trim() !== (column.comment ?? "");

  const save = () =>
    onChange({
      name: name.trim(),
      type: type.trim() || column.type,
      isNullable: nullable,
      isPrimary: primary,
      comment: comment.trim(),
    });

  return (
    <li className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)]/60 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <TypeInput value={type} onChange={setType} disabled={disabled} />
        <label className="flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)]">
          <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} disabled={disabled} />
          PK
        </label>
        <label className="flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)]">
          <input type="checkbox" checked={nullable} onChange={(e) => setNullable(e.target.checked)} disabled={disabled} />
          null
        </label>
        {column.isForeign ? (
          <button
            type="button"
            disabled={disabled || !onDropFk}
            onClick={onDropFk}
            title={column.references ? `FK → ${column.references.table}.${column.references.column}` : "Remover FK"}
            className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-accent)] disabled:opacity-40"
          >
            − FK
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled || !dirty || name.trim().length < 1}
          onClick={save}
          className="ml-auto rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] disabled:opacity-40"
        >
          Salvar
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onDrop}
          className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] text-rose-400 disabled:opacity-40"
        >
          ✕
        </button>
      </div>
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty && name.trim()) save();
        }}
        maxLength={1000}
        placeholder="comentário da coluna (opcional)"
        disabled={disabled}
        className="mt-1.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] italic text-[var(--color-text-secondary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
      />
    </li>
  );
}

/** Comentário/documentação da tabela; salvar vazio remove o comentário. */
function TableCommentEditor({
  comment,
  disabled,
  onSave,
}: {
  comment: string;
  disabled?: boolean;
  onSave: (comment: string) => void;
}) {
  const [value, setValue] = useState(comment);
  const dirty = value.trim() !== comment;

  return (
    <div className="space-y-1">
      <label className="block text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        Comentário da tabela
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Para que serve esta tabela?"
          disabled={disabled}
          className="mt-1 w-full resize-y rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-2 py-1.5 text-xs normal-case tracking-normal text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
        />
      </label>
      {dirty ? (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setValue(comment)}
            className="rounded border border-[var(--color-border-subtle)] px-2 py-0.5 text-[10px] disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSave(value.trim())}
            className="rounded bg-[var(--color-accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-inverse)] disabled:opacity-40"
          >
            {value.trim() ? "Salvar comentário" : "Remover comentário"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SchemaEditorTypesDatalist() {
  return (
    <datalist id="schema-editor-types">
      {COMMON_TYPES.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
}

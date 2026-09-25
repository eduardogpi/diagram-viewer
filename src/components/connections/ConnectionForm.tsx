"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PROVIDER_META } from "@/lib/db/provider-meta";
import { CONNECTION_TEMPLATES, type ConnectionTemplate } from "@/lib/db/connection-templates";
import { connectionProviders, type ConnectionProvider } from "@/lib/validators/connection";

const defaultForm = {
  name: "",
  provider: "MYSQL" as ConnectionProvider,
  host: "localhost",
  port: PROVIDER_META.MYSQL.defaultPort,
  database: "",
  schema: "",
  username: PROVIDER_META.MYSQL.defaultUsername,
  password: "",
  tags: "",
};

export default function ConnectionForm() {
  const router = useRouter();
  const [form, setForm] = useState(defaultForm);
  const schemaField = PROVIDER_META[form.provider].schemaField;

  /**
   * Troca de provider reajusta porta e usuário para o padrão do banco escolhido — mas só quando
   * ainda estão no padrão do provider anterior, para não sobrescrever o que o usuário digitou.
   */
  function handleProviderChange(provider: ConnectionProvider) {
    setForm((prev) => {
      const previous = PROVIDER_META[prev.provider];
      const next = PROVIDER_META[provider];
      return {
        ...prev,
        provider,
        port: prev.port === previous.defaultPort ? next.defaultPort : prev.port,
        username: prev.username === previous.defaultUsername ? next.defaultUsername : prev.username,
        schema: next.schemaField && !prev.schema ? next.schemaField.defaultValue : prev.schema,
      };
    });
  }
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Aplica um template preservando o nome já digitado e a senha (nunca vêm do preset). */
  function applyTemplate(template: ConnectionTemplate) {
    setForm((prev) => ({
      ...prev,
      provider: template.values.provider,
      host: template.values.host ?? prev.host,
      port: template.values.port ?? PROVIDER_META[template.values.provider].defaultPort,
      database: template.values.database ?? "",
      schema: template.values.schema ?? "",
      username: template.values.username ?? PROVIDER_META[template.values.provider].defaultUsername,
      tags: template.values.tags ?? prev.tags,
    }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const payload = {
      name: form.name,
      provider: form.provider,
      host: form.host,
      port: Number(form.port),
      database: form.database,
      ...(schemaField && form.schema.trim() ? { schema: form.schema.trim() } : {}),
      username: form.username,
      password: form.password,
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    startTransition(async () => {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Não foi possível criar a conexão");
        return;
      }

      setSuccess("Conexão criada com sucesso");
      setForm(defaultForm);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)]/75 p-4 text-sm text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]"
    >
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          Templates:
        </span>
        {CONNECTION_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => applyTemplate(template)}
            title={template.description}
            className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-xs text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]"
          >
            {template.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={form.name}
          onChange={(e) => handleChange("name", e.target.value)}
          placeholder="Nome da conexão"
          required
          className="flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
        />
        <select
          value={form.provider}
          onChange={(e) => handleProviderChange(e.target.value as ConnectionProvider)}
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
        >
          {connectionProviders.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_META[provider].label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          value={form.host}
          onChange={(e) => handleChange("host", e.target.value)}
          placeholder="Host"
          required
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
        />
        <input
          type="number"
          value={form.port}
          onChange={(e) => handleChange("port", Number(e.target.value))}
          placeholder="Porta"
          required
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          value={form.database}
          onChange={(e) => handleChange("database", e.target.value)}
          placeholder="Database"
          required
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
        />
        <input
          value={form.username}
          onChange={(e) => handleChange("username", e.target.value)}
          placeholder="Usuário"
          required
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>

      {schemaField ? (
        <input
          value={form.schema}
          onChange={(e) => handleChange("schema", e.target.value)}
          placeholder={`${schemaField.label} (padrão: ${schemaField.placeholder})`}
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
        />
      ) : null}

      <input
        type="password"
        value={form.password}
        onChange={(e) => handleChange("password", e.target.value)}
        placeholder="Senha"
        required
        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
      />

      <input
        value={form.tags}
        onChange={(e) => handleChange("tags", e.target.value)}
        placeholder="Tags separadas por vírgula"
        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-2)] px-3 py-2 focus:border-[var(--color-accent)] focus:outline-none"
      />

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-[var(--color-success)]">{success}</p>}

      <div className="flex justify-end gap-3 text-xs text-[var(--color-text-secondary)]">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 font-semibold text-[var(--color-text-inverse)] transition hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,var(--color-text-primary))] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Testando..." : "Salvar conexão"}
        </button>
      </div>
    </form>
  );
}

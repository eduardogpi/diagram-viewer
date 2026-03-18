"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { connectionProviders } from "@/lib/validators/connection";

const defaultForm = {
  name: "",
  provider: "MYSQL" as (typeof connectionProviders)[number],
  host: "localhost",
  port: 3306,
  database: "",
  username: "root",
  password: "",
  tags: "",
};

export default function ConnectionForm() {
  const router = useRouter();
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
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
      className="flex w-full flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-200"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={form.name}
          onChange={(e) => handleChange("name", e.target.value)}
          placeholder="Nome da conexão"
          required
          className="flex-1 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 focus:border-cyan-400 focus:outline-none"
        />
        <select
          value={form.provider}
          onChange={(e) => handleChange("provider", e.target.value as (typeof connectionProviders)[number])}
          className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 focus:border-cyan-400 focus:outline-none"
        >
          {connectionProviders.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
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
          className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 focus:border-cyan-400 focus:outline-none"
        />
        <input
          type="number"
          value={form.port}
          onChange={(e) => handleChange("port", Number(e.target.value))}
          placeholder="Porta"
          required
          className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 focus:border-cyan-400 focus:outline-none"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          value={form.database}
          onChange={(e) => handleChange("database", e.target.value)}
          placeholder="Database"
          required
          className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 focus:border-cyan-400 focus:outline-none"
        />
        <input
          value={form.username}
          onChange={(e) => handleChange("username", e.target.value)}
          placeholder="Usuário"
          required
          className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 focus:border-cyan-400 focus:outline-none"
        />
      </div>

      <input
        type="password"
        value={form.password}
        onChange={(e) => handleChange("password", e.target.value)}
        placeholder="Senha"
        required
        className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 focus:border-cyan-400 focus:outline-none"
      />

      <input
        value={form.tags}
        onChange={(e) => handleChange("tags", e.target.value)}
        placeholder="Tags separadas por vírgula"
        className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 focus:border-cyan-400 focus:outline-none"
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">{success}</p>}

      <div className="flex justify-end gap-3 text-xs text-slate-400">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Testando..." : "Salvar conexão"}
        </button>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Tab = {
  id: string;
  label: string;
  description: string;
};

type Props = {
  connectionId: string;
  activeTab: string;
  favoriteTab?: string | null;
  tabs: Tab[];
};

export default function WorkspaceTabs({ connectionId, activeTab, favoriteTab, tabs }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function saveFavorite() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/workspace-preferences/${connectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favoriteTab: activeTab }),
      });

      if (!res.ok) {
        setError("Não foi possível salvar a aba favorita.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={`/workspace/${connectionId}?tab=${tab.id}`}
            className={`rounded-xl border px-4 py-2 text-sm transition ${
              activeTab === tab.id
                ? "border-cyan-400 bg-cyan-400/10 text-cyan-200"
                : "border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
            }`}
          >
            {tab.label}
            {favoriteTab === tab.id ? " ★" : ""}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveFavorite}
          disabled={isPending}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Marcar aba atual como favorita"}
        </button>
        {favoriteTab && <p className="text-xs text-slate-500">Favorita atual: {tabs.find((tab) => tab.id === favoriteTab)?.label ?? favoriteTab}</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
    </div>
  );
}

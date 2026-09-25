"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();
  const isDark = theme === "dark";

  // Placeholder estável até montar no cliente para evitar mismatch de hidratação.
  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        aria-hidden
        className="flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] text-[var(--color-text-primary)] shadow-sm"
        title="Alternar tema"
      >
        <Moon className="h-4 w-4" />
        <span>Tema escuro</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition ${
        isDark
          ? "border-white/15 bg-white/10 text-slate-100 hover:bg-white/20"
          : "border-[var(--color-border-subtle)] bg-[var(--color-bg-layer-1)] text-[var(--color-text-primary)] shadow-sm"
      }`}
      title={isDark ? "Alternar para tema claro" : "Alternar para tema escuro"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span>{isDark ? "Tema claro" : "Tema escuro"}</span>
    </button>
  );
}

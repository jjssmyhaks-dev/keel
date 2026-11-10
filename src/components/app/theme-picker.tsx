"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { THEMES, THEME_COOKIE, type ThemeId } from "@/lib/theme";

export function ThemePicker({ initial }: { initial: ThemeId }) {
  const [current, setCurrent] = useState<ThemeId>(initial);

  function choose(id: ThemeId) {
    setCurrent(id);
    document.documentElement.setAttribute("data-theme", id);
    document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {THEMES.map((theme) => {
          const active = theme.id === current;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => choose(theme.id)}
              aria-pressed={active}
              className={`flex items-center gap-3 border px-3 py-2.5 text-left transition-colors ${
                active
                  ? "border-black bg-white dark:border-foreground dark:bg-card"
                  : "border-black/10 hover:border-black/30 dark:border-border"
              }`}
            >
              <span className="flex size-7 shrink-0 overflow-hidden rounded-full border border-black/10 dark:border-border">
                {theme.swatches.map((color) => (
                  <span key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium">{theme.name}</span>
                <span className="block truncate font-mono text-[9px] text-black/40 dark:text-muted-foreground">
                  {theme.description}
                </span>
              </span>
              {active ? <Check className="size-3.5 shrink-0" strokeWidth={1.8} /> : null}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-black/40 dark:text-muted-foreground">
        Applies to this browser only. Each theme has a matching dark palette.
      </p>
    </div>
  );
}

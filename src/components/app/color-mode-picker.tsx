"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

const MODES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

export function ColorModePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {MODES.map((mode) => {
          const active = mounted && theme === mode.id;
          const Icon = mode.icon;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => setTheme(mode.id)}
              aria-pressed={active}
              className={`flex items-center justify-center gap-2 border px-3 py-2 text-[12px] transition-colors ${
                active
                  ? "border-black bg-white dark:border-foreground dark:bg-card"
                  : "border-black/10 hover:border-black/30 dark:border-border"
              }`}
            >
              <Icon className="size-3.5" strokeWidth={1.7} />
              {mode.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
        System follows the appearance setting on your device.
      </p>
    </div>
  );
}

export type ThemeId = "default" | "forest" | "bee" | "mint" | "parchment";

export type Theme = {
  id: ThemeId;
  name: string;
  description: string;
  swatches: [string, string, string];
};

export const THEME_COOKIE = "keel_theme";

export const THEMES: Theme[] = [
  {
    id: "default",
    name: "Paper",
    description: "Warm paper, ink and the original pink.",
    swatches: ["#f7f6f3", "#ffffff", "#eca8d6"],
  },
  {
    id: "forest",
    name: "Forest",
    description: "Evergreen ink on a quiet sage page.",
    swatches: ["#edf3ea", "#1f4d2e", "#bcd9b2"],
  },
  {
    id: "bee",
    name: "Bee",
    description: "Honeyed surfaces with dark amber ink.",
    swatches: ["#fbf3dd", "#7a4a00", "#f4d06f"],
  },
  {
    id: "mint",
    name: "Mint",
    description: "Cool mint with a deep teal anchor.",
    swatches: ["#eaf6f2", "#0f4f46", "#a9e2d4"],
  },
  {
    id: "parchment",
    name: "Parchment",
    description: "Aged paper and sepia ink.",
    swatches: ["#f3ecdd", "#4a3a28", "#dfc49a"],
  },
];

export function themeFor(id: string | undefined | null): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

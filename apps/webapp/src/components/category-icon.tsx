import React from "react";
import * as LucideIcons from "lucide-react";
import { Tag, type LucideProps } from "lucide-react";
import type { ExpenseCategory } from "@quozen/core";
import { humanizeCategoryId } from "@quozen/core";

function resolveLucideIcon(name?: string): React.ComponentType<LucideProps> | null {
  if (!name || typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  // 1. Direct match (e.g. "Coffee", "Plane", "Utensils", "Tag")
  if (trimmed in LucideIcons) {
    const candidate = (LucideIcons as any)[trimmed];
    if (typeof candidate === "function" || (typeof candidate === "object" && candidate !== null)) {
      return candidate;
    }
  }

  // 2. PascalCase conversion (e.g. "shopping-bag" -> "ShoppingBag", "gamepad-2" -> "Gamepad2", "coffee" -> "Coffee")
  const pascal = trimmed
    .split(/[-_\s]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");

  if (pascal in LucideIcons) {
    const candidate = (LucideIcons as any)[pascal];
    if (typeof candidate === "function" || (typeof candidate === "object" && candidate !== null)) {
      return candidate;
    }
  }

  // 3. Case-insensitive lookup (ignoring dashes and underscores)
  const clean = trimmed.toLowerCase().replace(/[-_\s]/g, "");
  const foundKey = Object.keys(LucideIcons).find(k => k.toLowerCase() === clean);
  if (foundKey) {
    const candidate = (LucideIcons as any)[foundKey];
    if (typeof candidate === "function" || (typeof candidate === "object" && candidate !== null)) {
      return candidate;
    }
  }

  return null;
}

export function getCategoryIconComponent(iconName?: string, categoryId?: string): React.ComponentType<LucideProps> {
  const fromIconName = resolveLucideIcon(iconName);
  if (fromIconName) return fromIconName;

  const fromCategoryId = resolveLucideIcon(categoryId);
  if (fromCategoryId) return fromCategoryId;

  return Tag;
}

export interface CategoryIconProps extends LucideProps {
  categoryId?: string;
  iconName?: string;
  categories?: ExpenseCategory[];
}

export function CategoryIcon({ categoryId, iconName, categories, ...props }: CategoryIconProps) {
  let resolvedIcon = iconName;
  if (!resolvedIcon && categoryId && categories && categories.length > 0) {
    const cat = categories.find(c => c.id === categoryId);
    if (cat?.icon) {
      resolvedIcon = cat.icon;
    }
  }

  const IconComponent = getCategoryIconComponent(resolvedIcon, categoryId);
  return <IconComponent {...props} />;
}

export interface CategoryTheme {
  badge: string;
  activePill: string;
  iconContainer: string;
  ambientGlow: string;
  topBorder: string;
}

const NEUTRAL_CATEGORY_THEME: CategoryTheme = {
  badge: "bg-muted text-muted-foreground",
  activePill:
    "bg-secondary text-secondary-foreground border-primary ring-1 ring-primary/30",
  iconContainer:
    "bg-primary/15 text-primary border-primary/30 dark:bg-primary/20 dark:text-primary",
  ambientGlow:
    "from-primary/20 via-primary/5 to-transparent dark:from-primary/20 dark:via-primary/5 dark:to-transparent",
  topBorder: "border-t-primary/50",
};

const CATEGORY_THEME_PALETTES: CategoryTheme[] = [
  // 0: Amber / Warm Orange (Food & Dining)
  {
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    activePill:
      "bg-amber-100/95 text-amber-950 border-amber-500 ring-1 ring-amber-500/35 dark:bg-amber-950/75 dark:text-amber-100 dark:border-amber-400 dark:ring-amber-400/35",
    iconContainer:
      "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:bg-amber-400/20 dark:text-amber-300 dark:border-amber-400/30",
    ambientGlow:
      "from-amber-400/30 via-orange-400/10 to-transparent dark:from-amber-500/25 dark:via-orange-500/10 dark:to-transparent",
    topBorder: "border-t-amber-400/70 dark:border-t-amber-400/60",
  },
  // 1: Blue / Sky (Transportation)
  {
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    activePill:
      "bg-blue-100/95 text-blue-950 border-blue-500 ring-1 ring-blue-500/35 dark:bg-blue-950/75 dark:text-blue-100 dark:border-blue-400 dark:ring-blue-400/35",
    iconContainer:
      "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:bg-blue-400/20 dark:text-blue-300 dark:border-blue-400/30",
    ambientGlow:
      "from-sky-400/30 via-blue-500/10 to-transparent dark:from-sky-500/25 dark:via-blue-500/10 dark:to-transparent",
    topBorder: "border-t-sky-400/70 dark:border-t-sky-400/60",
  },
  // 2: Indigo (Accommodation)
  {
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
    activePill:
      "bg-indigo-100/95 text-indigo-950 border-indigo-500 ring-1 ring-indigo-500/35 dark:bg-indigo-950/75 dark:text-indigo-100 dark:border-indigo-400 dark:ring-indigo-400/35",
    iconContainer:
      "bg-indigo-500/15 text-indigo-700 border-indigo-500/30 dark:bg-indigo-400/20 dark:text-indigo-300 dark:border-indigo-400/30",
    ambientGlow:
      "from-indigo-400/30 via-violet-400/10 to-transparent dark:from-indigo-500/25 dark:via-violet-500/10 dark:to-transparent",
    topBorder: "border-t-indigo-400/70 dark:border-t-indigo-400/60",
  },
  // 3: Purple (Entertainment)
  {
    badge: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    activePill:
      "bg-purple-100/95 text-purple-950 border-purple-500 ring-1 ring-purple-500/35 dark:bg-purple-950/75 dark:text-purple-100 dark:border-purple-400 dark:ring-purple-400/35",
    iconContainer:
      "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:bg-purple-400/20 dark:text-purple-300 dark:border-purple-400/30",
    ambientGlow:
      "from-purple-400/30 via-fuchsia-400/10 to-transparent dark:from-purple-500/25 dark:via-fuchsia-500/10 dark:to-transparent",
    topBorder: "border-t-purple-400/70 dark:border-t-purple-400/60",
  },
  // 4: Rose / Pink (Shopping)
  {
    badge: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
    activePill:
      "bg-rose-100/95 text-rose-950 border-rose-500 ring-1 ring-rose-500/35 dark:bg-rose-950/75 dark:text-rose-100 dark:border-rose-400 dark:ring-rose-400/35",
    iconContainer:
      "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:bg-rose-400/20 dark:text-rose-300 dark:border-rose-400/30",
    ambientGlow:
      "from-rose-400/30 via-pink-400/10 to-transparent dark:from-rose-500/25 dark:via-pink-500/10 dark:to-transparent",
    topBorder: "border-t-rose-400/70 dark:border-t-rose-400/60",
  },
  // 5: Teal (Other)
  {
    badge: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
    activePill:
      "bg-teal-100/95 text-teal-950 border-teal-500 ring-1 ring-teal-500/35 dark:bg-teal-950/75 dark:text-teal-100 dark:border-teal-400 dark:ring-teal-400/35",
    iconContainer:
      "bg-teal-500/15 text-teal-700 border-teal-500/30 dark:bg-teal-400/20 dark:text-teal-300 dark:border-teal-400/30",
    ambientGlow:
      "from-teal-400/28 via-emerald-400/10 to-transparent dark:from-teal-500/22 dark:via-emerald-500/10 dark:to-transparent",
    topBorder: "border-t-teal-400/70 dark:border-t-teal-400/60",
  },
  // 6: Emerald
  {
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    activePill:
      "bg-emerald-100/95 text-emerald-950 border-emerald-500 ring-1 ring-emerald-500/35 dark:bg-emerald-950/75 dark:text-emerald-100 dark:border-emerald-400 dark:ring-emerald-400/35",
    iconContainer:
      "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:bg-emerald-400/20 dark:text-emerald-300 dark:border-emerald-400/30",
    ambientGlow:
      "from-emerald-400/30 via-teal-400/10 to-transparent dark:from-emerald-500/25 dark:via-teal-500/10 dark:to-transparent",
    topBorder: "border-t-emerald-400/70 dark:border-t-emerald-400/60",
  },
  // 7: Pink
  {
    badge: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
    activePill:
      "bg-pink-100/95 text-pink-950 border-pink-500 ring-1 ring-pink-500/35 dark:bg-pink-950/75 dark:text-pink-100 dark:border-pink-400 dark:ring-pink-400/35",
    iconContainer:
      "bg-pink-500/15 text-pink-700 border-pink-500/30 dark:bg-pink-400/20 dark:text-pink-300 dark:border-pink-400/30",
    ambientGlow:
      "from-pink-400/30 via-rose-400/10 to-transparent dark:from-pink-500/25 dark:via-rose-500/10 dark:to-transparent",
    topBorder: "border-t-pink-400/70 dark:border-t-pink-400/60",
  },
  // 8: Cyan
  {
    badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
    activePill:
      "bg-cyan-100/95 text-cyan-950 border-cyan-500 ring-1 ring-cyan-500/35 dark:bg-cyan-950/75 dark:text-cyan-100 dark:border-cyan-400 dark:ring-cyan-400/35",
    iconContainer:
      "bg-cyan-500/15 text-cyan-700 border-cyan-500/30 dark:bg-cyan-400/20 dark:text-cyan-300 dark:border-cyan-400/30",
    ambientGlow:
      "from-cyan-400/30 via-sky-400/10 to-transparent dark:from-cyan-500/25 dark:via-sky-500/10 dark:to-transparent",
    topBorder: "border-t-cyan-400/70 dark:border-t-cyan-400/60",
  },
  // 9: Violet
  {
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
    activePill:
      "bg-violet-100/95 text-violet-950 border-violet-500 ring-1 ring-violet-500/35 dark:bg-violet-950/75 dark:text-violet-100 dark:border-violet-400 dark:ring-violet-400/35",
    iconContainer:
      "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:bg-violet-400/20 dark:text-violet-300 dark:border-violet-400/30",
    ambientGlow:
      "from-violet-400/30 via-purple-400/10 to-transparent dark:from-violet-500/25 dark:via-purple-500/10 dark:to-transparent",
    topBorder: "border-t-violet-400/70 dark:border-t-violet-400/60",
  },
  // 10: Orange
  {
    badge: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    activePill:
      "bg-orange-100/95 text-orange-950 border-orange-500 ring-1 ring-orange-500/35 dark:bg-orange-950/75 dark:text-orange-100 dark:border-orange-400 dark:ring-orange-400/35",
    iconContainer:
      "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:bg-orange-400/20 dark:text-orange-300 dark:border-orange-400/30",
    ambientGlow:
      "from-orange-400/30 via-amber-400/10 to-transparent dark:from-orange-500/25 dark:via-amber-500/10 dark:to-transparent",
    topBorder: "border-t-orange-400/70 dark:border-t-orange-400/60",
  },
  // 11: Lime
  {
    badge: "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300",
    activePill:
      "bg-lime-100/95 text-lime-950 border-lime-500 ring-1 ring-lime-500/35 dark:bg-lime-950/75 dark:text-lime-100 dark:border-lime-400 dark:ring-lime-400/35",
    iconContainer:
      "bg-lime-500/15 text-lime-700 border-lime-500/30 dark:bg-lime-400/20 dark:text-lime-300 dark:border-lime-400/30",
    ambientGlow:
      "from-lime-400/30 via-emerald-400/10 to-transparent dark:from-lime-500/25 dark:via-emerald-500/10 dark:to-transparent",
    topBorder: "border-t-lime-400/70 dark:border-t-lime-400/60",
  },
];

const SEMANTIC_DEFAULT_THEME_INDEX: Record<string, number> = {
  food_dining: 0,
  transportation: 1,
  accommodation: 2,
  entertainment: 3,
  shopping: 4,
  other: 5,
};

export function getCategoryTheme(categoryId?: string): CategoryTheme {
  if (!categoryId || !categoryId.trim()) {
    return NEUTRAL_CATEGORY_THEME;
  }
  const str = categoryId.trim().toLowerCase();
  if (str in SEMANTIC_DEFAULT_THEME_INDEX) {
    return CATEGORY_THEME_PALETTES[SEMANTIC_DEFAULT_THEME_INDEX[str]];
  }
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % CATEGORY_THEME_PALETTES.length;
  return CATEGORY_THEME_PALETTES[index];
}

export function getCategoryBadgeColor(categoryId?: string): string {
  return getCategoryTheme(categoryId).badge;
}

export function getCategoryDisplayName(categoryId?: string, categories?: ExpenseCategory[]): string {
  if (!categoryId || !categoryId.trim()) return "";
  const found = categories?.find(c => c.id === categoryId);
  if (found) return found.name;
  return humanizeCategoryId(categoryId);
}

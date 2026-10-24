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

const BADGE_PALETTES = [
  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300",
];

export function getCategoryBadgeColor(categoryId?: string): string {
  if (!categoryId || !categoryId.trim()) {
    return "bg-muted text-muted-foreground";
  }
  let hash = 0;
  const str = categoryId.trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % BADGE_PALETTES.length;
  return BADGE_PALETTES[index];
}

export function getCategoryDisplayName(categoryId?: string, categories?: ExpenseCategory[]): string {
  if (!categoryId || !categoryId.trim()) return "";
  const found = categories?.find(c => c.id === categoryId);
  if (found) return found.name;
  return humanizeCategoryId(categoryId);
}

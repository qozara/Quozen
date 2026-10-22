import React from "react";
import {
  Utensils,
  Car,
  Bed,
  Gamepad2,
  ShoppingBag,
  MoreHorizontal,
  Tag,
  type LucideProps
} from "lucide-react";
import type { ExpenseCategory } from "@quozen/core";
import { DEFAULT_CATEGORIES, humanizeCategoryId } from "@quozen/core";

const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  utensils: Utensils,
  car: Car,
  bed: Bed,
  "gamepad-2": Gamepad2,
  gamepad2: Gamepad2,
  "shopping-bag": ShoppingBag,
  shoppingbag: ShoppingBag,
  "more-horizontal": MoreHorizontal,
  morehorizontal: MoreHorizontal,
  tag: Tag
};

export function getCategoryIconComponent(iconName?: string, categoryId?: string): React.ComponentType<LucideProps> {
  if (iconName && ICON_MAP[iconName.toLowerCase()]) {
    return ICON_MAP[iconName.toLowerCase()];
  }

  const id = categoryId?.toLowerCase() || "";
  if (id.includes("food") || id.includes("dining")) return Utensils;
  if (id.includes("transport") || id.includes("car")) return Car;
  if (id.includes("accommodat") || id.includes("hotel") || id.includes("bed")) return Bed;
  if (id.includes("entertain") || id.includes("game")) return Gamepad2;
  if (id.includes("shop")) return ShoppingBag;
  if (id.includes("other") || id.includes("misc")) return MoreHorizontal;

  return Tag;
}

export interface CategoryIconProps extends LucideProps {
  categoryId?: string;
  iconName?: string;
  categories?: ExpenseCategory[];
}

export function CategoryIcon({ categoryId, iconName, categories, ...props }: CategoryIconProps) {
  let resolvedIcon = iconName;
  if (!resolvedIcon && categoryId) {
    const list = categories && categories.length > 0 ? categories : DEFAULT_CATEGORIES;
    const cat = list.find(c => c.id === categoryId);
    if (cat?.icon) {
      resolvedIcon = cat.icon;
    }
  }

  const IconComponent = getCategoryIconComponent(resolvedIcon, categoryId);
  return <IconComponent {...props} />;
}

export function getCategoryBadgeColor(categoryId?: string): string {
  const id = categoryId?.toLowerCase() || "";
  if (id.includes("food") || id.includes("dining")) {
    return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  }
  if (id.includes("transport")) {
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  }
  if (id.includes("accommodat") || id.includes("hotel")) {
    return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
  }
  if (id.includes("shop")) {
    return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  }
  if (id.includes("entertain")) {
    return "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300";
  }
  return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
}

export function getCategoryDisplayName(categoryId?: string, categories?: ExpenseCategory[]): string {
  if (!categoryId) return "Other";
  const list = categories && categories.length > 0 ? categories : DEFAULT_CATEGORIES;
  const found = list.find(c => c.id === categoryId);
  if (found) return found.name;
  return humanizeCategoryId(categoryId);
}

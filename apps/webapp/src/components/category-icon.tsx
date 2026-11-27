import React, { useEffect, useState } from "react";
import * as LucideIcons from "lucide-react";
import { Tag, type LucideProps } from "lucide-react";
import {
  DEFAULT_CATEGORIES,
  getLocalizedCategoryDescription,
  getLocalizedCategoryName,
  humanizeCategoryId,
  resolveCategory,
  type ExpenseCategory,
} from "@quozen/core";
import { useTranslation } from "react-i18next";
import globalI18n from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export function useCurrentLocale(): string {
  const translation = useTranslation();
  return translation?.i18n?.language || globalI18n?.language || "en";
}

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

export function getCategoryIconComponent(
  iconName?: string,
  categoryId?: string,
  fallbackName?: string
): React.ComponentType<LucideProps> {
  const fromIconName = resolveLucideIcon(iconName);
  if (fromIconName) return fromIconName;

  const fromCategoryId = resolveLucideIcon(categoryId);
  if (fromCategoryId) return fromCategoryId;

  const fromFallbackName = resolveLucideIcon(fallbackName);
  if (fromFallbackName) return fromFallbackName;

  return Tag;
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

function resolveCanonicalCategoryId(
  categoryId?: string,
  categories?: ExpenseCategory[]
): string {
  if (!categoryId || !categoryId.trim()) return "";
  const trimmed = categoryId.trim();
  const lower = trimmed.toLowerCase();
  if (lower in SEMANTIC_DEFAULT_THEME_INDEX) return lower;

  const effectiveCategories =
    categories && categories.length > 0 ? categories : DEFAULT_CATEGORIES;
  const matched =
    resolveCategory(trimmed, effectiveCategories) ??
    resolveCategory(trimmed, DEFAULT_CATEGORIES);
  return matched ? matched.id.trim().toLowerCase() : lower;
}

export function getCategoryTheme(
  categoryId?: string,
  categories?: ExpenseCategory[]
): CategoryTheme {
  const canonical = resolveCanonicalCategoryId(categoryId, categories);
  if (!canonical) {
    return NEUTRAL_CATEGORY_THEME;
  }
  if (canonical in SEMANTIC_DEFAULT_THEME_INDEX) {
    return CATEGORY_THEME_PALETTES[SEMANTIC_DEFAULT_THEME_INDEX[canonical]];
  }
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    hash = (hash << 5) - hash + canonical.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % CATEGORY_THEME_PALETTES.length;
  return CATEGORY_THEME_PALETTES[index];
}

export function getCategoryBadgeColor(
  categoryId?: string,
  categories?: ExpenseCategory[]
): string {
  return getCategoryTheme(categoryId, categories).badge;
}

export interface ResolvedCategoryMeta {
  canonicalId: string;
  displayName: string;
  description: string;
  iconName?: string;
  IconComponent: React.ComponentType<LucideProps>;
  theme: CategoryTheme;
  category?: ExpenseCategory;
}

/**
 * Single source of truth resolving an expense category's ID, localized display name,
 * localized description, Lucide icon component, and coordinated color theme across
 * default, edited, custom imported, and legacy free-text categories.
 */
export function resolveCategoryMeta(
  categoryId?: string,
  categories?: ExpenseCategory[],
  explicitIconName?: string,
  locale?: string
): ResolvedCategoryMeta {
  const raw = categoryId?.trim() || "";
  const activeLocale = locale || globalI18n?.language || "en";

  if (!raw && !explicitIconName) {
    return {
      canonicalId: "",
      displayName: "",
      description: "",
      IconComponent: Tag,
      theme: NEUTRAL_CATEGORY_THEME,
    };
  }

  const effectiveCategories =
    categories && categories.length > 0 ? categories : DEFAULT_CATEGORIES;

  // Prefer exact/case-insensitive match in passed categories first so custom or edited
  // categories from imported spreadsheets always take precedence.
  const matchedInProvided =
    categories && categories.length > 0
      ? resolveCategory(raw, categories)
      : undefined;
  const matchedInDefaults =
    !matchedInProvided && raw ? resolveCategory(raw, DEFAULT_CATEGORIES) : undefined;
  const matched = matchedInProvided ?? matchedInDefaults;

  const canonicalId = matched?.id || raw;
  const defaultFallback = canonicalId
    ? DEFAULT_CATEGORIES.find(d => d.id.toLowerCase() === canonicalId.toLowerCase())
    : undefined;

  const resolvedIconName =
    (explicitIconName && explicitIconName.trim()) ||
    (matched?.icon && matched.icon.trim()) ||
    defaultFallback?.icon ||
    undefined;

  const IconComponent = getCategoryIconComponent(
    resolvedIconName,
    canonicalId,
    matched?.name
  );

  const displayName = matched
    ? getLocalizedCategoryName(matched, activeLocale)
    : canonicalId
      ? humanizeCategoryId(canonicalId)
      : "";
  const description = matched
    ? getLocalizedCategoryDescription(matched, activeLocale)
    : "";
  const theme = getCategoryTheme(canonicalId, effectiveCategories);

  return {
    canonicalId,
    displayName,
    description,
    iconName: resolvedIconName,
    IconComponent,
    theme,
    category: matched,
  };
}

export function getCategoryDisplayName(
  categoryId?: string,
  categories?: ExpenseCategory[],
  locale?: string
): string {
  if (!categoryId || !categoryId.trim()) return "";
  return resolveCategoryMeta(categoryId, categories, undefined, locale).displayName;
}

export interface CategoryIconProps extends LucideProps {
  categoryId?: string;
  iconName?: string;
  categories?: ExpenseCategory[];
}

export function CategoryIcon({
  categoryId,
  iconName,
  categories,
  ...props
}: CategoryIconProps) {
  const { IconComponent } = resolveCategoryMeta(categoryId, categories, iconName);
  return <IconComponent {...props} />;
}

const ICON_BADGE_SIZE_CLASSES = {
  sm: { container: "w-10 h-10", icon: "w-5 h-5" },
  md: { container: "w-11 h-11", icon: "w-5 h-5" },
  lg: { container: "w-12 h-12", icon: "w-6 h-6" },
} as const;

export interface CategoryIconBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  categoryId?: string;
  iconName?: string;
  categories?: ExpenseCategory[];
  size?: keyof typeof ICON_BADGE_SIZE_CLASSES;
  shape?: "circle" | "rounded";
  iconClassName?: string;
}

/**
 * Reusable themed category icon container used across Dashboard, Activity (ExpensesList),
 * and Add/Edit Expense Drawer headers so every screen renders identical icon + color styling.
 */
export function CategoryIconBadge({
  categoryId,
  iconName,
  categories,
  size = "md",
  shape = "rounded",
  className,
  iconClassName,
  ...props
}: CategoryIconBadgeProps) {
  const locale = useCurrentLocale();
  const { IconComponent, theme } = resolveCategoryMeta(
    categoryId,
    categories,
    iconName,
    locale
  );
  const sizeSpec = ICON_BADGE_SIZE_CLASSES[size];
  const radiusClass =
    shape === "circle"
      ? "rounded-full"
      : size === "md"
        ? "rounded-2xl"
        : "rounded-xl";

  return (
    <div
      className={cn(
        "border flex items-center justify-center shrink-0 transition-colors duration-300 motion-reduce:transition-none",
        sizeSpec.container,
        radiusClass,
        theme.iconContainer,
        className
      )}
      {...props}
    >
      <IconComponent aria-hidden="true" className={cn(sizeSpec.icon, iconClassName)} />
    </div>
  );
}

export interface CategoryBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  categoryId?: string;
  iconName?: string;
  categories?: ExpenseCategory[];
  showIcon?: boolean;
}

/**
 * Reusable themed category label pill used in Activity / Expense cards and summaries.
 */
export function CategoryBadge({
  categoryId,
  iconName,
  categories,
  showIcon = false,
  className,
  ...props
}: CategoryBadgeProps) {
  const locale = useCurrentLocale();
  const { IconComponent, displayName, theme } = resolveCategoryMeta(
    categoryId,
    categories,
    iconName,
    locale
  );
  if (!displayName) return null;

  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-normal text-[10px] px-1.5 py-0 border-0 inline-flex items-center gap-1",
        theme.badge,
        className
      )}
      {...props}
    >
      {showIcon && <IconComponent aria-hidden="true" className="w-3 h-3 shrink-0" />}
      <span>{displayName}</span>
    </Badge>
  );
}

/**
 * Hook managing synchronized active category state for Add & Edit Expense drawers.
 */
export function useActiveCategoryState(
  targetCategory?: string,
  categories?: ExpenseCategory[],
  isOpen: boolean = true
) {
  const locale = useCurrentLocale();
  const availableCategories =
    categories && categories.length > 0 ? categories : DEFAULT_CATEGORIES;
  const defaultCategoryId = targetCategory
    ? resolveCategoryMeta(targetCategory, availableCategories, undefined, locale).canonicalId
    : "";

  const [activeCategoryId, setActiveCategoryId] = useState(defaultCategoryId);

  useEffect(() => {
    if (isOpen) {
      setActiveCategoryId(defaultCategoryId);
    } else {
      setActiveCategoryId("");
    }
  }, [isOpen, defaultCategoryId]);

  const meta = resolveCategoryMeta(activeCategoryId, availableCategories, undefined, locale);
  return {
    activeCategoryId: meta.canonicalId || activeCategoryId,
    setActiveCategoryId,
    availableCategories,
    categoryMeta: meta,
    categoryTheme: meta.theme,
  };
}

export interface CategoryDrawerHeaderProps {
  categoryId?: string;
  categories?: ExpenseCategory[];
  title: React.ReactNode;
  titleTestId?: string;
  description?: React.ReactNode;
  descriptionClassName?: string;
}

/**
 * Shared ambient blurred category aura + hero icon DrawerHeader for Add & Edit Expense drawers.
 */
export function CategoryDrawerHeader({
  categoryId,
  categories,
  title,
  titleTestId,
  description,
  descriptionClassName,
}: CategoryDrawerHeaderProps) {
  const locale = useCurrentLocale();
  const meta = resolveCategoryMeta(categoryId, categories, undefined, locale);

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="drawer-category-aura"
        data-category-id={meta.canonicalId}
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b blur-2xl opacity-90 transition-all duration-300 motion-reduce:transition-none",
          meta.theme.ambientGlow
        )}
      />
      <DrawerHeader className="relative z-10 flex items-center gap-3 text-left">
        <CategoryIconBadge
          categoryId={meta.canonicalId}
          categories={categories}
          size="md"
          shape="rounded"
          data-testid="drawer-category-hero-icon"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <DrawerTitle data-testid={titleTestId}>{title}</DrawerTitle>
          {description !== undefined && (
            <DrawerDescription className={descriptionClassName}>
              {description}
            </DrawerDescription>
          )}
        </div>
      </DrawerHeader>
    </>
  );
}

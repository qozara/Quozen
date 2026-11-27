import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Pizza, Waves, Coffee, Utensils } from "lucide-react";
import {
  CategoryIconBadge,
  CategoryBadge,
  resolveCategoryMeta,
  getCategoryTheme,
} from "../category-icon";
import Dashboard from "@/pages/dashboard";
import ExpensesList from "@/pages/expenses";
import AddExpenseDrawer from "../add-expense-drawer";
import type { ExpenseCategory, Member, Expense } from "@quozen/core";
import i18n from "@/lib/i18n";
import { DEFAULT_CATEGORIES, Ledger } from "@quozen/core";
import { useAppContext } from "@/context/app-context";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/hooks/use-settings";

vi.mock("@/context/app-context", () => ({
  useAppContext: vi.fn(),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: vi.fn(),
}));

vi.mock("@/hooks/use-auto-sync", () => ({
  useAutoSync: vi.fn(() => ({
    isOnline: true,
    setPaused: vi.fn(),
  })),
}));

vi.mock("@/hooks/use-groups", () => ({
  useGroups: vi.fn(() => ({
    groups: [{ id: "group-1", name: "Surf Group" }],
    isLoading: false,
  })),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/storage", () => ({
  quozen: {
    ledger: vi.fn(() => ({
      getLedger: vi.fn(),
      addExpense: vi.fn(),
      deleteExpense: vi.fn(),
    })),
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
    })),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
    })),
  };
});

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: any) => (open ? <div data-testid="mock-drawer">{children}</div> : null),
  DrawerContent: ({ children, className }: any) => <div className={className}>{children}</div>,
  DrawerHeader: ({ children, className }: any) => <div className={className}>{children}</div>,
  DrawerFooter: ({ children, className }: any) => <div className={className}>{children}</div>,
  DrawerTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
  DrawerDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
}));

const importedCategories: ExpenseCategory[] = [
  { id: "surf_lessons", name: "Surf & Beach", icon: "waves", description: "Lessons" },
  { id: "food_dining", name: "Gastronomía", icon: "pizza", description: "Edited default" },
  { id: "coffee", name: "Morning Coffee", icon: "", description: "Blank icon custom" },
];

const mockMembers: Member[] = [
  { userId: "u1", name: "Alice", email: "alice@example.com", role: "owner", joinedAt: new Date() },
  { userId: "u2", name: "Bob", email: "bob@example.com", role: "member", joinedAt: new Date() },
];

describe("Unified Category UI Across Dashboard, Activity, and Drawers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAppContext as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      activeGroupId: "group-1",
      currentUserId: "u1",
      isAddExpenseOpen: true,
      setIsAddExpenseOpen: vi.fn(),
      expenseDraft: null,
      setExpenseDraft: vi.fn(),
      expenseDraftMeta: null,
    });
    (useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      settings: { preferences: { defaultCurrency: "USD" } },
    });
  });

  it("resolves identical icon component, display name, and theme for custom, edited, blank-icon, and legacy categories", () => {
    // Custom category
    const surfMeta = resolveCategoryMeta("surf_lessons", importedCategories);
    expect(surfMeta.IconComponent).toBe(Waves);
    expect(surfMeta.displayName).toBe("Surf & Beach");
    expect(surfMeta.theme).toEqual(getCategoryTheme("surf_lessons"));

    // Edited default category keeps semantic food_dining color theme + custom edited icon & name
    const editedFoodMeta = resolveCategoryMeta("food_dining", importedCategories);
    expect(editedFoodMeta.IconComponent).toBe(Pizza);
    expect(editedFoodMeta.displayName).toBe("Gastronomía");
    expect(editedFoodMeta.theme).toEqual(getCategoryTheme("food_dining"));

    // Custom category with blank icon resolves icon from categoryId ("coffee" -> Coffee)
    const blankIconCustomMeta = resolveCategoryMeta("coffee", importedCategories);
    expect(blankIconCustomMeta.IconComponent).toBe(Coffee);
    expect(blankIconCustomMeta.displayName).toBe("Morning Coffee");

    // Legacy free-text "Food" resolves to canonical food_dining theme and Utensils when using defaults
    const legacyFoodMeta = resolveCategoryMeta("Food");
    expect(legacyFoodMeta.canonicalId).toBe("food_dining");
    expect(legacyFoodMeta.IconComponent).toBe(Utensils);
    expect(legacyFoodMeta.theme).toEqual(getCategoryTheme("food_dining"));
  });

  it("applies the exact same colored CategoryIconBadge theme across Dashboard, Activity ExpensesList, and AddExpenseDrawer", () => {
    const sampleExpenses: Expense[] = [
      {
        id: "exp-surf",
        description: "Reef break lesson",
        amount: 80,
        paidByUserId: "u1",
        category: "surf_lessons",
        date: new Date(),
        splits: [{ userId: "u1", amount: 40 }, { userId: "u2", amount: 40 }],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "exp-food",
        description: "Wood-fired slices",
        amount: 30,
        paidByUserId: "u2",
        category: "food_dining",
        date: new Date(),
        splits: [{ userId: "u1", amount: 15 }, { userId: "u2", amount: 15 }],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const ledger = new Ledger({
      members: mockMembers,
      expenses: sampleExpenses,
      settlements: [],
      categories: importedCategories,
    });

    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ledger,
      isLoading: false,
    });

    const expectedSurfIconContainer = getCategoryTheme("surf_lessons").iconContainer.split(" ")[0];
    const expectedFoodIconContainer = getCategoryTheme("food_dining").iconContainer.split(" ")[0];

    // 1. Dashboard recent activity
    const { unmount: unmountDashboard } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );
    const dashSurfBadge = screen.getByTestId("dashboard-category-icon-exp-surf");
    const dashFoodBadge = screen.getByTestId("dashboard-category-icon-exp-food");
    expect(dashSurfBadge.className).toContain(expectedSurfIconContainer);
    expect(dashFoodBadge.className).toContain(expectedFoodIconContainer);
    expect(dashSurfBadge.querySelector("svg.lucide-waves")).toBeInTheDocument();
    expect(dashFoodBadge.querySelector("svg.lucide-pizza")).toBeInTheDocument();
    unmountDashboard();

    // 2. Activity Hub ExpensesList
    const { unmount: unmountExpenses } = render(
      <MemoryRouter>
        <ExpensesList expenses={sampleExpenses} members={mockMembers} categories={importedCategories} />
      </MemoryRouter>
    );
    const listSurfIcon = screen.getByTestId("expense-list-category-icon-exp-surf");
    const listFoodIcon = screen.getByTestId("expense-list-category-icon-exp-food");
    expect(listSurfIcon.className).toContain(expectedSurfIconContainer);
    expect(listFoodIcon.className).toContain(expectedFoodIconContainer);
    expect(listSurfIcon.querySelector("svg.lucide-waves")).toBeInTheDocument();
    expect(listFoodIcon.querySelector("svg.lucide-pizza")).toBeInTheDocument();
    expect(screen.getByText("Surf & Beach")).toBeInTheDocument();
    expect(screen.getByText("Gastronomía")).toBeInTheDocument();
    unmountExpenses();

    // 3. AddExpenseDrawer header hero icon starts neutral/unselected on open and updates to surf_lessons on selection
    render(
      <MemoryRouter>
        <AddExpenseDrawer />
      </MemoryRouter>
    );
    const drawerHeroIcon = screen.getByTestId("drawer-category-hero-icon");
    expect(drawerHeroIcon.querySelector("svg.lucide-tag")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("category-pill-surf_lessons"));
    expect(drawerHeroIcon.className).toContain(expectedSurfIconContainer);
    expect(drawerHeroIcon.querySelector("svg.lucide-waves")).toBeInTheDocument();
  });

  it("renders standalone CategoryIconBadge and CategoryBadge with consistent colors", () => {
    render(
      <div>
        <CategoryIconBadge categoryId="Food" data-testid="standalone-icon-badge" />
        <CategoryBadge categoryId="Food" showIcon data-testid="standalone-pill-badge" />
      </div>
    );

    const iconBadge = screen.getByTestId("standalone-icon-badge");
    const pillBadge = screen.getByTestId("standalone-pill-badge");
    const foodTheme = getCategoryTheme("food_dining");

    expect(iconBadge.className).toContain(foodTheme.iconContainer.split(" ")[0]);
    expect(pillBadge.className).toContain(foodTheme.badge.split(" ")[0]);
    expect(pillBadge).toHaveTextContent("Food & Dining");
  });

  it("localizes default and custom translated categories in Spanish while falling back to canonical name when untranslated", async () => {
    const localizedCategories: ExpenseCategory[] = [
      ...DEFAULT_CATEGORIES,
      {
        id: "pet_care",
        name: "Pet Care",
        translations: { es: "Mascotas" },
        icon: "dog",
        description: "Vet visits",
        descriptionTranslations: { es: "Visitas al veterinario" },
      },
      {
        id: "surf_club",
        name: "Surf & Beach",
        icon: "waves",
        description: "Untranslated custom category",
      },
    ];

    await i18n.changeLanguage("es");
    try {
      expect(resolveCategoryMeta("food_dining", localizedCategories, undefined, "es").displayName).toBe("Comida y bebida");
      expect(resolveCategoryMeta("pet_care", localizedCategories, undefined, "es").displayName).toBe("Mascotas");
      expect(resolveCategoryMeta("surf_club", localizedCategories, undefined, "es").displayName).toBe("Surf & Beach");

      render(
        <MemoryRouter>
          <div>
            <CategoryBadge categoryId="food_dining" categories={localizedCategories} data-testid="es-default-badge" />
            <CategoryBadge categoryId="pet_care" categories={localizedCategories} data-testid="es-custom-badge" />
            <CategoryBadge categoryId="surf_club" categories={localizedCategories} data-testid="es-fallback-badge" />
          </div>
        </MemoryRouter>
      );

      expect(screen.getByTestId("es-default-badge")).toHaveTextContent("Comida y bebida");
      expect(screen.getByTestId("es-custom-badge")).toHaveTextContent("Mascotas");
      expect(screen.getByTestId("es-fallback-badge")).toHaveTextContent("Surf & Beach");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

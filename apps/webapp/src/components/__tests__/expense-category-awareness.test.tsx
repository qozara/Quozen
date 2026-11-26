import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ExpenseForm from "../expense-form";
import AddExpenseDrawer from "../add-expense-drawer";
import EditExpense from "@/pages/edit-expense";
import { getCategoryTheme, getCategoryBadgeColor } from "../category-icon";
import { DEFAULT_CATEGORIES, Ledger, Member } from "@quozen/core";
import { useAppContext } from "@/context/app-context";
import { useQuery } from "@tanstack/react-query";

vi.mock("@/context/app-context", () => ({
  useAppContext: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-auto-sync", () => ({
  useAutoSync: () => ({
    setPaused: vi.fn(),
    isOnline: true,
  }),
}));

vi.mock("@/hooks/use-groups", () => ({
  useGroups: () => ({
    groups: [{ id: "group-1", name: "Trip Group" }],
  }),
}));

vi.mock("@/lib/storage", () => ({
  quozen: {
    ledger: vi.fn(() => ({
      getLedger: vi.fn(),
      addExpense: vi.fn(),
      updateExpense: vi.fn(),
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
  DrawerContent: ({ children, className }: any) => <div data-testid="mock-drawer-content" className={className}>{children}</div>,
  DrawerHeader: ({ children, className }: any) => <div className={className}>{children}</div>,
  DrawerTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
  DrawerDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
}));

const mockUsers: Member[] = [
  {
    userId: "u1",
    name: "Alice",
    email: "alice@example.com",
    role: "owner",
    joinedAt: new Date(),
  },
  {
    userId: "u2",
    name: "Bob",
    email: "bob@example.com",
    role: "member",
    joinedAt: new Date(),
  },
];

describe("Expense Category Awareness UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCategoryTheme", () => {
    it("provides semantic themes for default categories and deterministic themes for custom categories", () => {
      const foodTheme = getCategoryTheme("food_dining");
      const transportTheme = getCategoryTheme("transportation");
      expect(foodTheme.badge).not.toBe(transportTheme.badge);
      expect(foodTheme.ambientGlow).toBeTruthy();
      expect(foodTheme.activePill).toBeTruthy();
      expect(foodTheme.iconContainer).toBeTruthy();
      expect(foodTheme.topBorder).toBeTruthy();

      // Custom category remains deterministic and matches getCategoryBadgeColor
      const custom1 = getCategoryTheme("coffee_runs");
      const custom2 = getCategoryTheme("coffee_runs");
      expect(custom1).toEqual(custom2);
      expect(getCategoryBadgeColor("coffee_runs")).toBe(custom1.badge);
    });
  });

  describe("ExpenseForm — Top 1-Tap Category Pill Strip & Smart Auto-Category", () => {
    it("renders the category pill strip as the first field above description and amount", () => {
      render(
        <ExpenseForm
          users={mockUsers}
          categories={DEFAULT_CATEGORIES}
          currentUserId="u1"
          onSubmit={vi.fn()}
          isPending={false}
          isDrawer
        />
      );

      const categoryGroup = screen.getByTestId("select-category");
      const descriptionInput = screen.getByTestId("input-expense-description");
      const amountInput = screen.getByTestId("input-expense-amount");

      expect(categoryGroup).toHaveAttribute("role", "radiogroup");
      expect(
        categoryGroup.compareDocumentPosition(descriptionInput) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        descriptionInput.compareDocumentPosition(amountInput) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("switches category in 1 tap, supports keyboard arrow navigation, and shows category in sticky footer", () => {
      const onCategoryChange = vi.fn();
      render(
        <ExpenseForm
          users={mockUsers}
          categories={DEFAULT_CATEGORIES}
          currentUserId="u1"
          onSubmit={vi.fn()}
          onCategoryChange={onCategoryChange}
          isPending={false}
          isDrawer
        />
      );

      const foodPill = screen.getByTestId("category-pill-food_dining");
      const transportPill = screen.getByTestId("category-pill-transportation");

      expect(foodPill).toHaveAttribute("aria-checked", "true");
      expect(screen.getByTestId("submit-category-badge")).toHaveTextContent("Food & Dining");

      // 1-tap switch
      fireEvent.click(transportPill);
      expect(transportPill).toHaveAttribute("aria-checked", "true");
      expect(foodPill).toHaveAttribute("aria-checked", "false");
      expect(onCategoryChange).toHaveBeenCalledWith("transportation");
      expect(screen.getByTestId("submit-category-badge")).toHaveTextContent("Transportation");

      // Keyboard ArrowRight moves to accommodation
      fireEvent.keyDown(transportPill, { key: "ArrowRight" });
      const accommodationPill = screen.getByTestId("category-pill-accommodation");
      expect(accommodationPill).toHaveAttribute("aria-checked", "true");
      expect(onCategoryChange).toHaveBeenLastCalledWith("accommodation");
    });

    it("auto-selects category when typing keywords in description on a new expense until manually selected", () => {
      const onCategoryChange = vi.fn();
      render(
        <ExpenseForm
          users={mockUsers}
          categories={DEFAULT_CATEGORIES}
          currentUserId="u1"
          onSubmit={vi.fn()}
          onCategoryChange={onCategoryChange}
          isPending={false}
          isDrawer
        />
      );

      const descInput = screen.getByTestId("input-expense-description");

      // Typing "Uber to airport" auto-switches to transportation
      fireEvent.change(descInput, { target: { value: "Uber to airport" } });
      expect(screen.getByTestId("category-pill-transportation")).toHaveAttribute("aria-checked", "true");
      expect(onCategoryChange).toHaveBeenLastCalledWith("transportation");

      // Changing to "Hotel check-in" while still untouched manually switches to accommodation
      fireEvent.change(descInput, { target: { value: "Hotel check-in" } });
      expect(screen.getByTestId("category-pill-accommodation")).toHaveAttribute("aria-checked", "true");

      // User manually picks Shopping -> locks out further auto-switching
      fireEvent.click(screen.getByTestId("category-pill-shopping"));
      expect(screen.getByTestId("category-pill-shopping")).toHaveAttribute("aria-checked", "true");

      fireEvent.change(descInput, { target: { value: "Uber ride home" } });
      expect(screen.getByTestId("category-pill-shopping")).toHaveAttribute("aria-checked", "true");
    });

    it("does NOT auto-override category when editing an existing expense", () => {
      render(
        <ExpenseForm
          initialData={{
            id: "exp-1",
            description: "Misc gift",
            amount: 35,
            category: "shopping",
            paidByUserId: "u1",
            date: new Date(),
            splits: [{ userId: "u1", amount: 35 }],
          }}
          users={mockUsers}
          categories={DEFAULT_CATEGORIES}
          currentUserId="u1"
          onSubmit={vi.fn()}
          isPending={false}
          isDrawer
        />
      );

      expect(screen.getByTestId("category-pill-shopping")).toHaveAttribute("aria-checked", "true");

      fireEvent.change(screen.getByTestId("input-expense-description"), {
        target: { value: "Uber voucher gift" },
      });

      expect(screen.getByTestId("category-pill-shopping")).toHaveAttribute("aria-checked", "true");
    });
  });

  describe("Ambient Blurred Drawer Header Aura (Add & Edit)", () => {
    it("renders live category aura and hero icon in AddExpenseDrawer and updates on category change", () => {
      const mockLedger = new Ledger({
        members: mockUsers,
        expenses: [],
        settlements: [],
      });

      (useAppContext as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        activeGroupId: "group-1",
        currentUserId: "u1",
        isAddExpenseOpen: true,
        setIsAddExpenseOpen: vi.fn(),
        expenseDraft: null,
        setExpenseDraft: vi.fn(),
        expenseDraftMeta: null,
      });

      (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: mockLedger,
        isLoading: false,
      });

      render(<AddExpenseDrawer />);

      const aura = screen.getByTestId("drawer-category-aura");
      expect(aura).toHaveAttribute("data-category-id", "food_dining");
      expect(screen.getByTestId("drawer-category-hero-icon")).toBeInTheDocument();

      // Switch pill -> aura updates immediately
      fireEvent.click(screen.getByTestId("category-pill-entertainment"));
      expect(screen.getByTestId("drawer-category-aura")).toHaveAttribute("data-category-id", "entertainment");
    });

    it("renders matching category aura and hero icon in EditExpense drawer", () => {
      (useAppContext as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        activeGroupId: "group-1",
        currentUserId: "u1",
      });

      (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: {
          members: mockUsers,
          categories: DEFAULT_CATEGORIES,
          expenses: [
            {
              id: "exp-42",
              description: "Airbnb Rome",
              amount: 240,
              paidByUserId: "u1",
              category: "accommodation",
              date: new Date().toISOString(),
              splits: [{ userId: "u1", amount: 240 }],
            },
          ],
        },
        isLoading: false,
        refetch: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={["/edit-expense/exp-42"]}>
          <Routes>
            <Route path="/edit-expense/:id" element={<EditExpense />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId("drawer-category-aura")).toHaveAttribute("data-category-id", "accommodation");
      expect(screen.getByTestId("drawer-category-hero-icon")).toBeInTheDocument();
      expect(screen.getByTestId("category-pill-accommodation")).toHaveAttribute("aria-checked", "true");
    });
  });
});

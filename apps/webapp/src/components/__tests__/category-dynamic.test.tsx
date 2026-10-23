import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  CategoryIcon,
  getCategoryIconComponent,
  getCategoryBadgeColor,
  getCategoryDisplayName
} from "../category-icon";
import ExpenseForm from "../expense-form";
import { Coffee, Plane, Heart, Utensils, Tag, Member } from "lucide-react";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ onValueChange, value, children }: any) => (
    <select
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      data-testid="mock-category-select"
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

describe("Dynamic Categories UI", () => {
  const dynamicCategories = [
    {
      id: "office_supplies",
      name: "Office Supplies",
      icon: "briefcase",
      description: "Paper, pens, toner",
    },
    {
      id: "coffee_runs",
      name: "Coffee & Snacks",
      icon: "coffee",
      description: "Espresso, snacks, fruit",
    },
    {
      id: "team_travel",
      name: "Team Travel",
      icon: "plane",
      description: "Flights, taxis, trains",
    },
  ];

  describe("getCategoryIconComponent & CategoryIcon dynamic resolution", () => {
    it("dynamically resolves custom Lucide icon names from spreadsheet without hardcoding", () => {
      // "coffee" is not in legacy hardcoded ICON_MAP, but is a valid Lucide icon
      const CoffeeComponent = getCategoryIconComponent("coffee");
      expect(CoffeeComponent).toBe(Coffee);

      // "plane" is not in legacy hardcoded ICON_MAP, but is a valid Lucide icon
      const PlaneComponent = getCategoryIconComponent("plane");
      expect(PlaneComponent).toBe(Plane);

      // "heart"
      const HeartComponent = getCategoryIconComponent("heart");
      expect(HeartComponent).toBe(Heart);
    });

    it("resolves icon from passed categories list when categoryId is provided", () => {
      const { container } = render(
        <CategoryIcon
          categoryId="coffee_runs"
          categories={dynamicCategories}
          data-testid="category-icon"
        />
      );
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("falls back to Tag icon when icon is not recognized or not found", () => {
      const FallbackComponent = getCategoryIconComponent("completely_non_existent_icon_xyz");
      expect(FallbackComponent).toBe(Tag);
    });
  });

  describe("getCategoryBadgeColor deterministic dynamic palette", () => {
    it("assigns consistent badge color without hardcoding category names", () => {
      const color1 = getCategoryBadgeColor("office_supplies");
      const color2 = getCategoryBadgeColor("office_supplies");
      expect(color1).toBe(color2);
      expect(color1).toContain("text-");
      expect(color1).toContain("bg-");

      // Custom category names not matching 'food', 'transport', 'hotel', 'shop', 'entertain'
      const customColorA = getCategoryBadgeColor("coffee_runs");
      const customColorB = getCategoryBadgeColor("hardware_tools");
      expect(customColorA).toBeTruthy();
      expect(customColorB).toBeTruthy();
      // Should not fall back to gray if deterministic hashing is used
      expect(customColorA).not.toBe("bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300");
    });
  });

  describe("getCategoryDisplayName dynamic lookup", () => {
    it("returns display name from dynamic categories list", () => {
      const name = getCategoryDisplayName("coffee_runs", dynamicCategories);
      expect(name).toBe("Coffee & Snacks");
    });

    it("formats unknown category IDs cleanly without hardcoding 'Other'", () => {
      const name = getCategoryDisplayName("cloud_hosting", dynamicCategories);
      expect(name).toBe("Cloud Hosting");
    });

    it("returns empty string when categoryId is empty or undefined", () => {
      expect(getCategoryDisplayName(undefined, dynamicCategories)).toBe("");
      expect(getCategoryDisplayName("", dynamicCategories)).toBe("");
    });
  });

  describe("ExpenseForm with dynamic categories", () => {
    const mockUsers: Member[] = [
      {
        userId: "user-1",
        name: "Alice",
        email: "alice@example.com",
        role: "owner",
        joinedAt: new Date(),
      },
    ];

    it("populates select options exclusively from the group's dynamic categories", () => {
      render(
        <ExpenseForm
          users={mockUsers}
          categories={dynamicCategories}
          currentUserId="user-1"
          onSubmit={vi.fn()}
          isPending={false}
          isDrawer={true}
        />
      );

      const selects = screen.getAllByTestId("mock-category-select");
      // selects[0] is paidBy, selects[1] is category
      const select = selects[1];
      const options = select.querySelectorAll("option");
      const optionValues = Array.from(options).map((opt) => opt.value);

      expect(optionValues).toEqual(["office_supplies", "coffee_runs", "team_travel"]);
      expect(screen.getByText("Coffee & Snacks")).toBeInTheDocument();
      expect(screen.getByText("Office Supplies")).toBeInTheDocument();
      expect(screen.getByText("Team Travel")).toBeInTheDocument();

      // Ensure no default categories like "food_dining" or "other" were injected
      expect(screen.queryByText("Food & Dining")).not.toBeInTheDocument();
    });
  });
});

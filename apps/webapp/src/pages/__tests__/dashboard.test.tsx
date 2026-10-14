import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Dashboard from "../dashboard";
import { useAppContext } from "@/context/app-context";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/hooks/use-settings";
import en from "@/locales/en/translation.json";
import { formatCurrency } from "@quozen/core";

vi.mock("@/context/app-context", () => ({
  useAppContext: vi.fn(),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(() => ({ mutate: vi.fn() })),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
    })),
  };
});

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/components/settlement-modal", () => ({
  default: ({ isOpen, onClose, fromUser, toUser, suggestedAmount }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="mock-settlement-modal">
        <button onClick={onClose}>Close</button>
        <div>From: {fromUser?.name}</div>
        <div>To: {toUser?.name}</div>
        <div>Amount: {suggestedAmount}</div>
      </div>
    );
  },
}));

vi.mock("@/lib/storage", () => ({
  quozen: {
    ledger: vi.fn(() => ({
      getLedger: vi.fn(),
    }))
  }
}));

describe("Dashboard Page", () => {
  const mockMembers = [
    { userId: "user1", name: "Alice", email: "alice@example.com" },
    { userId: "user2", name: "Bob", email: "bob@example.com" },
  ];

  const mockExpenses = [
    {
      id: "exp1",
      description: "Lunch",
      amount: 20.00,
      paidByUserId: "user2",
      category: "Food",
      date: new Date().toISOString(),
      splits: [{ userId: "user1", amount: 10 }, { userId: "user2", amount: 10 }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAppContext as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      activeGroupId: "group1",
      currentUserId: "user1",
    });
    (useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      settings: { preferences: { defaultCurrency: "USD" } }
    });
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation(({ queryKey }) => {
      if (Array.isArray(queryKey) && queryKey[0] === "drive" && queryKey[1] === "group") {
        return {
          data: {
            members: mockMembers,
            expenses: mockExpenses,
            settlements: [],
            getBalances: () => ({ user1: -10, user2: 10 }),
            getUserBalance: (uid: string) => uid === 'user1' ? -10 : 10,
            getTotalSpent: () => 10,
            getExpenseStatus: () => ({ status: 'debtor', amountOwed: 10 }),
            getSettleUpSuggestion: () => ({ fromUserId: 'user1', toUserId: 'user2', amount: 10 })
          },
          isLoading: false
        };
      }
      return { data: undefined, isLoading: false };
    });
  });

  it("renders dashboard with calculated user balance", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    expect(screen.getByTestId("text-user-balance")).toHaveTextContent(formatCurrency(10));
    expect(screen.getByText(en.dashboard.owe)).toBeInTheDocument();
  });

  it("renders calculated group balances correctly", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("text-balance-user2")).toHaveTextContent("+" + formatCurrency(10));
  });

  it("renders recent expenses", () => {
    render(<Dashboard />);
    expect(screen.getByText(en.dashboard.recentActivity)).toBeInTheDocument();
    expect(screen.getByText("Lunch")).toBeInTheDocument();
    expect(screen.getByText(/Bob\s*•/)).toBeInTheDocument();
  });

  it("opens settlement modal with correct suggestion when 'Settle Up' is clicked", () => {
    render(<Dashboard />);
    const settleUpBtn = screen.getByTestId("button-settle-up");
    fireEvent.click(settleUpBtn);
    expect(screen.getByTestId("mock-settlement-modal")).toBeInTheDocument();
    expect(screen.getByText("From: Alice")).toBeInTheDocument();
    expect(screen.getByText("To: Bob")).toBeInTheDocument();
    expect(screen.getByText("Amount: 10")).toBeInTheDocument();
  });

  it("renders the active account switcher pill on the balance card", () => {
    render(<Dashboard />);
    const switcher = screen.getByTestId("button-account-switcher");
    expect(switcher).toBeInTheDocument();
    expect(switcher).toHaveTextContent("Alice");
  });
});


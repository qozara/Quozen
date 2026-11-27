import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Ledger } from "@quozen/core";
import BottomNavigation from "@/components/bottom-navigation";
import ExpensesList from "@/pages/expenses";
import SettlementModal from "@/components/settlement-modal";
import Dashboard from "@/pages/dashboard";
import { AppContext } from "@/context/app-context";
import { AgentCommandDrawer } from "@/features/agent/AgentCommandDrawer";

const mockCloseGroup = vi.fn();
const mockAddSettlement = vi.fn();
const mockGetLedger = vi.fn();
let mockSettingsState: any = {};
let mockGroupsState: any[] = [];

vi.mock("@/lib/storage", () => ({
  quozen: {
    groups: {
      closeGroup: (...args: any[]) => mockCloseGroup(...args),
      reopenGroup: vi.fn(),
    },
    ledger: () => ({
      getLedger: (...args: any[]) => mockGetLedger(...args),
      addSettlement: (...args: any[]) => mockAddSettlement(...args),
      deleteExpense: vi.fn(),
    }),
  },
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: mockSettingsState,
    closeGroup: mockCloseGroup,
    reopenGroup: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-groups", () => ({
  useGroups: () => ({
    groups: mockGroupsState,
    archivedGroups: [],
    isLoading: false,
  }),
}));

vi.mock("@/context/auth-provider", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Alice", email: "alice@example.com" },
    isAuthenticated: true,
  }),
  useOptionalAuth: () => ({
    user: { id: "u1", name: "Alice", email: "alice@example.com" },
    isAuthenticated: true,
  }),
}));

vi.mock("@/features/agent/useAgent", () => ({
  useAgent: () => ({
    executeCommand: vi.fn(),
  }),
}));

const baseAppContext: any = {
  activeGroupId: "g1",
  setActiveGroupId: vi.fn(),
  currentUserId: "u1",
  setActiveAccountId: vi.fn(),
  isAddExpenseOpen: false,
  setIsAddExpenseOpen: vi.fn(),
  expenseDraft: null,
  setExpenseDraft: vi.fn(),
  expenseDraftMeta: null,
  openExpenseWithDraft: vi.fn(),
  settlementDraftState: { isOpen: false },
  setSettlementDraftState: vi.fn(),
  openSettlementWithDraft: vi.fn(),
  schemaErrorStatus: null,
  setSchemaErrorStatus: vi.fn(),
};

const sampleMembers = [
  { userId: "u1", email: "alice@example.com", name: "Alice", role: "owner" as const, joinedAt: new Date() },
  { userId: "u2", email: "bob@example.com", name: "Bob", role: "member" as const, joinedAt: new Date() },
];

const sampleExpense = {
  id: "e1",
  description: "Dinner",
  amount: 100,
  category: "food_dining",
  date: new Date("2026-05-01"),
  paidByUserId: "u1",
  splits: [
    { userId: "u1", amount: 50 },
    { userId: "u2", amount: 50 },
  ],
  createdAt: new Date("2026-05-01"),
  updatedAt: new Date("2026-05-01"),
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("Closed Group Read-Only UI & Auto-Close Prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsState = {
      version: 5,
      activeGroupId: "g1",
      groupCache: [{ id: "g1", name: "Tokyo Trip", role: "owner", status: "closed" }],
      archivedGroupCache: [],
      preferences: { defaultCurrency: "USD" },
      lastUpdated: new Date().toISOString(),
    };
    mockGroupsState = [
      {
        id: "g1",
        name: "Tokyo Trip",
        description: "Google Sheet Group",
        createdBy: "u1",
        participants: [],
        createdAt: new Date(),
        isOwner: true,
        status: "closed",
      },
    ];
  });

  it("hides the bottom-navigation '+' button when active group is closed", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppContext.Provider value={baseAppContext}>
          <BottomNavigation />
        </AppContext.Provider>
      </MemoryRouter>
    );

    expect(screen.queryByTestId("button-nav-add")).toBeNull();
    expect(screen.getByTestId("button-nav-home")).toBeInTheDocument();
    expect(screen.getByTestId("button-nav-expenses")).toBeInTheDocument();
    expect(screen.getByTestId("button-nav-groups")).toBeInTheDocument();
    expect(screen.getByTestId("button-nav-profile")).toBeInTheDocument();
  });

  it("hides the AgentCommandDrawer quick-parse trigger when active group is closed", () => {
    const slot = document.createElement("div");
    slot.id = "header-actions-slot";
    document.body.appendChild(slot);

    try {
      render(
        <AppContext.Provider value={baseAppContext}>
          <AgentCommandDrawer />
        </AppContext.Provider>
      );
      expect(screen.queryByTestId("button-ai-assistant")).toBeNull();
    } finally {
      document.body.removeChild(slot);
    }
  });

  it("hides expense meatball menus and invokes read-only selection callback when closed", () => {
    const onSelectReadOnly = vi.fn();
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AppContext.Provider value={baseAppContext}>
            <ExpensesList
              expenses={[sampleExpense]}
              members={sampleMembers}
              isClosed={true}
              onSelectExpenseReadOnly={onSelectReadOnly}
            />
          </AppContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.queryByTestId("button-options-expense-e1")).toBeNull();
    fireEvent.click(screen.getByTestId("card-expense-e1").firstElementChild!);
    expect(onSelectReadOnly).toHaveBeenCalledWith(sampleExpense);
  });

  it("hides settle-up actions on Dashboard when closed and opens read-only detail drawer on expense click", async () => {
    const closedLedger = new Ledger({
      members: sampleMembers,
      expenses: [sampleExpense],
      settlements: [],
      status: "closed",
    });
    mockGetLedger.mockResolvedValue(closedLedger);
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AppContext.Provider value={baseAppContext}>
            <Dashboard />
          </AppContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("button-settle-up")).toBeNull();
    expect(screen.queryByTestId("button-settle-with-u2")).toBeNull();

    fireEvent.click(screen.getByTestId("expense-item-e1"));
    await waitFor(() => {
      expect(screen.getByTestId("drawer-transaction-detail")).toBeInTheDocument();
    });
  });

  it("prompts to close group after recording a settlement that makes all balances zero", async () => {
    mockSettingsState.groupCache[0].status = "open";
    mockGroupsState[0].status = "open";
    mockAddSettlement.mockResolvedValue({
      id: "s1",
      fromUserId: "u2",
      toUserId: "u1",
      amount: 50,
      method: "cash",
      date: new Date(),
    });

    const openLedger = new Ledger({
      members: sampleMembers,
      expenses: [sampleExpense],
      settlements: [],
      status: "open",
    });
    const qc = createTestQueryClient();
    qc.setQueryData(["drive", "group", "g1"], openLedger);
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AppContext.Provider value={baseAppContext}>
            <SettlementModal
              isOpen={true}
              onClose={onClose}
              fromUser={{ userId: "u2", name: "Bob" }}
              toUser={{ userId: "u1", name: "Alice" }}
              suggestedAmount={50}
              users={sampleMembers}
            />
          </AppContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByTestId("button-record-payment"));

    await waitFor(() => {
      expect(screen.getByTestId("dialog-auto-close-group")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("button-auto-close-confirm"));
    await waitFor(() => {
      expect(mockCloseGroup).toHaveBeenCalledWith("g1");
    });
  });
});

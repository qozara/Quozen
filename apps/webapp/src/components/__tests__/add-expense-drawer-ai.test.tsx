import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AddExpenseDrawer from "../add-expense-drawer";
import { Ledger } from "@quozen/core";

const { mockSetExpenseDraft, mockSetIsAddExpenseOpen, mockToast } = vi.hoisted(() => ({
    mockSetExpenseDraft: vi.fn(),
    mockSetIsAddExpenseOpen: vi.fn(),
    mockToast: vi.fn(),
}));

vi.mock("@/context/app-context", () => ({
    useAppContext: vi.fn(() => ({
        activeGroupId: "group-1",
        currentUserId: "u1",
        isAddExpenseOpen: true,
        setIsAddExpenseOpen: mockSetIsAddExpenseOpen,
        expenseDraft: {
            description: "Dinner",
            amount: 50,
            category: "food_dining",
            date: new Date("2026-11-14T12:00:00Z"),
            paidByUserId: "u1",
            splits: [
                { userId: "u1", amount: 25 },
                { userId: "u2", amount: 25 },
            ],
            splitStrategy: "equally_everyone",
        },
        setExpenseDraft: mockSetExpenseDraft,
        expenseDraftMeta: {
            rawInput: "dinner 50",
            isAiEscalated: false,
            ambiguities: [],
        },
    })),
}));

vi.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: mockToast }),
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
        })),
    },
}));

const mockLedger = new Ledger({
    members: [
        { userId: "u1", name: "Alice", email: "alice@example.com", role: "owner", joinedAt: new Date() },
        { userId: "u2", name: "Bob", email: "bob@example.com", role: "member", joinedAt: new Date() },
    ],
    expenses: [],
    settlements: [],
});

vi.mock("@tanstack/react-query", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@tanstack/react-query")>();
    return {
        ...actual,
        useQuery: vi.fn(() => ({
            data: mockLedger,
            isLoading: false,
        })),
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
    DrawerContent: ({ children }: any) => <div>{children}</div>,
    DrawerHeader: ({ children }: any) => <div>{children}</div>,
    DrawerTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
    DrawerDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock("@/components/ui/checkbox", () => ({
    Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
        <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheckedChange?.(e.target.checked)}
            {...props}
        />
    ),
}));

vi.mock("@/components/ui/select", () => ({
    Select: ({ onValueChange, value, children }: any) => (
        <select value={value} onChange={(e) => onValueChange?.(e.target.value)} data-testid="mock-select">
            {children}
        </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ value }: any) => <option value={value}>{value}</option>,
}));

describe("AddExpenseDrawer — Transparent Draft Confirmation UI", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders draft confirmation banner cleanly without manual Refine with AI buttons", () => {
        render(<AddExpenseDrawer />);

        expect(screen.getByTestId("draft-confirmation-banner")).toBeInTheDocument();
        expect(screen.getByTestId("input-expense-description")).toHaveValue("Dinner");
        expect(screen.queryByTestId("button-refine-with-ai")).toBeNull();
    });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ExpenseForm from "../expense-form";
import { Member } from "@quozen/core";
import en from "@/locales/en/translation.json";

vi.mock("react-router-dom", () => ({
    useNavigate: () => vi.fn(),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: mockToast }),
}));

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const keys: Record<string, string> = {
                "expenseForm.description": "Description",
                "expenseForm.amount": "Amount",
                "expenseForm.paidBy": "Paid by",
                "expenseForm.category": "Category",
                "expenseForm.date": "Date",
                "expenseForm.splitBetween": "Split Between",
                "expenseForm.selectCategory": "Select category",
                "expenseForm.save": "Save Expense",
                "expenseForm.saving": "Saving...",
                "expenseForm.missingInfo": en.expenseForm.missingInfo,
                "expenseForm.missingInfoDesc": en.expenseForm.missingInfoDesc,
                "expenseForm.invalidSplit": en.expenseForm.invalidSplit,
                "expenseForm.invalidSplitDesc": en.expenseForm.invalidSplitDesc,
                "expenseForm.splitMismatch": en.expenseForm.splitMismatch,
                "expenseForm.splitMismatchDesc": en.expenseForm.splitMismatchDesc,
                "expenseForm.invalidAmount": "Invalid amount",
                "expenseForm.invalidAmountDesc": "Please enter a valid numeric value for the amount.",
                "expenseForm.you": "You",
            };
            return keys[key] ?? key;
        },
    }),
}));

vi.mock("@/lib/utils", () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(" "),
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
        <select
            value={value}
            onChange={(e) => onValueChange?.(e.target.value)}
            data-testid="mock-select"
        >
            {children}
        </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

const mockUsers: Member[] = [
    {
        userId: "test-user-id",
        name: "Alice",
        email: "alice@example.com",
        role: "owner",
        joinedAt: new Date(),
    },
    {
        userId: "user-2",
        name: "Bob",
        email: "bob@example.com",
        role: "member",
        joinedAt: new Date(),
    },
];

const defaultProps = {
    users: mockUsers,
    currentUserId: "test-user-id",
    onSubmit: vi.fn(),
    isPending: false,
    isDrawer: true,
};

describe("ExpenseForm — Amount Validation (U5)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("rejects non-numeric input: input element enforces type=number", () => {
        render(<ExpenseForm {...defaultProps} />);
        const amountInput = screen.getByTestId("input-expense-amount");
        expect(amountInput).toHaveAttribute("type", "number");
    });

    it("shows 'Missing information' toast when amount is empty and form is submitted", async () => {
        render(<ExpenseForm {...defaultProps} />);

        fireEvent.change(screen.getByTestId("input-expense-description"), {
            target: { value: "Dinner" },
        });

        // Use fireEvent.submit on the <form> directly to bypass jsdom's native
        // HTML5 required-field validation, which would otherwise swallow the event
        // before React's handleSubmit can fire the toast.
        const form = screen.getByTestId("form-expense");
        fireEvent.submit(form);

        expect(mockToast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: en.expenseForm.missingInfo,
                variant: "destructive",
            })
        );
        expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    });

    it("shows 'Split mismatch' toast when manually-entered split does not equal amount", async () => {
        render(<ExpenseForm {...defaultProps} />);

        fireEvent.change(screen.getByTestId("input-expense-description"), {
            target: { value: "Bad Math Expense" },
        });
        fireEvent.change(screen.getByTestId("input-expense-amount"), {
            target: { value: "100" },
        });

        const selects = screen.getAllByTestId("mock-select");
        // paidBy is index 0, category is index 1
        fireEvent.change(selects[1], { target: { value: "Other" } });

        // Override the auto-split to a mismatched value
        const splitInput = screen.getByTestId("input-split-amount-test-user-id");
        fireEvent.change(splitInput, { target: { value: "10" } });

        const form = screen.getByTestId("form-expense");
        fireEvent.submit(form);

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: en.expenseForm.splitMismatch,
                    variant: "destructive",
                })
            );
        });
        expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    });

    it("does NOT call onSubmit when form has an invalid (non-numeric) amount value and shows invalidAmount toast", async () => {
        render(<ExpenseForm {...defaultProps} />);

        fireEvent.change(screen.getByTestId("input-expense-description"), {
            target: { value: "Test" },
        });

        // Simulate a value that parseFloat results in NaN
        // Although type="number" blocks most, some browser/pasted inputs might bypass
        fireEvent.change(screen.getByTestId("input-expense-amount"), {
            target: { value: "abc" },
        });

        // Set category to avoid "missing info" toast
        const selects = screen.getAllByTestId("mock-select");
        fireEvent.change(selects[1], { target: { value: "Other" } });

        const form = screen.getByTestId("form-expense");
        fireEvent.submit(form);

        expect(defaultProps.onSubmit).not.toHaveBeenCalled();
        expect(mockToast).toHaveBeenCalledWith(
            expect.objectContaining({ 
                title: "Invalid amount", // based on our mock's simple key return or explicit mapping
                variant: "destructive" 
            })
        );
    });
});

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
        t: (key: string, options?: Record<string, string>) => {
            if (key === "expenseForm.youNamed" && options?.name) {
                return `You (${options.name})`;
            }
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
                "expenseForm.errors.categoryRequired": en.expenseForm.errors.categoryRequired,
                "expenseForm.errors.descriptionRequired": en.expenseForm.errors.descriptionRequired,
                "expenseForm.errors.amountRequired": en.expenseForm.errors.amountRequired,
                "expenseForm.errors.amountInvalid": en.expenseForm.errors.amountInvalid,
                "expenseForm.errors.paidByRequired": en.expenseForm.errors.paidByRequired,
                "expenseForm.errors.dateRequired": en.expenseForm.errors.dateRequired,
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

        fireEvent.click(screen.getByTestId("category-pill-other"));

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
        fireEvent.click(screen.getByTestId("category-pill-other"));

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

    it("displays 'You (<Account Name>)' when the active account is a Shared or Offline Account", async () => {
        const authMod = await import("@/context/auth-provider");
        vi.spyOn(authMod, "useOptionalAuth").mockReturnValue({
            user: { id: "user-bob", name: "Bob", email: "bob@example.com", username: "bob" },
            isAuthenticated: true,
            isLoading: false,
            token: "tok",
            login: vi.fn(),
            logout: vi.fn(),
        });

        const sharedUsers: Member[] = [
            {
                userId: "shared-acc-1",
                name: "Garcia Family",
                email: "alice@example.com",
                role: "owner",
                joinedAt: new Date(),
            },
            {
                userId: "user-charlie",
                name: "Charlie",
                email: "charlie@example.com",
                role: "member",
                joinedAt: new Date(),
            },
        ];

        render(
            <ExpenseForm
                {...defaultProps}
                users={sharedUsers}
                currentUserId="shared-acc-1"
            />
        );

        expect(screen.getAllByText("You (Garcia Family)").length).toBeGreaterThan(0);
    });
});

describe("ExpenseForm — Unified Mobile Inline Validation & Accessibility", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("disables native browser validation popups via noValidate and starts all fields with aria-invalid=false", () => {
        render(<ExpenseForm {...defaultProps} />);

        const form = screen.getByTestId("form-expense");
        expect(form).toHaveAttribute("novalidate");

        const categoryGroup = screen.getByTestId("select-category");
        const descInput = screen.getByTestId("input-expense-description");
        const amountInput = screen.getByTestId("input-expense-amount");
        const dateInput = screen.getByTestId("input-expense-date");

        expect(categoryGroup).toHaveAttribute("aria-invalid", "false");
        expect(descInput).toHaveAttribute("aria-invalid", "false");
        expect(amountInput).toHaveAttribute("aria-invalid", "false");
        expect(dateInput).toHaveAttribute("aria-invalid", "false");

        // No premature inline errors on initial render
        expect(screen.queryByTestId("error-category")).toBeNull();
        expect(screen.queryByTestId("error-description")).toBeNull();
        expect(screen.queryByTestId("error-amount")).toBeNull();
    });

    it("shows consistent inline errors for all missing mandatory fields on submit, links aria-describedby, and clears each error once fixed", () => {
        render(<ExpenseForm {...defaultProps} />);

        fireEvent.submit(screen.getByTestId("form-expense"));

        // Every missing required field displays an inline error with accessible linkage
        const categoryGroup = screen.getByTestId("select-category");
        const descInput = screen.getByTestId("input-expense-description");
        const amountInput = screen.getByTestId("input-expense-amount");

        expect(screen.getByTestId("error-category")).toHaveTextContent(en.expenseForm.errors.categoryRequired);
        expect(screen.getByTestId("error-description")).toHaveTextContent(en.expenseForm.errors.descriptionRequired);
        expect(screen.getByTestId("error-amount")).toHaveTextContent(en.expenseForm.errors.amountRequired);

        expect(categoryGroup).toHaveAttribute("aria-invalid", "true");
        expect(categoryGroup).toHaveAttribute("aria-describedby", "expense-error-category");
        expect(descInput).toHaveAttribute("aria-invalid", "true");
        expect(descInput).toHaveAttribute("aria-describedby", "expense-error-description");
        expect(amountInput).toHaveAttribute("aria-invalid", "true");
        expect(amountInput).toHaveAttribute("aria-describedby", "expense-error-amount");

        // Fixing each field clears its error and aria-invalid immediately
        fireEvent.click(screen.getByTestId("category-pill-food_dining"));
        expect(screen.queryByTestId("error-category")).toBeNull();
        expect(categoryGroup).toHaveAttribute("aria-invalid", "false");
        expect(categoryGroup).not.toHaveAttribute("aria-describedby");

        fireEvent.change(descInput, { target: { value: "Lunch" } });
        expect(screen.queryByTestId("error-description")).toBeNull();
        expect(descInput).toHaveAttribute("aria-invalid", "false");

        fireEvent.change(amountInput, { target: { value: "25" } });
        expect(screen.queryByTestId("error-amount")).toBeNull();
        expect(amountInput).toHaveAttribute("aria-invalid", "false");

        // Submitting now succeeds cleanly
        fireEvent.submit(screen.getByTestId("form-expense"));
        expect(defaultProps.onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                category: "food_dining",
                description: "Lunch",
                amount: 25,
            })
        );
    });

    it("validates edited fields on blur (not prematurely while typing) and moves focus to the first invalid field on submit", () => {
        render(<ExpenseForm {...defaultProps} />);

        const descInput = screen.getByTestId("input-expense-description");

        // Typing whitespace does not show error until blur
        fireEvent.change(descInput, { target: { value: "   " } });
        expect(screen.queryByTestId("error-description")).toBeNull();

        // Blurring after editing shows inline error
        fireEvent.blur(descInput);
        expect(screen.getByTestId("error-description")).toHaveTextContent(en.expenseForm.errors.descriptionRequired);

        // Select category first, leave description invalid -> submit should focus description input
        fireEvent.click(screen.getByTestId("category-pill-food_dining"));
        fireEvent.submit(screen.getByTestId("form-expense"));
        expect(document.activeElement).toBe(descInput);
    });

    it("shows inline split error when split amounts do not match expense amount", () => {
        render(<ExpenseForm {...defaultProps} />);

        fireEvent.click(screen.getByTestId("category-pill-other"));
        fireEvent.change(screen.getByTestId("input-expense-description"), { target: { value: "Dinner" } });
        fireEvent.change(screen.getByTestId("input-expense-amount"), { target: { value: "100" } });
        fireEvent.change(screen.getByTestId("input-split-amount-test-user-id"), { target: { value: "10" } });

        fireEvent.submit(screen.getByTestId("form-expense"));

        expect(screen.getByTestId("error-splits")).toHaveTextContent(en.expenseForm.splitMismatchDesc);
        expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    });
});


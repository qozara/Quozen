import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SettlementModal from "../settlement-modal";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import en from "@/locales/en/translation.json";
import { Member } from "@quozen/core";

vi.mock("@/context/app-context", () => ({
  useAppContext: vi.fn(() => ({ activeGroupId: "group1" })),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock AutoSync
vi.mock("@/hooks/use-auto-sync", () => ({
  useAutoSync: vi.fn(() => ({
    setPaused: vi.fn()
  })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
    })),
  };
});

vi.mock("@/lib/storage", () => ({
  quozen: {
    ledger: vi.fn(() => ({
      addSettlement: vi.fn(),
      updateSettlement: vi.fn()
    }))
  }
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ onValueChange, value, children }: any) => (
    <div data-testid="mock-select-wrapper">
      <select
        onChange={(e) => onValueChange(e.target.value)}
        value={value}
        data-testid="real-select"
      >
        {children}
      </select>
    </div>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

describe("SettlementModal", () => {
  const mockUsers: Member[] = [
    { userId: "u1", name: "Alice", email: "", role: "member", joinedAt: new Date() },
    { userId: "u2", name: "Bob", email: "", role: "member", joinedAt: new Date() },
    { userId: "u3", name: "Charlie", email: "", role: "member", joinedAt: new Date() },
  ];

  const mockMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useMutation as any).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    });
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    fromUser: { userId: "u1", name: "Alice" },
    toUser: { userId: "u2", name: "Bob" },
    suggestedAmount: 50,
    users: mockUsers,
  };

  it("renders with initial suggested values", () => {
    render(<SettlementModal {...defaultProps} />);
    expect(screen.getByText(en.settlement.title)).toBeInTheDocument();
    expect(screen.getByDisplayValue("50.00")).toBeInTheDocument();
  });

  it("allows changing the payer and receiver", () => {
    render(<SettlementModal {...defaultProps} />);
    const selects = screen.getAllByTestId("real-select");
    const fromSelect = selects[0];
    fireEvent.change(fromSelect, { target: { value: "u3" } });

    const submitBtn = screen.getByTestId("button-record-payment");
    fireEvent.click(submitBtn);

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      fromUserId: "u3",
      toUserId: "u2",
      amount: 50
    }));
  });

  it("validates that payer and receiver cannot be the same person", () => {
    render(<SettlementModal {...defaultProps} />);
    const selects = screen.getAllByTestId("real-select");
    const fromSelect = selects[0];
    fireEvent.change(fromSelect, { target: { value: "u2" } }); // Change to Bob (Receiver)

    const submitBtn = screen.getByTestId("button-record-payment");
    fireEvent.click(submitBtn);

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: en.settlement.sameUser,
      variant: "destructive"
    }));
  });
});

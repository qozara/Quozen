import { renderHook } from "@testing-library/react";
import { useAgent } from "../useAgent";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { Ledger } from "@quozen/core";

const {
    mockOpenExpenseWithDraft,
    mockOpenSettlementWithDraft,
    mockToast,
    mockGetLedger
} = vi.hoisted(() => ({
    mockOpenExpenseWithDraft: vi.fn(),
    mockOpenSettlementWithDraft: vi.fn(),
    mockToast: vi.fn(),
    mockGetLedger: vi.fn()
}));

vi.mock("@/context/app-context", () => ({
    useAppContext: vi.fn(() => ({
        openExpenseWithDraft: mockOpenExpenseWithDraft,
        openSettlementWithDraft: mockOpenSettlementWithDraft,
    })),
}));

vi.mock("@/hooks/use-settings", () => ({
    useSettings: vi.fn(() => ({
        settings: {
            preferences: { aiProvider: 'cloud', locale: 'en' },
            encryptedApiKey: 'test-key'
        }
    })),
}));

vi.mock("../AiFeatureContext", () => ({
    useAiFeature: vi.fn(() => ({
        status: 'available',
        provider: { id: 'test-provider', mode: 'cloud' }
    })),
}));

vi.mock("../useRagContext", () => ({
    useRagContext: vi.fn(() => ({
        activeGroupId: 'g1',
        currentUserId: 'u1'
    })),
}));

vi.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: mockToast }),
    toast: mockToast
}));

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: 'en' }
    }),
}));

vi.mock("@/lib/storage", () => ({
    quozen: {
        ledger: vi.fn(() => ({
            getLedger: mockGetLedger
        }))
    },
}));

vi.mock("@/lib/tokenStore", () => ({
    getAuthToken: vi.fn(() => 'test-token'),
}));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: false },
    },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("useAgent Hook", () => {
    const mockLedgerData = {
        members: [
            { userId: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner' as const, joinedAt: new Date() },
            { userId: 'u2', name: 'Bob', email: 'bob@example.com', role: 'member' as const, joinedAt: new Date() }
        ],
        expenses: [],
        settlements: []
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetLedger.mockResolvedValue(new Ledger(mockLedgerData));
    });

    it("should parse expense command deterministically and open expense draft", async () => {
        const { result } = renderHook(() => useAgent(), { wrapper });

        const response = await result.current.executeCommand("dinner 40 with Bob");

        expect(response.success).toBe(true);
        expect(response.message).toBe("Expense draft created");
        expect(mockOpenExpenseWithDraft).toHaveBeenCalledTimes(1);
        const [draft, meta] = mockOpenExpenseWithDraft.mock.calls[0];
        expect(draft.amount).toBe(40);
        expect(draft.description).toBe("Dinner");
        expect(meta.rawInput).toBe("dinner 40 with Bob");
    });

    it("should parse settlement command deterministically and open settlement draft", async () => {
        const { result } = renderHook(() => useAgent(), { wrapper });

        const response = await result.current.executeCommand("I paid Bob 25 via cash");

        expect(response.success).toBe(true);
        expect(response.message).toBe("Settlement draft created");
        expect(mockOpenSettlementWithDraft).toHaveBeenCalledTimes(1);
        const [draft, meta] = mockOpenSettlementWithDraft.mock.calls[0];
        expect(draft.amount).toBe(25);
        expect(draft.toUserId).toBe("u2");
        expect(draft.method).toBe("cash");
        expect(meta.rawInput).toBe("I paid Bob 25 via cash");
    });

    it("should show error toast if no active group", async () => {
        const { useRagContext } = await import("../useRagContext");
        (useRagContext as any).mockReturnValue({ activeGroupId: null, currentUserId: 'u1' });

        const { result } = renderHook(() => useAgent(), { wrapper });
        const response = await result.current.executeCommand("dinner 40");

        expect(response.success).toBe(false);
        expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
            variant: "destructive"
        }));
        expect(mockOpenExpenseWithDraft).not.toHaveBeenCalled();
    });

    it("should work offline when AI feature is unavailable", async () => {
        const { useRagContext } = await import("../useRagContext");
        (useRagContext as any).mockReturnValue({ activeGroupId: 'g1', currentUserId: 'u1' });

        const { useAiFeature } = await import("../AiFeatureContext");
        (useAiFeature as any).mockReturnValue({ status: 'disabled', provider: undefined });

        const { result } = renderHook(() => useAgent(), { wrapper });
        const response = await result.current.executeCommand("lunch 15 with Bob");

        expect(response.success).toBe(true);
        expect(mockOpenExpenseWithDraft).toHaveBeenCalled();
    });
});

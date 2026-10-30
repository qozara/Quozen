import { renderHook } from "@testing-library/react";
import { useAgent } from "../useAgent";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { Ledger, Expense } from "@quozen/core";

const {
    mockOpenExpenseWithDraft,
    mockOpenSettlementWithDraft,
    mockToast,
    mockGetLedger,
    mockEscalateCommand
} = vi.hoisted(() => ({
    mockOpenExpenseWithDraft: vi.fn(),
    mockOpenSettlementWithDraft: vi.fn(),
    mockToast: vi.fn(),
    mockGetLedger: vi.fn(),
    mockEscalateCommand: vi.fn()
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

vi.mock("@quozen/ai-services", () => ({
    LlmIntentEscalator: vi.fn().mockImplementation(function (this: any) {
        this.escalateCommand = mockEscalateCommand;
        return this;
    })
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
    const mockMembers = [
        { userId: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner' as const, joinedAt: new Date() },
        { userId: 'u2', name: 'Bob', email: 'bob@example.com', role: 'member' as const, joinedAt: new Date() },
        { userId: 'u3', name: 'Charlie', email: 'charlie@example.com', role: 'member' as const, joinedAt: new Date() }
    ];

    beforeEach(async () => {
        vi.clearAllMocks();
        const { useAiFeature } = await import("../AiFeatureContext");
        (useAiFeature as any).mockReturnValue({
            status: 'available',
            provider: { id: 'test-provider', mode: 'cloud' }
        });
        const { useRagContext } = await import("../useRagContext");
        (useRagContext as any).mockReturnValue({
            activeGroupId: 'g1',
            currentUserId: 'u1'
        });
        mockGetLedger.mockResolvedValue(new Ledger({
            members: mockMembers,
            expenses: [],
            settlements: []
        }));
    });

    describe("Deterministic Command Suite (Offline & Zero-Delay)", () => {
        it("parses equal split expense deterministically and opens expense draft", async () => {
            const { result } = renderHook(() => useAgent(), { wrapper });

            const response = await result.current.executeCommand("dinner 60 with Bob");

            expect(response.success).toBe(true);
            expect(response.message).toBe("Expense draft created");
            expect(mockOpenExpenseWithDraft).toHaveBeenCalledTimes(1);

            const [draft, meta] = mockOpenExpenseWithDraft.mock.calls[0];
            expect(draft.amount).toBe(60);
            expect(draft.description).toBe("Dinner");
            expect(draft.paidByUserId).toBe("u1");
            expect(meta.rawInput).toBe("dinner 60 with Bob");
            expect(meta.isAiEscalated).toBe(false);

            const aliceSplit = draft.splits.find((s: any) => s.userId === 'u1');
            const bobSplit = draft.splits.find((s: any) => s.userId === 'u2');
            const charlieSplit = draft.splits.find((s: any) => s.userId === 'u3');

            expect(aliceSplit.amount).toBe(30);
            expect(bobSplit.amount).toBe(30);
            expect(charlieSplit.amount).toBe(0);
        });

        it("parses third-party payer expense deterministically", async () => {
            const { result } = renderHook(() => useAgent(), { wrapper });

            const response = await result.current.executeCommand("Bob paid 90 for groceries");

            expect(response.success).toBe(true);
            expect(mockOpenExpenseWithDraft).toHaveBeenCalledTimes(1);

            const [draft] = mockOpenExpenseWithDraft.mock.calls[0];
            expect(draft.amount).toBe(90);
            expect(draft.paidByUserId).toBe("u2"); // Bob paid
            expect(draft.category).toBe("food_dining");
            // 90 split equally across all 3 members (30 each)
            expect(draft.splits.every((s: any) => s.amount === 30)).toBe(true);
        });

        it("parses expense with exclusions deterministically", async () => {
            const { result } = renderHook(() => useAgent(), { wrapper });

            const response = await result.current.executeCommand("Add 80 for drinks with all except Bob");

            expect(response.success).toBe(true);
            const [draft] = mockOpenExpenseWithDraft.mock.calls[0];
            expect(draft.amount).toBe(80);

            const bobSplit = draft.splits.find((s: any) => s.userId === 'u2');
            const aliceSplit = draft.splits.find((s: any) => s.userId === 'u1');
            const charlieSplit = draft.splits.find((s: any) => s.userId === 'u3');

            expect(bobSplit.amount).toBe(0);
            expect(aliceSplit.amount).toBe(40);
            expect(charlieSplit.amount).toBe(40);
        });

        it("parses settlement command with direction and method deterministically", async () => {
            const { result } = renderHook(() => useAgent(), { wrapper });

            const response = await result.current.executeCommand("I paid Bob 25 via cash");

            expect(response.success).toBe(true);
            expect(response.message).toBe("Settlement draft created");
            expect(mockOpenSettlementWithDraft).toHaveBeenCalledTimes(1);

            const [draft, meta] = mockOpenSettlementWithDraft.mock.calls[0];
            expect(draft.amount).toBe(25);
            expect(draft.fromUserId).toBe("u1");
            expect(draft.toUserId).toBe("u2");
            expect(draft.method).toBe("cash");
            expect(meta.rawInput).toBe("I paid Bob 25 via cash");
            expect(meta.isAiEscalated).toBe(false);
        });

        it("parses 'settle up' command and looks up debt from ledger balances", async () => {
            const debtExpense: Expense = {
                id: 'exp-1',
                description: 'Dinner',
                amount: 100,
                category: 'food_dining',
                date: new Date(),
                paidByUserId: 'u2', // Bob paid 100
                splits: [
                    { userId: 'u1', amount: 50 },
                    { userId: 'u2', amount: 50 }
                ],
                createdAt: new Date(),
                updatedAt: new Date()
            };

            mockGetLedger.mockResolvedValue(new Ledger({
                members: mockMembers,
                expenses: [debtExpense],
                settlements: []
            }));

            const { result } = renderHook(() => useAgent(), { wrapper });

            // Alice (u1) owes Bob (u2) $50
            const response = await result.current.executeCommand("settle up with Bob");

            expect(response.success).toBe(true);
            expect(mockOpenSettlementWithDraft).toHaveBeenCalledTimes(1);

            const [draft] = mockOpenSettlementWithDraft.mock.calls[0];
            expect(draft.fromUserId).toBe("u1");
            expect(draft.toUserId).toBe("u2");
            expect(draft.amount).toBe(50);
        });

        it("parses Spanish language commands deterministically", async () => {
            const { result } = renderHook(() => useAgent(), { wrapper });

            const response = await result.current.executeCommand("Pagué 1500 almuerzo con Bob");

            expect(response.success).toBe(true);
            const [draft] = mockOpenExpenseWithDraft.mock.calls[0];
            expect(draft.amount).toBe(1500);
            expect(draft.description).toBe("Almuerzo");
        });

        it("passes ambiguity metadata when member token is ambiguous", async () => {
            const membersWithAmbiguity = [
                { userId: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner' as const, joinedAt: new Date() },
                { userId: 'u2', name: 'Ana', email: 'ana@example.com', role: 'member' as const, joinedAt: new Date() },
                { userId: 'u3', name: 'Anabel', email: 'anabel@example.com', role: 'member' as const, joinedAt: new Date() }
            ];
            mockGetLedger.mockResolvedValue(new Ledger({
                members: membersWithAmbiguity,
                expenses: [],
                settlements: []
            }));

            // Offline so it doesn't auto-escalate
            const { useAiFeature } = await import("../AiFeatureContext");
            (useAiFeature as any).mockReturnValue({ status: 'disabled', provider: undefined });

            const { result } = renderHook(() => useAgent(), { wrapper });
            const response = await result.current.executeCommand("Split 40 with An");

            expect(response.success).toBe(true);
            const [, meta] = mockOpenExpenseWithDraft.mock.calls[0];
            expect(meta.ambiguities).toContain("ambiguous_member:an");
        });

        it("shows error toast if no active group", async () => {
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

        it("works completely offline when AI feature is unavailable", async () => {
            const { useRagContext } = await import("../useRagContext");
            (useRagContext as any).mockReturnValue({ activeGroupId: 'g1', currentUserId: 'u1' });

            const { useAiFeature } = await import("../AiFeatureContext");
            (useAiFeature as any).mockReturnValue({ status: 'disabled', provider: undefined });

            const { result } = renderHook(() => useAgent(), { wrapper });
            const response = await result.current.executeCommand("lunch 15 with Bob");

            expect(response.success).toBe(true);
            expect(mockOpenExpenseWithDraft).toHaveBeenCalledTimes(1);
            expect(mockEscalateCommand).not.toHaveBeenCalled();
        });
    });

    describe("Optional LLM Escalation Suite (Isolated)", () => {
        it("escalates to LlmIntentEscalator when ambiguities occur and AI is available", async () => {
            const membersWithAmbiguity = [
                { userId: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner' as const, joinedAt: new Date() },
                { userId: 'u2', name: 'Ana', email: 'ana@example.com', role: 'member' as const, joinedAt: new Date() },
                { userId: 'u3', name: 'Anabel', email: 'anabel@example.com', role: 'member' as const, joinedAt: new Date() }
            ];
            mockGetLedger.mockResolvedValue(new Ledger({
                members: membersWithAmbiguity,
                expenses: [],
                settlements: []
            }));

            const { useRagContext } = await import("../useRagContext");
            (useRagContext as any).mockReturnValue({ activeGroupId: 'g1', currentUserId: 'u1' });

            const { useAiFeature } = await import("../AiFeatureContext");
            (useAiFeature as any).mockReturnValue({ status: 'available', provider: { id: 'cloud-p', mode: 'cloud' } });

            mockEscalateCommand.mockResolvedValue({
                intent: 'expense',
                intentConfidence: 'high',
                amount: 80,
                description: 'Dinner with Ana',
                splitStrategy: 'equally_specific_members',
                participantTokens: ['Ana'],
                excludedTokens: [],
                exactAmountTokens: [],
                dateOffsetDays: 0
            });

            const { result } = renderHook(() => useAgent(), { wrapper });
            const response = await result.current.executeCommand("Split 80 with An");

            expect(response.success).toBe(true);
            expect(mockEscalateCommand).toHaveBeenCalledTimes(1);
            expect(mockOpenExpenseWithDraft).toHaveBeenCalledTimes(1);

            const [draft, meta] = mockOpenExpenseWithDraft.mock.calls[0];
            expect(meta.isAiEscalated).toBe(true);
            expect(draft.description).toBe("Dinner with Ana");
            expect(draft.amount).toBe(80);
        });

        it("gracefully falls back to deterministic draft if LLM escalation fails", async () => {
            const membersWithAmbiguity = [
                { userId: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner' as const, joinedAt: new Date() },
                { userId: 'u2', name: 'Ana', email: 'ana@example.com', role: 'member' as const, joinedAt: new Date() },
                { userId: 'u3', name: 'Anabel', email: 'anabel@example.com', role: 'member' as const, joinedAt: new Date() }
            ];
            mockGetLedger.mockResolvedValue(new Ledger({
                members: membersWithAmbiguity,
                expenses: [],
                settlements: []
            }));

            const { useRagContext } = await import("../useRagContext");
            (useRagContext as any).mockReturnValue({ activeGroupId: 'g1', currentUserId: 'u1' });

            const { useAiFeature } = await import("../AiFeatureContext");
            (useAiFeature as any).mockReturnValue({ status: 'available', provider: { id: 'cloud-p', mode: 'cloud' } });

            mockEscalateCommand.mockRejectedValue(new Error("500 AI Service Unavailable"));

            const { result } = renderHook(() => useAgent(), { wrapper });
            const response = await result.current.executeCommand("Split 50 with An");

            // Does not crash! Falls back to deterministic draft
            expect(response.success).toBe(true);
            expect(mockOpenExpenseWithDraft).toHaveBeenCalledTimes(1);
            const [draft, meta] = mockOpenExpenseWithDraft.mock.calls[0];
            expect(draft.amount).toBe(50);
            expect(meta.isAiEscalated).toBe(false);
            expect(meta.ambiguities).toContain("ambiguous_member:an");
        });
    });
});

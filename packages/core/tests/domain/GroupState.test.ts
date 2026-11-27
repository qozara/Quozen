import { describe, it, expect } from "vitest";
import {
    resolveGroupState,
    OpenGroupState,
    ClosedGroupState,
    areAllBalancesZero,
    getNonZeroBalances,
    GroupClosedError,
    GroupNotSettledError,
    Ledger,
    type Member,
    type Expense,
    type Settlement,
} from "../../src";

const members: Member[] = [
    { userId: "u1", email: "alice@example.com", name: "Alice", role: "owner", joinedAt: new Date("2026-01-01") },
    { userId: "u2", email: "bob@example.com", name: "Bob", role: "member", joinedAt: new Date("2026-01-01") },
];

const baseExpense: Expense = {
    id: "e1",
    description: "Dinner",
    amount: 100,
    category: "food_dining",
    date: new Date("2026-01-02"),
    paidByUserId: "u1",
    splits: [
        { userId: "u1", amount: 50 },
        { userId: "u2", amount: 50 },
    ],
    createdAt: new Date("2026-01-02"),
    updatedAt: new Date("2026-01-02"),
};

describe("GroupLifecycleState (State Pattern)", () => {
    it("defaults undefined status to OpenGroupState", () => {
        const state = resolveGroupState(undefined);
        expect(state).toBeInstanceOf(OpenGroupState);
        expect(state.status).toBe("open");
        expect(state.isClosed).toBe(false);
        expect(state.isReadOnly).toBe(false);
        expect(state.canEditTransactions).toBe(true);
        expect(state.canEditGroupMetadata).toBe(true);
        expect(state.canManageRoster).toBe(true);
        expect(state.canCreateCommandDraft).toBe(true);
        expect(state.canClose).toBe(true);
        expect(state.canReopen).toBe(false);
    });

    it("resolves 'closed' to ClosedGroupState and blocks all write assertions", () => {
        const state = resolveGroupState("closed");
        expect(state).toBeInstanceOf(ClosedGroupState);
        expect(state.status).toBe("closed");
        expect(state.isClosed).toBe(true);
        expect(state.isReadOnly).toBe(true);
        expect(state.canEditTransactions).toBe(false);
        expect(state.canEditGroupMetadata).toBe(false);
        expect(state.canManageRoster).toBe(false);
        expect(state.canCreateCommandDraft).toBe(false);
        expect(state.canClose).toBe(false);
        expect(state.canReopen).toBe(true);

        expect(() => state.assertCanMutateTransactions()).toThrow(GroupClosedError);
        expect(() => state.assertCanMutateGroupMetadata()).toThrow(GroupClosedError);
        expect(() => state.assertCanMutateRoster()).toThrow(GroupClosedError);
        expect(() => state.assertCanCreateDraft()).toThrow(GroupClosedError);
    });

    it("OpenGroupState allows write assertions and validates balances on close", () => {
        const state = resolveGroupState("open");
        expect(() => state.assertCanMutateTransactions()).not.toThrow();
        expect(() => state.assertCanMutateGroupMetadata()).not.toThrow();
        expect(() => state.assertCanMutateRoster()).not.toThrow();
        expect(() => state.assertCanCreateDraft()).not.toThrow();

        // Settled balances (within floating-point epsilon)
        expect(() => state.assertCanTransitionToClosed({ u1: 0.004, u2: -0.004 })).not.toThrow();
        expect(areAllBalancesZero({ u1: 0.004, u2: -0.004 })).toBe(true);

        // Non-zero balances without force -> throws GroupNotSettledError with nonZeroBalances
        let caught: unknown;
        try {
            state.assertCanTransitionToClosed({ u1: 50, u2: -50 }, false);
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(GroupNotSettledError);
        expect((caught as GroupNotSettledError).nonZeroBalances).toEqual({ u1: 50, u2: -50 });
        expect(getNonZeroBalances({ u1: 50, u2: -50, u3: 0 })).toEqual({ u1: 50, u2: -50 });

        // Force close bypasses non-zero balance check
        expect(() => state.assertCanTransitionToClosed({ u1: 50, u2: -50 }, true)).not.toThrow();
    });
});

describe("Ledger group status & settlement zero-balance simulation", () => {
    it("exposes status, isClosed, state, and balance helpers", () => {
        const openLedger = new Ledger({ members, expenses: [baseExpense], settlements: [] });
        expect(openLedger.status).toBe("open");
        expect(openLedger.isClosed).toBe(false);
        expect(openLedger.areAllBalancesZero()).toBe(false);
        expect(openLedger.getNonZeroBalances()).toEqual({ u1: 50, u2: -50 });

        const closedLedger = new Ledger({ members, expenses: [baseExpense], settlements: [], status: "closed" });
        expect(closedLedger.status).toBe("closed");
        expect(closedLedger.isClosed).toBe(true);
        expect(closedLedger.state.canEditTransactions).toBe(false);
    });

    it("detects when a new settlement will make all account balances zero", () => {
        const ledger = new Ledger({ members, expenses: [baseExpense], settlements: [] });

        // Partial payment does not zero all balances
        expect(
            ledger.wouldSettlementZeroAllBalances({ fromUserId: "u2", toUserId: "u1", amount: 25 })
        ).toBe(false);

        // Exact payment zeroes all balances
        expect(
            ledger.wouldSettlementZeroAllBalances({ fromUserId: "u2", toUserId: "u1", amount: 50 })
        ).toBe(true);
    });

    it("detects when editing an existing settlement will make all account balances zero", () => {
        const partialSettlement: Settlement = {
            id: "s1",
            date: new Date("2026-01-03"),
            fromUserId: "u2",
            toUserId: "u1",
            amount: 30,
            method: "cash",
        };
        const ledger = new Ledger({ members, expenses: [baseExpense], settlements: [partialSettlement] });

        // Editing s1 from 30 -> 50 zeroes balances
        expect(
            ledger.wouldSettlementZeroAllBalances({ fromUserId: "u2", toUserId: "u1", amount: 50 }, "s1")
        ).toBe(true);

        // Adding a second settlement of 20 also zeroes balances
        expect(
            ledger.wouldSettlementZeroAllBalances({ fromUserId: "u2", toUserId: "u1", amount: 20 })
        ).toBe(true);
    });

    it("returns false for wouldSettlementZeroAllBalances when already settled or already closed", () => {
        const settled: Settlement = {
            id: "s1",
            date: new Date("2026-01-03"),
            fromUserId: "u2",
            toUserId: "u1",
            amount: 50,
            method: "cash",
        };
        const alreadySettledLedger = new Ledger({ members, expenses: [baseExpense], settlements: [settled] });
        expect(alreadySettledLedger.areAllBalancesZero()).toBe(true);
        expect(
            alreadySettledLedger.wouldSettlementZeroAllBalances({ fromUserId: "u2", toUserId: "u1", amount: 50 }, "s1")
        ).toBe(false);

        const closedLedger = new Ledger({ members, expenses: [baseExpense], settlements: [], status: "closed" });
        expect(
            closedLedger.wouldSettlementZeroAllBalances({ fromUserId: "u2", toUserId: "u1", amount: 50 })
        ).toBe(false);
    });
});

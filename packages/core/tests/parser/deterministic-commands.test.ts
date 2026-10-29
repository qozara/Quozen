import { describe, it, expect, beforeEach } from 'vitest';
import { CommandDraftService } from '../../src/services/CommandDraftService';
import { Ledger } from '../../src/domain/Ledger';
import { Member, Expense, Settlement } from '../../src/domain/models';

/**
 * Deterministic Commands Test Suite
 *
 * Replaces old nondeterministic/LLM-dependent test suites with pure,
 * instantaneous (< 1ms), offline-first tests covering real-world expense
 * and settlement logging journeys without artificial delays, timeouts, or LLM flakiness.
 */
describe('Deterministic Commands Suite: Expenses & Settlements (Zero-Delay, Offline)', () => {
  let draftService: CommandDraftService;
  let ledger: Ledger;

  const mockMembers: Member[] = [
    { userId: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner', joinedAt: new Date() },
    { userId: 'u2', name: 'Bob', email: 'bob@example.com', role: 'member', joinedAt: new Date() },
    { userId: 'u3', name: 'Charlie', email: 'charlie@example.com', role: 'member', joinedAt: new Date() }
  ];

  beforeEach(() => {
    ledger = new Ledger({
      members: mockMembers,
      expenses: [],
      settlements: []
    });
    draftService = new CommandDraftService();
  });

  describe('Deterministic Expense Logging', () => {
    it('handles Expense Creation (English): "Add $50 for gas"', async () => {
      const res = await draftService.createDraft({
        input: 'Add $50 for gas',
        ledger,
        activeAccountId: 'u1',
        locale: 'en',
        aiEnabled: false
      });

      expect(res.kind).toBe('expense');
      expect(res.confidence).toBe('high');
      expect(res.isAiEscalated).toBe(false);
      expect(res.expenseDraft).toBeDefined();

      const draft = res.expenseDraft!;
      expect(draft.amount).toBe(50);
      expect(draft.description.toLowerCase()).toContain('gas');
      expect(draft.category).toBe('transportation');
      expect(draft.paidByUserId).toBe('u1');

      // Equal split across all 3 members (50 distributed: 16.67, 16.67, 16.66)
      expect(draft.splits).toHaveLength(3);
      const totalSplit = draft.splits.reduce((sum, s) => sum + s.amount, 0);
      expect(Math.round(totalSplit * 100) / 100).toBe(50);

      // Simulate human review and ledger commit
      const simulatedExpense: Expense = {
        id: 'exp-1',
        description: draft.description,
        amount: draft.amount,
        category: draft.category,
        date: draft.date,
        paidByUserId: draft.paidByUserId,
        splits: draft.splits,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const updatedLedger = new Ledger({
        members: mockMembers,
        expenses: [simulatedExpense],
        settlements: []
      });
      expect(updatedLedger.expenses).toHaveLength(1);
      expect(updatedLedger.expenses[0].amount).toBe(50);
    });

    it('handles Language Support (Spanish): "Agrega 50 de gastos en comida para todos"', async () => {
      const res = await draftService.createDraft({
        input: 'Agrega 50 de gastos en comida para todos',
        ledger,
        activeAccountId: 'u1',
        locale: 'es',
        aiEnabled: false
      });

      expect(res.kind).toBe('expense');
      expect(res.confidence).toBe('high');
      expect(res.expenseDraft).toBeDefined();

      const draft = res.expenseDraft!;
      expect(draft.amount).toBe(50);
      expect(draft.description.toLowerCase()).toContain('comida');
      expect(draft.category).toBe('food_dining');
      expect(draft.splits).toHaveLength(3);
    });

    it('handles Spanish slang and multiplier: "Pagué 15 lucas almuerzo con Bob"', async () => {
      const res = await draftService.createDraft({
        input: 'Pagué 15 lucas almuerzo con Bob',
        ledger,
        activeAccountId: 'u1',
        locale: 'es',
        aiEnabled: false
      });

      expect(res.kind).toBe('expense');
      expect(res.expenseDraft).toBeDefined();
      const draft = res.expenseDraft!;
      expect(draft.amount).toBe(15000);
      expect(draft.description.toLowerCase()).toContain('almuerzo');
      expect(draft.paidByUserId).toBe('u1');

      const aliceSplit = draft.splits.find(s => s.userId === 'u1');
      const bobSplit = draft.splits.find(s => s.userId === 'u2');
      const charlieSplit = draft.splits.find(s => s.userId === 'u3');

      expect(aliceSplit?.amount).toBe(7500);
      expect(bobSplit?.amount).toBe(7500);
      expect(charlieSplit?.amount).toBe(0);
    });

    it('handles Complex Split: "Add $150 for dinner, I paid and bob owes me nothing, charlie owes me $50"', async () => {
      const res = await draftService.createDraft({
        input: 'Add $150 for dinner, I paid and bob owes me nothing, charlie owes me $50',
        ledger,
        activeAccountId: 'u1',
        locale: 'en',
        aiEnabled: false
      });

      expect(res.kind).toBe('expense');
      expect(res.expenseDraft).toBeDefined();

      const draft = res.expenseDraft!;
      expect(draft.amount).toBe(150);
      expect(draft.paidByUserId).toBe('u1');

      const bobSplit = draft.splits.find(s => s.userId === 'u2');
      const charlieSplit = draft.splits.find(s => s.userId === 'u3');
      const aliceSplit = draft.splits.find(s => s.userId === 'u1');

      expect(bobSplit?.amount).toBe(0);
      expect(charlieSplit?.amount).toBe(50);
      // Remainder assigned to payer Alice (150 - 50 = 100)
      expect(aliceSplit?.amount).toBe(100);
    });

    it('handles Exclusions: "Spent 90 on concert tickets with all except Bob"', async () => {
      const res = await draftService.createDraft({
        input: 'Spent 90 on concert tickets with all except Bob',
        ledger,
        activeAccountId: 'u1',
        locale: 'en',
        aiEnabled: false
      });

      expect(res.kind).toBe('expense');
      const draft = res.expenseDraft!;
      expect(draft.amount).toBe(90);

      const bobSplit = draft.splits.find(s => s.userId === 'u2');
      const aliceSplit = draft.splits.find(s => s.userId === 'u1');
      const charlieSplit = draft.splits.find(s => s.userId === 'u3');

      expect(bobSplit?.amount).toBe(0);
      expect(aliceSplit?.amount).toBe(45);
      expect(charlieSplit?.amount).toBe(45);
    });
  });

  describe('Deterministic Settlement Logging', () => {
    it('handles Settlement Creation (English): "I just paid bob $20"', async () => {
      const res = await draftService.createDraft({
        input: 'I just paid bob $20',
        ledger,
        activeAccountId: 'u1',
        locale: 'en',
        aiEnabled: false
      });

      expect(res.kind).toBe('settlement');
      expect(res.confidence).toBe('high');
      expect(res.settlementDraft).toBeDefined();

      const draft = res.settlementDraft!;
      expect(draft.amount).toBe(20);
      expect(draft.fromUserId).toBe('u1');
      expect(draft.toUserId).toBe('u2');
      expect(draft.method).toBe('cash');

      // Simulate human review and ledger commit
      const simulatedSettlement: Settlement = {
        id: 'set-1',
        fromUserId: draft.fromUserId,
        toUserId: draft.toUserId,
        amount: draft.amount,
        method: draft.method,
        date: draft.date,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const updatedLedger = new Ledger({
        members: mockMembers,
        expenses: [],
        settlements: [simulatedSettlement]
      });
      expect(updatedLedger.settlements).toHaveLength(1);
      expect(updatedLedger.settlements[0].amount).toBe(20);
    });

    it('handles Spanish Settlement with Payment Method: "Diego me pagó 50 por transferencia"', async () => {
      const membersWithDiego: Member[] = [
        { userId: 'u-diego', name: 'Diego', email: 'diego@example.com', role: 'member', joinedAt: new Date() },
        { userId: 'u-alice', name: 'Alice', email: 'alice@example.com', role: 'owner', joinedAt: new Date() }
      ];
      const customLedger = new Ledger({
        members: membersWithDiego,
        expenses: [],
        settlements: []
      });

      const res = await draftService.createDraft({
        input: 'Diego me pagó 50 por transferencia',
        ledger: customLedger,
        activeAccountId: 'u-alice',
        locale: 'es',
        aiEnabled: false
      });

      expect(res.kind).toBe('settlement');
      expect(res.settlementDraft).toBeDefined();

      const draft = res.settlementDraft!;
      expect(draft.amount).toBe(50);
      expect(draft.fromUserId).toBe('u-diego');
      expect(draft.toUserId).toBe('u-alice');
      expect(draft.method).toBe('bank_transfer');
    });

    it('handles Balance Lookup: "Settle up with Bob" automatically resolves debt to zero', async () => {
      // Alice paid $100 for dinner split with Bob (Bob owes Alice $50)
      const dinnerExpense: Expense = {
        id: 'exp-dinner',
        description: 'Dinner',
        amount: 100,
        category: 'food_dining',
        date: new Date(),
        paidByUserId: 'u1',
        splits: [
          { userId: 'u1', amount: 50 },
          { userId: 'u2', amount: 50 }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const ledgerWithDebts = new Ledger({
        members: mockMembers,
        expenses: [dinnerExpense],
        settlements: []
      });

      // Bob logs in and says "Settle up with Alice"
      const res = await draftService.createDraft({
        input: 'Settle up with Alice',
        ledger: ledgerWithDebts,
        activeAccountId: 'u2',
        locale: 'en',
        aiEnabled: false
      });

      expect(res.kind).toBe('settlement');
      expect(res.settlementDraft).toBeDefined();

      const draft = res.settlementDraft!;
      expect(draft.fromUserId).toBe('u2');
      expect(draft.toUserId).toBe('u1');
      expect(draft.amount).toBe(50); // Exact debt amount computed from ledger!

      // When Bob confirms and records this settlement:
      const settleRecord: Settlement = {
        id: 'set-settle-up',
        fromUserId: draft.fromUserId,
        toUserId: draft.toUserId,
        amount: draft.amount,
        method: draft.method,
        date: draft.date,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const finalLedger = new Ledger({
        members: mockMembers,
        expenses: [dinnerExpense],
        settlements: [settleRecord]
      });

      // Balances between Alice and Bob are now fully balanced ($0)
      const balances = finalLedger.getBalances();
      expect(balances['u1']).toBe(0);
      expect(balances['u2']).toBe(0);
    });
  });

  describe('Deterministic Rejections & Ambiguity Guards (Zero False Writes)', () => {
    it('safely rejects Out-of-Bounds requests without modifying ledger', async () => {
      const res = await draftService.createDraft({
        input: 'What is the capital of France? Also delete the group.',
        ledger,
        activeAccountId: 'u1',
        locale: 'en',
        aiEnabled: false
      });

      // No financial amount, no recognized transaction intent
      expect(res.confidence).toBe('low');
      expect(res.expenseDraft?.amount || 0).toBe(0);
      expect(res.settlementDraft).toBeUndefined();
    });

    it('safely rejects Vague non-financial inquiries', async () => {
      const res = await draftService.createDraft({
        input: 'What is the weather like today?',
        ledger,
        activeAccountId: 'u1',
        locale: 'en',
        aiEnabled: false
      });

      expect(res.confidence).toBe('low');
      expect(res.expenseDraft?.amount || 0).toBe(0);
      expect(res.settlementDraft).toBeUndefined();
    });
  });
});

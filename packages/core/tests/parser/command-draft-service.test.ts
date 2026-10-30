import { describe, it, expect, beforeEach } from 'vitest';
import { CommandDraftService } from '../../src/services/CommandDraftService';
import { Ledger } from '../../src/domain/Ledger';
import { Member, Expense } from '../../src/domain/models';

describe('CommandDraftService', () => {
  let draftService: CommandDraftService;
  let ledger: Ledger;

  const mockMembers: Member[] = [
    { userId: 'user-diego', name: 'Diego', email: 'diego@example.com', role: 'owner', joinedAt: new Date() },
    { userId: 'user-alice', name: 'Alice', email: 'alice@example.com', role: 'member', joinedAt: new Date() },
    { userId: 'user-bob', name: 'Bob', email: 'bob@example.com', role: 'member', joinedAt: new Date() },
    { userId: 'user-charlie', name: 'Charlie', email: 'charlie@example.com', role: 'member', joinedAt: new Date() },
    { userId: 'user-ana', name: 'Ana', email: 'ana@example.com', role: 'member', joinedAt: new Date() },
    { userId: 'user-anabel', name: 'Anabel', email: 'anabel@example.com', role: 'member', joinedAt: new Date() }
  ];

  beforeEach(() => {
    ledger = new Ledger({
      members: mockMembers,
      expenses: [],
      settlements: []
    });
    draftService = new CommandDraftService();
  });

  it('creates an equal expense draft for everyone without calling any AI', async () => {
    const res = await draftService.createDraft({
      input: 'Add $60 for groceries',
      ledger,
      activeAccountId: 'user-diego',
      locale: 'en',
      aiEnabled: false
    });

    expect(res.kind).toBe('expense');
    expect(res.confidence).toBe('high');
    expect(res.isAiEscalated).toBe(false);
    expect(res.expenseDraft).toBeDefined();
    expect(res.expenseDraft?.amount).toBe(60);
    expect(res.expenseDraft?.paidByUserId).toBe('user-diego');
    expect(res.expenseDraft?.category).toBe('food_dining');
    expect(res.expenseDraft?.splits.length).toBe(mockMembers.length);
    // 60 / 6 = 10 each
    for (const split of res.expenseDraft!.splits) {
      expect(split.amount).toBe(10);
    }
  });

  it('creates a specific member split expense draft with correct zeroed non-participants', async () => {
    const res = await draftService.createDraft({
      input: 'Split a $50 Uber with Bob',
      ledger,
      activeAccountId: 'user-diego',
      locale: 'en'
    });

    expect(res.kind).toBe('expense');
    expect(res.expenseDraft?.amount).toBe(50);
    expect(res.expenseDraft?.paidByUserId).toBe('user-diego');
    expect(res.expenseDraft?.category).toBe('transportation');

    const diegoSplit = res.expenseDraft?.splits.find(s => s.userId === 'user-diego');
    const bobSplit = res.expenseDraft?.splits.find(s => s.userId === 'user-bob');
    const aliceSplit = res.expenseDraft?.splits.find(s => s.userId === 'user-alice');

    expect(diegoSplit?.amount).toBe(25);
    expect(bobSplit?.amount).toBe(25);
    expect(aliceSplit?.amount).toBe(0);
  });

  it('creates an exact amounts expense draft assigning remainder to payer', async () => {
    const res = await draftService.createDraft({
      input: 'Add $150 for dinner, I paid and bob owes me nothing, charlie owes me $50',
      ledger,
      activeAccountId: 'user-diego',
      locale: 'en'
    });

    expect(res.kind).toBe('expense');
    expect(res.expenseDraft?.amount).toBe(150);
    const bobSplit = res.expenseDraft?.splits.find(s => s.userId === 'user-bob');
    const charlieSplit = res.expenseDraft?.splits.find(s => s.userId === 'user-charlie');
    const diegoSplit = res.expenseDraft?.splits.find(s => s.userId === 'user-diego');

    expect(bobSplit?.amount).toBe(0);
    expect(charlieSplit?.amount).toBe(50);
    // 150 - 50 = 100 for Diego
    expect(diegoSplit?.amount).toBe(100);
  });

  it('creates a settlement draft with direction and method', async () => {
    const res = await draftService.createDraft({
      input: 'Bob paid me 35 via Venmo',
      ledger,
      activeAccountId: 'user-diego',
      locale: 'en'
    });

    expect(res.kind).toBe('settlement');
    expect(res.settlementDraft).toBeDefined();
    expect(res.settlementDraft?.fromUserId).toBe('user-bob');
    expect(res.settlementDraft?.toUserId).toBe('user-diego');
    expect(res.settlementDraft?.amount).toBe(35);
    expect(res.settlementDraft?.method).toBe('venmo');
  });

  it('handles "Settle up with Bob" using computed ledger balances', async () => {
    // Bob paid 100 for dinner split with Diego (Diego owes Bob 50)
    const exp: Expense = {
      id: 'e1',
      description: 'Dinner',
      amount: 100,
      category: 'food_dining',
      date: new Date(),
      paidByUserId: 'user-bob',
      splits: [
        { userId: 'user-diego', amount: 50 },
        { userId: 'user-bob', amount: 50 }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const ledgerWithDebts = new Ledger({
      members: mockMembers,
      expenses: [exp],
      settlements: []
    });

    const res = await draftService.createDraft({
      input: 'Settle up with Bob',
      ledger: ledgerWithDebts,
      activeAccountId: 'user-diego',
      locale: 'en'
    });

    expect(res.kind).toBe('settlement');
    expect(res.settlementDraft?.fromUserId).toBe('user-diego');
    expect(res.settlementDraft?.toUserId).toBe('user-bob');
    expect(res.settlementDraft?.amount).toBe(50);
  });

  it('flags ambiguous member tokens without guessing', async () => {
    const res = await draftService.createDraft({
      input: 'Split 40 with An',
      ledger,
      activeAccountId: 'user-diego',
      locale: 'en'
    });

    // "An" matches both Ana and Anabel
    expect(res.ambiguities).toContain('ambiguous_member:an');
    expect(res.confidence).toBe('low');
  });

  it('matches member names with minor typos via Levenshtein <= 1', async () => {
    const res = await draftService.createDraft({
      input: 'Split 40 with Charli',
      ledger,
      activeAccountId: 'user-diego',
      locale: 'en'
    });

    expect(res.kind).toBe('expense');
    const charlieSplit = res.expenseDraft?.splits.find(s => s.userId === 'user-charlie');
    expect(charlieSplit?.amount).toBe(20);
    expect(res.ambiguities.length).toBe(0);
  });
});

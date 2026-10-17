import { describe, it, expect, beforeEach } from 'vitest';
import { LedgerService } from '../../src/finance/LedgerService';
import { LedgerRepository } from '../../src/infrastructure/LedgerRepository';
import { InMemoryAdapter } from '../../src/storage/memory-adapter';
import { User } from '../../src/domain/models';

describe('LedgerService Security & Authorization', () => {
    let storage: InMemoryAdapter;
    let memberUser: User;
    let nonMemberUser: User;
    let groupId: string;

    beforeEach(async () => {
        storage = new InMemoryAdapter();
        memberUser = { id: 'u1', email: 'alice@example.com', name: 'Alice' };
        nonMemberUser = { id: 'u-attacker', email: 'mallory@example.com', name: 'Mallory' };

        groupId = await storage.createSpreadsheet('test-group-sec', ['Members', 'Expenses', 'Settlements', 'Metadata']);

        // Seed members, expenses, and settlements in memory adapter
        await storage.batchUpdateValues(groupId, [
            {
                range: 'Members!A1:E3',
                values: [
                    ['userId', 'email', 'name', 'role', 'joinedAt'],
                    ['u1', 'alice@example.com', 'Alice', 'owner', new Date().toISOString()],
                    ['u2', 'bob@example.com', 'Bob', 'member', new Date().toISOString()]
                ]
            },
            {
                range: 'Expenses!A1:H1',
                values: [['id', 'date', 'description', 'amount', 'paidBy', 'category', 'splits', 'meta']]
            },
            {
                range: 'Settlements!A1:G1',
                values: [['id', 'date', 'fromUserId', 'toUserId', 'amount', 'method', 'notes']]
            }
        ]);
    });

    it('rejects non-positive and non-finite expense amounts', async () => {
        const repo = new LedgerRepository(storage, groupId);
        const service = new LedgerService(repo, memberUser);

        await expect(service.addExpense({
            description: 'Negative expense',
            amount: -50,
            category: 'Food',
            date: new Date(),
            paidByUserId: 'u1',
            splits: [{ userId: 'u1', amount: -50 }]
        })).rejects.toThrow(/positive/i);

        await expect(service.addExpense({
            description: 'Zero expense',
            amount: 0,
            category: 'Food',
            date: new Date(),
            paidByUserId: 'u1',
            splits: []
        })).rejects.toThrow(/positive/i);

        await expect(service.addExpense({
            description: 'NaN expense',
            amount: NaN,
            category: 'Food',
            date: new Date(),
            paidByUserId: 'u1',
            splits: []
        })).rejects.toThrow(/positive/i);
    });

    it('rejects negative split amounts in addExpense', async () => {
        const repo = new LedgerRepository(storage, groupId);
        const service = new LedgerService(repo, memberUser);

        await expect(service.addExpense({
            description: 'Split with negative value',
            amount: 50,
            category: 'Food',
            date: new Date(),
            paidByUserId: 'u1',
            splits: [
                { userId: 'u1', amount: 100 },
                { userId: 'u2', amount: -50 }
            ]
        })).rejects.toThrow(/positive|negative|split/i);
    });

    it('enforces membership check on addSettlement', async () => {
        const repo = new LedgerRepository(storage, groupId);
        const attackerService = new LedgerService(repo, nonMemberUser);

        await expect(attackerService.addSettlement({
            fromUserId: 'u1',
            toUserId: 'u2',
            amount: 25,
            date: new Date()
        })).rejects.toThrow(/Forbidden/i);
    });

    it('rejects non-positive amounts and self-settlements in addSettlement', async () => {
        const repo = new LedgerRepository(storage, groupId);
        const service = new LedgerService(repo, memberUser);

        await expect(service.addSettlement({
            fromUserId: 'u1',
            toUserId: 'u2',
            amount: -10,
            date: new Date()
        })).rejects.toThrow(/positive/i);

        await expect(service.addSettlement({
            fromUserId: 'u1',
            toUserId: 'u1',
            amount: 50,
            date: new Date()
        })).rejects.toThrow(/cannot settle with themselves|same user/i);
    });
});

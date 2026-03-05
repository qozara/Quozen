import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LedgerService } from '../src/finance/LedgerService';
import { LedgerRepository } from '../src/infrastructure/LedgerRepository';
import { User, Member } from '../src/domain/models';

describe('LedgerService Integrity', () => {
    let service: LedgerService;
    let mockRepo: LedgerRepository;
    const testUser: User = { id: 'u1', name: 'Alice', email: 'alice@example.com', username: 'alice' };
    const members: Member[] = [{ userId: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner', joinedAt: new Date() }];

    beforeEach(() => {
        mockRepo = {
            getExpenses: vi.fn(),
            addExpense: vi.fn(),
            updateExpense: vi.fn(),
            getSettlements: vi.fn(),
            addSettlement: vi.fn(),
            updateSettlement: vi.fn(),
            deleteExpense: vi.fn(),
            deleteSettlement: vi.fn(),
            getMembers: vi.fn().mockResolvedValue(members)
        } as unknown as LedgerRepository;
        service = new LedgerService(mockRepo, testUser);
    });

    it('should throw "Splits mismatch" error when adding expense with mismatched splits', async () => {
        const payload = {
            description: 'Mismatched Dinner',
            amount: 100,
            category: 'Food',
            date: new Date(),
            paidByUserId: 'u1',
            splits: [
                { userId: 'u1', amount: 40 },
                { userId: 'u2', amount: 50 } // Sum is 90, expected 100
            ]
        };

        await expect(service.addExpense(payload)).rejects.toThrow("Splits mismatch");
    });

    it('should throw "Splits mismatch" error when updating expense with mismatched splits', async () => {
        const existingExpense = {
            id: 'e1',
            description: 'Dinner',
            amount: 100,
            category: 'Food',
            date: new Date(),
            paidByUserId: 'u1',
            splits: [{ userId: 'u1', amount: 100 }],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        vi.mocked(mockRepo.getExpenses).mockResolvedValue([existingExpense]);

        const payload = {
            splits: [
                { userId: 'u1', amount: 40 },
                { userId: 'u2', amount: 40 } // Sum is 80, expected 100
            ]
        };

        await expect(service.updateExpense('e1', payload)).rejects.toThrow("Splits mismatch");
    });

    it('should allow adding expense when splits match amount', async () => {
        const payload = {
            description: 'Correct Dinner',
            amount: 100,
            category: 'Food',
            date: new Date(),
            paidByUserId: 'u1',
            splits: [
                { userId: 'u1', amount: 50 },
                { userId: 'u2', amount: 50 }
            ]
        };

        await expect(service.addExpense(payload)).resolves.not.toThrow();
        expect(mockRepo.addExpense).toHaveBeenCalled();
    });
});

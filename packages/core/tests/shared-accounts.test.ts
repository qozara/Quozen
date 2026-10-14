import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuozenClient, InMemoryAdapter, QuozenAI } from '../src';
import { IStorageLayer } from '../src/infrastructure/IStorageLayer';
import { AiProvider } from '../src/agent/providers/types';

/**
 * Creates a per-user storage view that isolates `quozen-settings.json` per user
 * while sharing all group spreadsheets in `sharedStorage`.
 */
function createPerUserStorage(sharedStorage: InMemoryAdapter): IStorageLayer {
    const privateSettingsStorage = new InMemoryAdapter();
    const privateFileIds = new Set<string>();

    return new Proxy(sharedStorage, {
        get(target, prop, receiver) {
            if (prop === 'createFile') {
                return async (name: string, mimeTypeOrSheetNames: string | string[], properties?: Record<string, string>, content?: string) => {
                    if (name === 'quozen-settings.json') {
                        const id = await privateSettingsStorage.createFile(name, mimeTypeOrSheetNames, properties, content);
                        privateFileIds.add(id);
                        return id;
                    }
                    return target.createFile(name, mimeTypeOrSheetNames, properties, content);
                };
            }
            if (prop === 'listFiles') {
                return async (queryOrOptions?: any, fields?: string) => {
                    if (typeof queryOrOptions === 'string' && queryOrOptions.includes("name = 'quozen-settings.json'")) {
                        return privateSettingsStorage.listFiles(queryOrOptions, fields);
                    }
                    return target.listFiles(queryOrOptions, fields);
                };
            }
            if (prop === 'getFile') {
                return async (fileId: string, options?: any) => {
                    if (privateFileIds.has(fileId)) {
                        return privateSettingsStorage.getFile(fileId, options);
                    }
                    return target.getFile(fileId, options);
                };
            }
            if (prop === 'updateFile') {
                return async (fileId: string, metadata?: any, content?: string) => {
                    if (privateFileIds.has(fileId)) {
                        return privateSettingsStorage.updateFile(fileId, metadata, content);
                    }
                    return target.updateFile(fileId, metadata, content);
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

describe('Account-User Separation (Shared, Personal, and Offline Accounts)', () => {
    let sharedStorage: InMemoryAdapter;
    let clientA: QuozenClient;
    let clientB: QuozenClient;
    let clientC: QuozenClient;

    const userA = { id: 'u1', username: 'alice', name: 'Alice', email: 'alice@example.com' };
    const userB = { id: 'u2', username: 'bob', name: 'Bob', email: 'bob@example.com' };
    const userC = { id: 'u3', username: 'charlie', name: 'Charlie', email: 'charlie@example.com' };

    beforeEach(() => {
        sharedStorage = new InMemoryAdapter();
        clientA = new QuozenClient({ storage: createPerUserStorage(sharedStorage), user: userA });
        clientB = new QuozenClient({ storage: createPerUserStorage(sharedStorage), user: userB });
        clientC = new QuozenClient({ storage: createPerUserStorage(sharedStorage), user: userC });
    });

    it('allows two users (A and B) to co-manage a Shared Account and split 50/50 with User C without schema or row migrations', async () => {
        // 1. User A creates a group with User C (invited by email)
        const group = await clientA.groups.create('Patagonia Trip', [
            { username: 'Charlie', email: userC.email }
        ]);

        // 2. User A renames her account to a Shared Account name: "Garcia Family"
        await clientA.ledger(group.id).renameMember(userA.id, 'Garcia Family');

        // 3. User B joins the group and links directly to the "Garcia Family" Shared Account (u1)
        await clientB.groups.joinGroup(group.id, { accountId: userA.id });

        // Verify User B's settings store the linked accountId
        const bAccountId = await clientB.groups.getGroupAccountId(group.id);
        expect(bAccountId).toBe(userA.id);

        // Verify loading the ledger as User B does NOT create a duplicate member or migrate u1 -> u2
        const ledgerFromB = await clientB.ledger(group.id).getLedger();
        expect(ledgerFromB.members).toHaveLength(2);
        expect(ledgerFromB.members.find(m => m.userId === userA.id)?.name).toBe('Garcia Family');
        expect(ledgerFromB.members.find(m => m.userId === userB.id)).toBeUndefined();

        // 4. User C joins the group as their own Personal Account (migrates charlie@example.com -> u3)
        await clientC.groups.joinGroup(group.id);
        const ledgerFromC = await clientC.ledger(group.id).getLedger();
        expect(ledgerFromC.members).toHaveLength(2);
        expect(ledgerFromC.members.map(m => m.userId).sort()).toEqual(['u1', 'u3']);

        // 5. User C creates a $100 expense shared equally across the group (between u3 and Shared Account u1)
        await clientC.ledger(group.id).addExpense({
            description: 'Hotel Booking',
            amount: 100,
            paidByUserId: userC.id,
            category: 'Lodging',
            date: new Date('2026-10-10'),
            splits: [
                { userId: userC.id, amount: 50 },
                { userId: userA.id, amount: 50 }
            ]
        });

        // 6. User B (logged in as u2, managing Shared Account u1) creates a $60 expense paid by Shared Account u1
        await clientB.ledger(group.id).addExpense({
            description: 'Groceries',
            amount: 60,
            paidByUserId: userA.id,
            category: 'Food',
            date: new Date('2026-10-11'),
            splits: [
                { userId: userA.id, amount: 30 },
                { userId: userC.id, amount: 30 }
            ]
        });

        // 7. Verify balances across the 2 accounts
        const finalLedger = await clientB.ledger(group.id).getLedger();
        // Charlie paid 100, owed 50 -> +50; then owed 30 from Groceries -> +20
        expect(finalLedger.getUserBalance(userC.id)).toBe(20);
        // Garcia Family (u1) owed 50 -> -50; then paid 60, owed 30 (+30) -> -20
        expect(finalLedger.getUserBalance(userA.id)).toBe(-20);
    });

    it('supports Smart Cleanup (removeUnusedMember) when switching from an unused Personal Account to a Shared Account', async () => {
        const group = await clientA.groups.create('Road Trip', [
            { username: 'Charlie', email: userC.email }
        ]);

        // User B joins normally first (creates a 3rd row in Members for u2)
        await clientB.groups.joinGroup(group.id);
        let ledger = await clientB.ledger(group.id).getLedger();
        expect(ledger.members).toHaveLength(3);
        expect(ledger.members.some(m => m.userId === userB.id)).toBe(true);

        // User B switches to User A's account and triggers Smart Cleanup on their unused u2 row
        const removed = await clientB.ledger(group.id).removeUnusedMember(userB.id);
        expect(removed).toBe(true);
        await clientB.groups.updateGroupAccount(group.id, userA.id);

        ledger = await clientB.ledger(group.id).getLedger();
        expect(ledger.members).toHaveLength(2);
        expect(ledger.members.some(m => m.userId === userB.id)).toBe(false);
        expect(await clientB.groups.getGroupAccountId(group.id)).toBe(userA.id);
    });

    it('refuses to remove an account in removeUnusedMember if it is owner or has transactions', async () => {
        const group = await clientA.groups.create('Safety Check', [
            { username: 'Bob', email: userB.email }
        ]);
        await clientB.groups.joinGroup(group.id);
        await clientB.ledger(group.id).getLedger(); // triggers email -> u2 migration

        // Owner account cannot be removed even with 0 transactions
        const ownerRemoved = await clientA.ledger(group.id).removeUnusedMember(userA.id);
        expect(ownerRemoved).toBe(false);

        // Add an expense involving u2
        await clientA.ledger(group.id).addExpense({
            description: 'Taxi',
            amount: 20,
            paidByUserId: userA.id,
            category: 'Transport',
            date: new Date(),
            splits: [
                { userId: userA.id, amount: 10 },
                { userId: userB.id, amount: 10 }
            ]
        });

        // Member with transactions cannot be removed
        const activeMemberRemoved = await clientB.ledger(group.id).removeUnusedMember(userB.id);
        expect(activeMemberRemoved).toBe(false);

        const ledger = await clientA.ledger(group.id).getLedger();
        expect(ledger.members).toHaveLength(2);
    });

    it('preserves a Shared Account in the spreadsheet when one of its co-managers leaves the group', async () => {
        const group = await clientA.groups.create('Family Vacation');
        await clientA.ledger(group.id).renameMember(userA.id, 'Smith Household');

        // User B joins linked to Smith Household (u1)
        await clientB.groups.joinGroup(group.id, { accountId: userA.id });

        // User B leaves the group
        await clientB.groups.leaveGroup(group.id);

        // Verify group is removed from User B's settings
        const bSettings = await clientB.groups.getSettings();
        expect(bSettings.groupCache.find(g => g.id === group.id)).toBeUndefined();

        // Verify Smith Household (u1) is still in the group for User A
        const aLedger = await clientA.ledger(group.id).getLedger();
        expect(aLedger.members).toHaveLength(1);
        expect(aLedger.members[0].userId).toBe(userA.id);
        expect(aLedger.members[0].name).toBe('Smith Household');
    });

    it('resolves "me" in QuozenAI to the active linked Shared or Offline Account', async () => {
        const group = await clientA.groups.create('AI Trip', [
            { username: 'Charlie', email: userC.email }
        ]);
        await clientA.ledger(group.id).renameMember(userA.id, 'Garcia Family');
        await clientB.groups.joinGroup(group.id, { accountId: userA.id });

        const mockProvider: AiProvider = {
            id: 'mock',
            mode: 'cloud',
            chat: vi.fn().mockResolvedValue({
                type: 'tool_call',
                tool: 'addExpense',
                arguments: {
                    description: 'Museum Tickets',
                    amount: 40,
                    category: 'Entertainment',
                    paidByUserId: 'me',
                    splits: [
                        { userId: 'me', amount: 20 },
                        { userId: userC.email, amount: 20 }
                    ]
                }
            }),
            checkAvailability: vi.fn().mockResolvedValue(true),
            getSetupMessage: () => null
        };

        const aiForB = new QuozenAI(clientB, mockProvider);
        const result = await aiForB.executeCommand('I paid 40 for museum tickets', group.id, 'en');

        expect(result.success).toBe(true);

        const ledger = await clientB.ledger(group.id).getLedger();
        expect(ledger.expenses).toHaveLength(1);
        expect(ledger.expenses[0].paidByUserId).toBe(userA.id); // Resolved 'me' to Shared Account u1, not u2!
        expect(ledger.expenses[0].splits).toEqual([
            { userId: userA.id, amount: 20 },
            { userId: userC.email, amount: 20 }
        ]);
    });
});
